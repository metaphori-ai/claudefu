package proxy

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Config holds proxy configuration
type Config struct {
	Enabled         bool   `json:"enabled"`
	Port            int    `json:"port"`            // default: 9350
	CacheFixEnabled bool   `json:"cacheFixEnabled"` // default: true
	CacheTTL        string `json:"cacheTTL"`        // "5m" or "1h" (default: "5m")
	LoggingEnabled  bool   `json:"loggingEnabled"`  // default: false
	LogDir          string `json:"logDir"`           // default: ~/.claudefu/proxy-logs/
	UpstreamURL     string `json:"upstreamURL"`      // default: https://api.anthropic.com (or user's custom proxy)
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
	return Config{
		Enabled:         false,
		Port:            9350,
		CacheFixEnabled: true,
		CacheTTL:        "5m",
		LoggingEnabled:  false,
		UpstreamURL:     "https://api.anthropic.com",
	}
}

// Stats tracks proxy activity
type Stats struct {
	TotalRequests   int64 `json:"totalRequests"`
	CacheFixesApplied int64 `json:"cacheFixesApplied"`
	SkillsMoved     int64 `json:"skillsMoved"`
	BreakpointsAdded int64 `json:"breakpointsAdded"`
	TTLsUpgraded    int64 `json:"ttlsUpgraded"`
	Errors          int64 `json:"errors"`
}

// Status represents the current proxy state for the frontend
type Status struct {
	Running bool   `json:"running"`
	Port    int    `json:"port"`
	Stats   Stats  `json:"stats"`
}

// Service is the reverse proxy with cache fix logic
type Service struct {
	config  Config
	server  *http.Server
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{} // closed when server is fully stopped
	mu      sync.RWMutex
	running bool

	// Atomic stats counters
	totalRequests    atomic.Int64
	cacheFixesApplied atomic.Int64
	skillsMoved      atomic.Int64
	breakpointsAdded atomic.Int64
	ttlsUpgraded     atomic.Int64
	errors           atomic.Int64
}

// NewService creates a new proxy service
func NewService(config Config) *Service {
	if config.Port == 0 {
		config.Port = 9350
	}
	if config.UpstreamURL == "" {
		config.UpstreamURL = "https://api.anthropic.com"
	}
	return &Service{config: config}
}

// Start starts the reverse proxy server
func (s *Service) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return nil
	}

	// Parse upstream URL
	upstream, err := url.Parse(s.config.UpstreamURL)
	if err != nil {
		return fmt.Errorf("invalid upstream URL %q: %w", s.config.UpstreamURL, err)
	}

	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.done = make(chan struct{})

	// Create reverse proxy
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = upstream.Scheme
			req.URL.Host = upstream.Host
			req.Host = upstream.Host
		},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
			},
			// Connection pooling for performance
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			IdleConnTimeout:     90 * time.Second,
		},
		// Streaming support: flush immediately for SSE/streaming responses
		FlushInterval: -1,
	}

	// Wrap with our cache fix middleware
	handler := s.middleware(proxy)

	s.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", s.config.Port),
		Handler: handler,
	}

	// Ensure log directory exists if logging enabled
	if s.config.LoggingEnabled && s.config.LogDir != "" {
		if err := os.MkdirAll(s.config.LogDir, 0755); err != nil {
			fmt.Printf("[proxy] Warning: could not create log dir %s: %v\n", s.config.LogDir, err)
		}
	}

	// Start listening
	listener, err := net.Listen("tcp", s.server.Addr)
	if err != nil {
		return fmt.Errorf("proxy port %d already in use: %w", s.config.Port, err)
	}

	go func() {
		fmt.Printf("[proxy] Cache fix proxy started on :%d → %s\n", s.config.Port, s.config.UpstreamURL)
		if err := s.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Printf("[proxy] Server error: %v\n", err)
		}
	}()

	// Shutdown on context cancellation — signals done when server is fully stopped
	go func() {
		<-s.ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.server.Shutdown(shutdownCtx)
		close(s.done)
	}()

	s.running = true
	return nil
}

// Stop stops the proxy server and waits for it to fully release the port.
func (s *Service) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}

	done := s.done
	if s.cancel != nil {
		s.cancel()
	}
	s.running = false
	s.mu.Unlock()

	// Wait for server to fully shut down (port released) before returning.
	// This makes Restart() safe — Start() won't race for the port.
	if done != nil {
		<-done
	}
	fmt.Println("[proxy] Cache fix proxy stopped")
}

