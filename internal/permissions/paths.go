package permissions

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// NormalizePath converts any path format to ClaudeFu's canonical storage format.
// Input accepts: absolute paths, ~/relative, //absolute (Claude gitignore syntax).
// Output: ~/relative (if under home dir) or absolute path (if not under home).
//
// Examples:
//
//	/Users/jasdeep/svml       -> ~/svml
//	//Users/jasdeep/svml      -> ~/svml
//	~/svml                    -> ~/svml
//	/mnt/external             -> /mnt/external
func NormalizePath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", nil
	}

	// Strip trailing slashes (except root "/")
	path = strings.TrimRight(path, "/")
	if path == "" {
		path = "/"
	}

	// Handle Claude's // prefix (absolute from filesystem root)
	if strings.HasPrefix(path, "//") {
		path = path[1:] // //Users/foo -> /Users/foo
	}

	// Handle ~/relative — expand to absolute first, then re-compress
	if strings.HasPrefix(path, "~/") || path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path, nil // Can't determine home, keep as-is
		}
		if path == "~" {
			return "~", nil
		}
		// Expand, clean, then it will be re-compressed below
		path = filepath.Join(home, path[2:])
	}

	// Must be absolute at this point
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("relative path %q cannot be normalized — use absolute path or ~/relative", path)
	}

	// Clean the path
	path = filepath.Clean(path)

	// Check if under home directory — convert to ~/relative
	home, err := os.UserHomeDir()
	if err != nil {
		return path, nil // Can't determine home, return absolute
	}
	home = filepath.Clean(home)

	if path == home {
		return "~", nil
	}
	if strings.HasPrefix(path, home+"/") {
		return "~/" + path[len(home)+1:], nil
	}

	// Not under home — return absolute
	return path, nil
}

// ExpandPath converts ClaudeFu's canonical storage format to a real filesystem path.
// Used for --add-dir CLI flags where Go's exec.Command needs a real path.
//
// Examples:
//
//	~/svml          -> /Users/jasdeep/svml
//	/mnt/external   -> /mnt/external
//	//mnt/external  -> /mnt/external
func ExpandPath(stored string) (string, error) {
	path := strings.TrimSpace(stored)
	if path == "" {
		return "", fmt.Errorf("empty path")
	}

	// Handle Claude's // prefix
	if strings.HasPrefix(path, "//") {
		return filepath.Clean(path[1:]), nil
	}

	// Handle ~/relative
	if strings.HasPrefix(path, "~/") || path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("cannot expand ~: %w", err)
		}
		if path == "~" {
			return home, nil
		}
		return filepath.Clean(filepath.Join(home, path[2:])), nil
	}

	// Already absolute or relative — clean and return
	return filepath.Clean(path), nil
}

// ToClaudeSettingsPath converts an absolute filesystem path to Claude Code's
// gitignore-style path syntax for settings.local.json.
//
// Examples:
//
//	/Users/jasdeep/svml -> ~/svml          (Claude understands ~)
//	/mnt/external       -> //mnt/external  (// = absolute in gitignore syntax)
func ToClaudeSettingsPath(absPath string) string {
	absPath = filepath.Clean(absPath)

	// Check if under home directory → use ~/relative
	home, err := os.UserHomeDir()
	if err == nil {
		home = filepath.Clean(home)
		if absPath == home {
			return "~"
		}
		if strings.HasPrefix(absPath, home+"/") {
			return "~/" + absPath[len(home)+1:]
		}
	}

	// Not under home → use // prefix (gitignore absolute syntax)
	// absPath already starts with /, so "/" + absPath = "//..."
	return "/" + absPath
}

// NormalizeDirectories normalizes a slice of paths, filtering out empties and errors.
func NormalizeDirectories(dirs []string) []string {
	var result []string
	seen := make(map[string]bool)
	for _, d := range dirs {
		normalized, err := NormalizePath(d)
		if err != nil || normalized == "" {
			continue
		}
		if !seen[normalized] {
			seen[normalized] = true
			result = append(result, normalized)
		}
	}
	return result
}
