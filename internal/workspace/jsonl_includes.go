package workspace

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// IncludeBytesPerToken is the measured tokenization density of the CLAUDE.md
// include sets in this fleet (SVML/TDA-heavy markdown). Measured against real
// cache_creation_input_tokens on a 1.36MB include set: 2.35 bytes/token. Plain
// prose is closer to 4, so this errs on the side of over-estimating for
// English and is close to exact for SVML.
const IncludeBytesPerToken = 2.35

// IncludeFile is one @-included file tracked by the CLI in the session JSONL.
type IncludeFile struct {
	Path      string `json:"path"`
	Bytes     int64  `json:"bytes"`     // current on-disk size (0 when missing)
	TokensEst int    `json:"tokensEst"` // Bytes / IncludeBytesPerToken
	Missing   bool   `json:"missing"`   // file no longer exists on disk
}

// IncludeInjectionInfo describes what the Claude Code CLI will do with the
// CLAUDE.md @-include set on the NEXT spawn for a session.
//
// Since CLI ~2.1.258 the include set is persisted once in the session JSONL as
// a type:"attachment" / attachment.type:"instructions" entry and replayed
// byte-identical on every --resume (cache stability). When an included file's
// content changes on disk, the CLI APPENDS the changed files as a new
// instructions attachment with changed:true — the old copy stays in context.
// ClaudeFu spawns a fresh `claude --resume` per message, so every send is a
// `session_start` diff. This struct lets the UI show the cost BEFORE the send.
type IncludeInjectionInfo struct {
	Available bool `json:"available"` // false when the session has no instructions attachment (pre-2.1.258 or never spawned)

	// The include set as the CLI currently knows it (latest copy per path).
	IncludedFiles     int   `json:"includedFiles"`
	IncludedBytes     int64 `json:"includedBytes"`     // sum of CURRENT on-disk sizes
	IncludedTokensEst int   `json:"includedTokensEst"` // the floor every post-compaction rebuild pays

	// Files whose on-disk content differs from the CLI's latest copy — these
	// will be re-injected in full on the next send.
	ChangedFiles     []IncludeFile `json:"changedFiles"`
	ChangedBytes     int64         `json:"changedBytes"`
	ChangedTokensEst int           `json:"changedTokensEst"`

	// Superseded copies already sitting in context since the last full set
	// (initial or post-compaction). Copies = number of instructions
	// attachments since the last full set (1 = no re-injection yet).
	Copies             int `json:"copies"`
	DuplicateTokensEst int `json:"duplicateTokensEst"`
}

// PendingIncludeInjection reads the session JSONL, reconstructs the CLI's
// latest copy of every @-included file, and diffs it against disk.
// Read-only. Returns Available=false (no error) when the session carries no
// instructions attachment.
func PendingIncludeInjection(folder, sessionID string) (*IncludeInjectionInfo, error) {
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")
	return pendingIncludeInjectionFromFile(sessionPath)
}

func pendingIncludeInjectionFromFile(sessionPath string) (*IncludeInjectionInfo, error) {
	f, err := os.Open(sessionPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	latest := map[string][]byte{} // path -> CLI's latest copy of the content
	order := []string{}           // stable output ordering (first-seen)
	info := &IncludeInjectionInfo{ChangedFiles: []IncludeFile{}}
	superseded := int64(0)

	scanner := bufio.NewScanner(f)
	// Instructions attachments are multi-MB single lines.
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if !bytes.Contains(line, []byte(`"type":"attachment"`)) || !bytes.Contains(line, []byte(`"type":"instructions"`)) {
			continue
		}
		var entry struct {
			Type       string `json:"type"`
			Attachment struct {
				Type    string `json:"type"`
				Changed bool   `json:"changed"`
				Files   []struct {
					Path    string `json:"path"`
					Content string `json:"content"`
				} `json:"files"`
			} `json:"attachment"`
		}
		if err := json.Unmarshal(line, &entry); err != nil || entry.Type != "attachment" || entry.Attachment.Type != "instructions" {
			continue
		}
		info.Available = true
		if !entry.Attachment.Changed {
			// Full set: initial load or post-compaction rebuild. New baseline.
			latest = map[string][]byte{}
			order = order[:0]
			superseded = 0
			info.Copies = 1
		} else {
			info.Copies++
		}
		for _, fl := range entry.Attachment.Files {
			if fl.Path == "" {
				continue
			}
			if prev, ok := latest[fl.Path]; ok {
				if entry.Attachment.Changed {
					superseded += int64(len(prev))
				}
			} else {
				order = append(order, fl.Path)
			}
			latest[fl.Path] = []byte(fl.Content)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if !info.Available {
		return info, nil
	}

	for _, p := range order {
		cliCopy := latest[p]
		disk, err := os.ReadFile(p)
		if err != nil {
			// Missing on disk: the CLI cannot re-read it, nothing to inject.
			info.IncludedFiles++
			continue
		}
		info.IncludedFiles++
		info.IncludedBytes += int64(len(disk))
		if !includeContentEqual(disk, cliCopy) {
			cf := IncludeFile{Path: p, Bytes: int64(len(disk)), TokensEst: estTokens(int64(len(disk)))}
			info.ChangedFiles = append(info.ChangedFiles, cf)
			info.ChangedBytes += cf.Bytes
		}
	}
	info.IncludedTokensEst = estTokens(info.IncludedBytes)
	info.ChangedTokensEst = estTokens(info.ChangedBytes)
	info.DuplicateTokensEst = estTokens(superseded)
	return info, nil
}

// includeContentEqual compares disk content with the CLI's persisted copy the
// way the CLI does. Observed against real sessions: the CLI stores the file
// with leading/trailing whitespace trimmed (a trailing newline or a trailing
// space on the last line is dropped), so a raw byte compare flags every file
// that ends in "\n" as changed. Also tolerate CRLF and per-line trailing
// whitespace so an editor's whitespace normalization never reads as a change.
func includeContentEqual(disk, cli []byte) bool {
	if bytes.Equal(disk, cli) {
		return true
	}
	return normalizeInclude(disk) == normalizeInclude(cli)
}

func normalizeInclude(b []byte) string {
	s := strings.ReplaceAll(string(b), "\r\n", "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func estTokens(b int64) int {
	if b <= 0 {
		return 0
	}
	return int(float64(b)/IncludeBytesPerToken + 0.5)
}

// IncludeDisplayName shortens an absolute include path for chip tooltips:
// the last two path segments (dir/file).
func IncludeDisplayName(p string) string {
	parts := strings.Split(filepath.ToSlash(p), "/")
	if len(parts) >= 2 {
		return parts[len(parts)-2] + "/" + parts[len(parts)-1]
	}
	return p
}