// Restart stops and starts with new config
func (s *Service) Restart(config Config) error {
	s.Stop()
	s.config = config
	return s.Start()
}

// IsRunning returns whether the proxy is running
func (s *Service) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

// GetStats returns current proxy stats
func (s *Service) GetStats() Stats {
	return Stats{
		TotalRequests:    s.totalRequests.Load(),
		CacheFixesApplied: s.cacheFixesApplied.Load(),
		SkillsMoved:      s.skillsMoved.Load(),
		BreakpointsAdded: s.breakpointsAdded.Load(),
		TTLsUpgraded:     s.ttlsUpgraded.Load(),
		Errors:           s.errors.Load(),
	}
}

// GetStatus returns current status for the frontend
func (s *Service) GetStatus() Status {
	return Status{
		Running: s.IsRunning(),
		Port:    s.config.Port,
		Stats:   s.GetStats(),
	}
}

// middleware wraps the reverse proxy with cache fix and logging
func (s *Service) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.totalRequests.Add(1)

		// Only intercept POST /v1/messages
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/v1/messages") {
			if s.config.CacheFixEnabled {
				if err := s.fixCacheRequest(r); err != nil {
					s.errors.Add(1)
					fmt.Printf("[proxy] Cache fix error: %v\n", err)
					// Continue with original request — don't block on fix failure
				}
			}

			// Log the (possibly fixed) request
			if s.config.LoggingEnabled && s.config.LogDir != "" {
				s.logRequest(r)
			}

			// Wrap response writer to capture response for logging
			if s.config.LoggingEnabled && s.config.LogDir != "" {
				rw := &responseCapture{ResponseWriter: w, body: &bytes.Buffer{}}
				next.ServeHTTP(rw, r)
				s.logResponse(rw.body.Bytes())
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

// =============================================================================
// CACHE FIX LOGIC
// =============================================================================

// fixCacheRequest applies cache fix mutations to the request body.
// Fix 1: Move skills system-reminder from msg[0] to last user message
// Fix 2: Add cache_control breakpoint to msg[0] last block
// Fix 3: If CacheTTL is "1h", upgrade all existing 5m cache_control to 1h
func (s *Service) fixCacheRequest(r *http.Request) error {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	r.Body.Close()

	// Parse as generic JSON (we need flexibility for the message structure)
	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		// Not valid JSON — restore body and skip
		r.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}

	messages, ok := data["messages"].([]any)
	if !ok || len(messages) == 0 {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}

	msg0, ok := messages[0].(map[string]any)
	if !ok {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}

	if role, _ := msg0["role"].(string); role != "user" {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}

	content, ok := msg0["content"].([]any)
	if !ok {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}

	modified := false

	// --- Fix 1: Move skills system-reminder out of msg[0] ---
	if len(content) >= 3 {
		blk0, isMap := content[0].(map[string]any)
		if isMap && !hasField(blk0, "cache_control") {
			text, _ := blk0["text"].(string)
			if strings.Contains(text, "<system-reminder>") &&
				(strings.Contains(text, "skills are available") || strings.Contains(text, "Skill tool")) {

				// Pop the skills block from msg[0]
				skillsBlock := content[0]
				content = content[1:]
				msg0["content"] = content

				// Find last user message (after msg[0])
				lastUserIdx := -1
				for i := len(messages) - 1; i > 0; i-- {
					msg, ok := messages[i].(map[string]any)
					if ok {
						if role, _ := msg["role"].(string); role == "user" {
							lastUserIdx = i
							break
						}
					}
				}

				if lastUserIdx > 0 {
					lastMsg := messages[lastUserIdx].(map[string]any)
					lastContent, isList := lastMsg["content"].([]any)
					if isList {
						// Insert skills block at start of last user message
						lastMsg["content"] = append([]any{skillsBlock}, lastContent...)
					} else if lastContentStr, isStr := lastMsg["content"].(string); isStr {
						// Convert string content to list
						lastMsg["content"] = []any{
							skillsBlock,
							map[string]any{"type": "text", "text": lastContentStr},
						}
					}
					modified = true
					s.skillsMoved.Add(1)
					fmt.Printf("[proxy] Moved skills SR from msg[0] to msg[%d]\n", lastUserIdx)
				}
			}
		}
	}

	// Re-read content after potential pop
	content, _ = msg0["content"].([]any)

	// --- Fix 2: Ensure msg[0] last block has cache_control ---
	if len(content) > 0 {
		lastBlock, isMap := content[len(content)-1].(map[string]any)
		if isMap && !hasField(lastBlock, "cache_control") {
			cc := map[string]any{"type": "ephemeral"}
			if s.config.CacheTTL == "1h" {
				cc["ttl"] = "1h"
			}
			lastBlock["cache_control"] = cc
			modified = true
			s.breakpointsAdded.Add(1)
			fmt.Printf("[proxy] Added cache_control to msg[0] block[%d]\n", len(content)-1)
		}
	}

	// --- Fix 3: If CacheTTL is "1h", upgrade all existing 5m blocks ---
	if s.config.CacheTTL == "1h" {
		upgraded := s.upgradeCacheTTLs(data)
		if upgraded > 0 {
			modified = true
			s.ttlsUpgraded.Add(int64(upgraded))
			fmt.Printf("[proxy] Upgraded %d cache_control TTLs from 5m to 1h\n", upgraded)
		}
	}

	if modified {
		s.cacheFixesApplied.Add(1)
	}

	// Re-marshal and replace body
	newBody, err := json.Marshal(data)
	if err != nil {
		// Restore original body on marshal failure
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("marshal: %w", err)
	}

	r.Body = io.NopCloser(bytes.NewReader(newBody))
	r.ContentLength = int64(len(newBody))
	return nil
}

