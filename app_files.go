package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// =============================================================================
// FILE LISTING METHODS (Bound to frontend for @file autocomplete)
// =============================================================================

// FileInfo represents a file or directory for the file picker
type FileInfo struct {
	Path    string `json:"path"`    // Full absolute path
	RelPath string `json:"relPath"` // Relative path for display
	Name    string `json:"name"`    // Filename only
	IsDir   bool   `json:"isDir"`   // True if directory
	Size    int64  `json:"size"`    // File size in bytes
	Ext     string `json:"ext"`     // Extension without dot
}

// Default ignore patterns for file listing
var defaultIgnorePatterns = []string{
	"node_modules",
	".git",
	".venv",
	"__pycache__",
	"dist",
	"build",
	"target",
	"vendor",
	".next",
	".DS_Store",
	".env",
	".idea",
	".vscode",
	"coverage",
	".nyc_output",
	".pytest_cache",
	".mypy_cache",
	"eggs",
	"*.egg-info",
	".tox",
	".nox",
	"htmlcov",
	".hypothesis",
	".ruff_cache",
}

// Maximum file size for ReadFileContent (100KB)
const maxFileContentSize = 100 * 1024

// Maximum depth for directory traversal
const maxWalkDepth = 6

// Maximum results to return
const defaultMaxResults = 100

// ListFiles returns files matching query from agent folder + additionalDirectories
func (a *App) ListFiles(agentID string, query string, maxResults int) ([]FileInfo, error) {
	// Get agent
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	// Validate agent folder exists
	if _, err := os.Stat(agent.Folder); err != nil {
		return nil, fmt.Errorf("agent folder not found: %s", agent.Folder)
	}

	// Set default max results
	if maxResults <= 0 {
		maxResults = defaultMaxResults
	}
	if maxResults > 500 {
		maxResults = 500
	}

	// Get additional directories from Claude settings
	perms, err := a.GetClaudePermissions(agent.Folder)
	if err != nil {
		// Log but continue with just agent folder
		fmt.Printf("[ListFiles] Warning: failed to get permissions: %v\n", err)
	}

	// Build list of root directories to search
	roots := []string{agent.Folder}
	for _, dir := range perms.AdditionalDirectories {
		// Expand ~ to home directory
		if strings.HasPrefix(dir, "~") {
			home, _ := os.UserHomeDir()
			dir = filepath.Join(home, dir[1:])
		}
		// Only add if directory exists
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			roots = append(roots, dir)
		}
	}

	// Normalize query for case-insensitive matching
	queryLower := strings.ToLower(query)

	// Collect results from all roots (track seen paths to avoid duplicates)
	results := []FileInfo{}
	seenPaths := make(map[string]bool)

	for _, root := range roots {
		if len(results) >= maxResults {
			break
		}

		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil // Skip inaccessible paths
			}

			// Calculate depth
			relPath, _ := filepath.Rel(root, path)
			if relPath == "." {
				return nil // Skip root itself
			}
			depth := strings.Count(relPath, string(filepath.Separator))
			if depth > maxWalkDepth {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			// Check ignore patterns
			if shouldIgnore(d.Name()) {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			// Apply query filter (case-insensitive substring match on relative path)
			if queryLower != "" && !strings.Contains(strings.ToLower(relPath), queryLower) {
				return nil
			}

			// Skip if we've already seen this path (from another root)
			if seenPaths[path] {
				return nil
			}
			seenPaths[path] = true

			// Get file info
			info, err := d.Info()
			if err != nil {
				return nil
			}

			// Add to results
			results = append(results, FileInfo{
				Path:    path,
				RelPath: relPath,
				Name:    d.Name(),
				IsDir:   d.IsDir(),
				Size:    info.Size(),
				Ext:     strings.TrimPrefix(filepath.Ext(d.Name()), "."),
			})

			// Stop if we hit limit
			if len(results) >= maxResults {
				return filepath.SkipAll
			}

			return nil
		})

		if err != nil && err != filepath.SkipAll {
			fmt.Printf("[ListFiles] Walk error for %s: %v\n", root, err)
		}
	}

	// Sort results: prioritize shallower paths and filename matches
	sort.Slice(results, func(i, j int) bool {
		// Count depth (number of path separators)
		depthI := strings.Count(results[i].RelPath, string(filepath.Separator))
		depthJ := strings.Count(results[j].RelPath, string(filepath.Separator))

		// If query provided, check if it matches filename (not just path)
		if queryLower != "" {
			matchesNameI := strings.Contains(strings.ToLower(results[i].Name), queryLower)
			matchesNameJ := strings.Contains(strings.ToLower(results[j].Name), queryLower)
			// Filename matches come first
			if matchesNameI && !matchesNameJ {
				return true
			}
			if !matchesNameI && matchesNameJ {
				return false
			}
		}

		// Shallower paths come first
		if depthI != depthJ {
			return depthI < depthJ
		}

		// Alphabetical as tiebreaker
		return results[i].RelPath < results[j].RelPath
	})

	return results, nil
}

// ReadFileContent returns file content as string for @@ attachments
// Returns error if file > 100KB or is binary
func (a *App) ReadFileContent(filePath string) (string, error) {
	// Validate path
	if filePath == "" {
		return "", fmt.Errorf("file path is required")
	}

	// Get file info
	info, err := os.Stat(filePath)
	if err != nil {
		return "", fmt.Errorf("file not found: %s", filePath)
	}

	// Check if directory
	if info.IsDir() {
		return "", fmt.Errorf("cannot read directory content")
	}

	// Check file size
	if info.Size() > maxFileContentSize {
		return "", fmt.Errorf("file too large: %d bytes (max %d)", info.Size(), maxFileContentSize)
	}

	// Read file
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}

	// Basic binary detection (check for null bytes in first 8KB)
	checkSize := min(len(data), 8192)
	for i := 0; i < checkSize; i++ {
		if data[i] == 0 {
			return "", fmt.Errorf("file appears to be binary")
		}
	}

	return string(data), nil
}

// shouldIgnore checks if a file/directory should be ignored
func shouldIgnore(name string) bool {
	// Skip hidden files (except .claude which might have useful configs)
	if strings.HasPrefix(name, ".") && name != ".claude" {
		return true
	}

	// Check against ignore patterns
	nameLower := strings.ToLower(name)
	for _, pattern := range defaultIgnorePatterns {
		// Handle wildcard patterns like "*.egg-info"
		if strings.HasPrefix(pattern, "*") {
			suffix := strings.TrimPrefix(pattern, "*")
			if strings.HasSuffix(nameLower, suffix) {
				return true
			}
		} else if nameLower == strings.ToLower(pattern) {
			return true
		}
	}

	return false
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
