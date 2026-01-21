package main

import (
	_ "embed"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed VERSION
var embeddedVersion string

// =============================================================================
// UTILITY METHODS (Bound to frontend)
// =============================================================================

// ReadImageAsDataURL reads an image file and returns it as a base64 data URL
func (a *App) ReadImageAsDataURL(filePath string) (string, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read image: %w", err)
	}

	// Determine MIME type from file extension
	ext := strings.ToLower(filepath.Ext(filePath))
	mimeType := "image/jpeg" // default
	switch ext {
	case ".png":
		mimeType = "image/png"
	case ".gif":
		mimeType = "image/gif"
	case ".webp":
		mimeType = "image/webp"
	case ".svg":
		mimeType = "image/svg+xml"
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded), nil
}

// =============================================================================
// VERSION METHODS (Bound to frontend)
// =============================================================================

// GetVersion returns the application version (embedded at build time)
func (a *App) GetVersion() string {
	return strings.TrimSpace(embeddedVersion)
}

// GetVersionString returns the version as a standalone function (for use in main.go)
func GetVersionString() string {
	return strings.TrimSpace(embeddedVersion)
}
