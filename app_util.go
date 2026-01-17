package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

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

// GetVersion returns the application version from the VERSION file
func (a *App) GetVersion() string {
	// Try to read embedded version file, fall back to reading from disk
	versionFile := "VERSION"
	data, err := os.ReadFile(versionFile)
	if err != nil {
		// Try relative to executable
		return "0.0.0"
	}
	return strings.TrimSpace(string(data))
}
