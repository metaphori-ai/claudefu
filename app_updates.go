package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// UpdateInfo contains information about an available update
type UpdateInfo struct {
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	ReleaseNotes   string `json:"releaseNotes"`
	PublishedAt    string `json:"publishedAt"`
}

// GitHubRelease represents the GitHub API response for a release
type GitHubRelease struct {
	TagName     string `json:"tag_name"`
	HTMLURL     string `json:"html_url"`
	Body        string `json:"body"`
	PublishedAt string `json:"published_at"`
}

const (
	githubRepo       = "metaphori-ai/claudefu"
	githubReleasesAPI = "https://api.github.com/repos/%s/releases/latest"
)

// CheckForUpdates checks GitHub for a newer release
func (a *App) CheckForUpdates() (*UpdateInfo, error) {
	currentVersion := strings.TrimPrefix(strings.TrimSpace(embeddedVersion), "v")

	// Fetch latest release from GitHub
	url := fmt.Sprintf(githubReleasesAPI, githubRepo)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// GitHub API requires User-Agent
	req.Header.Set("User-Agent", "ClaudeFu/"+currentVersion)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// No releases yet, or rate limited - not an error for the user
		return &UpdateInfo{
			Available:      false,
			CurrentVersion: currentVersion,
			LatestVersion:  currentVersion,
		}, nil
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("failed to parse release: %w", err)
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")

	// Compare versions
	updateAvailable := isNewerVersion(latestVersion, currentVersion)

	return &UpdateInfo{
		Available:      updateAvailable,
		CurrentVersion: currentVersion,
		LatestVersion:  latestVersion,
		ReleaseURL:     release.HTMLURL,
		ReleaseNotes:   release.Body,
		PublishedAt:    release.PublishedAt,
	}, nil
}

// isNewerVersion compares semantic versions (simple comparison)
// Returns true if latest > current
func isNewerVersion(latest, current string) bool {
	// Split into parts
	latestParts := strings.Split(latest, ".")
	currentParts := strings.Split(current, ".")

	// Pad to same length
	for len(latestParts) < 3 {
		latestParts = append(latestParts, "0")
	}
	for len(currentParts) < 3 {
		currentParts = append(currentParts, "0")
	}

	// Compare each part
	for i := 0; i < 3; i++ {
		l := parseVersionPart(latestParts[i])
		c := parseVersionPart(currentParts[i])

		if l > c {
			return true
		}
		if l < c {
			return false
		}
	}

	return false // Equal versions
}

// parseVersionPart extracts the numeric portion of a version part
func parseVersionPart(part string) int {
	// Handle parts like "14-beta" by taking just the number
	var num int
	fmt.Sscanf(part, "%d", &num)
	return num
}