// upgradeCacheTTLs walks the entire request and upgrades 5m cache_control to 1h.
// This ensures all breakpoints use 1h for long coding sessions.
// Anthropic requires non-increasing TTL ordering (tools → system → messages),
// so upgrading ALL to 1h satisfies the constraint.
func (s *Service) upgradeCacheTTLs(data map[string]any) int {
	upgraded := 0

	// Upgrade system cache_control blocks
	if system, ok := data["system"].([]any); ok {
		for _, block := range system {
			if m, ok := block.(map[string]any); ok {
				if upgradeSingleTTL(m) {
					upgraded++
				}
			}
		}
	}

	// Upgrade tool cache_control blocks (tools array, each tool definition)
	if tools, ok := data["tools"].([]any); ok {
		for _, tool := range tools {
			if m, ok := tool.(map[string]any); ok {
				if upgradeSingleTTL(m) {
					upgraded++
				}
			}
		}
	}

	// Upgrade message content cache_control blocks
	if messages, ok := data["messages"].([]any); ok {
		for _, msg := range messages {
			if m, ok := msg.(map[string]any); ok {
				if content, ok := m["content"].([]any); ok {
					for _, block := range content {
						if b, ok := block.(map[string]any); ok {
							if upgradeSingleTTL(b) {
								upgraded++
							}
						}
					}
				}
			}
		}
	}

	return upgraded
}

// upgradeSingleTTL upgrades a single cache_control from 5m to 1h.
// Returns true if upgraded.
func upgradeSingleTTL(block map[string]any) bool {
	cc, ok := block["cache_control"].(map[string]any)
	if !ok {
		return false
	}
	ttl, _ := cc["ttl"].(string)
	if ttl == "5m" || ttl == "" {
		cc["ttl"] = "1h"
		return true
	}
	return false
}

// hasField checks if a map has a non-nil field
func hasField(m map[string]any, key string) bool {
	v, exists := m[key]
	return exists && v != nil
}

// =============================================================================
// REQUEST/RESPONSE LOGGING
// =============================================================================

func (s *Service) logRequest(r *http.Request) {
	if r.Body == nil {
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	timestamp := time.Now().Unix()
	filename := filepath.Join(s.config.LogDir, fmt.Sprintf("%d_request.json", timestamp))

	// Pretty-print for readability
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, body, "", "  "); err == nil {
		os.WriteFile(filename, pretty.Bytes(), 0644)
	} else {
		os.WriteFile(filename, body, 0644)
	}
}

func (s *Service) logResponse(body []byte) {
	if len(body) == 0 {
		return
	}

	timestamp := time.Now().Unix()
	filename := filepath.Join(s.config.LogDir, fmt.Sprintf("%d_response.txt", timestamp))

	// Responses may be streaming (SSE), write as-is
	go func() {
		os.WriteFile(filename, body, 0644)
	}()
}

// responseCapture wraps ResponseWriter to capture the response body
type responseCapture struct {
	http.ResponseWriter
	body *bytes.Buffer
}

func (rc *responseCapture) Write(b []byte) (int, error) {
	rc.body.Write(b)
	return rc.ResponseWriter.Write(b)
}
