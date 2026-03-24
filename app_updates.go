package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"
)

// UpdateInfo contains information about an available update
type UpdateInfo struct {
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	ReleaseNotes   string `json:"releaseNotes"`
	PublishedAt    string `json:"publishedAt"`
	DownloadURL    string `json:"downloadUrl"` // ZIP download URL
}

// GitHubRelease represents the GitHub API response for a release
type GitHubRelease struct {
	TagName     string         `json:"tag_name"`
	HTMLURL     string         `json:"html_url"`
	Body        string         `json:"body"`
	PublishedAt string         `json:"published_at"`
	Assets      []GitHubAsset  `json:"assets"`
}

// GitHubAsset represents a release asset from the GitHub API
type GitHubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// ChecksumsJSON represents the checksums.json release asset
type ChecksumsJSON struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

const (
	githubRepo        = "metaphori-ai/claudefu"
	githubReleasesAPI = "https://api.github.com/repos/%s/releases/latest"
	updatesDirName    = "updates"
	stagingDirName    = "staging"
)

// CheckForUpdates checks GitHub for a newer release
func (a *App) CheckForUpdates() (*UpdateInfo, error) {
	currentVersion := strings.TrimPrefix(strings.TrimSpace(embeddedVersion), "v")

	url := fmt.Sprintf(githubReleasesAPI, githubRepo)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "ClaudeFu/"+currentVersion)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
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
	updateAvailable := isNewerVersion(latestVersion, currentVersion)

	// Find the ZIP download URL from assets
	downloadURL := ""
	for _, asset := range release.Assets {
		if strings.HasSuffix(asset.Name, "-darwin-universal.zip") {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}

	return &UpdateInfo{
		Available:      updateAvailable,
		CurrentVersion: currentVersion,
		LatestVersion:  latestVersion,
		ReleaseURL:     release.HTMLURL,
		ReleaseNotes:   release.Body,
		PublishedAt:    release.PublishedAt,
		DownloadURL:    downloadURL,
	}, nil
}

// IsUpdateReady returns whether a staged update is ready to apply
func (a *App) IsUpdateReady() (bool, string) {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	return a.updateReady, a.updateVersion
}

// DownloadUpdate downloads and stages a new version for later application.
// Downloads ZIP from GitHub Releases, optionally verifies SHA256, extracts .app to staging.
func (a *App) DownloadUpdate(version string) error {
	a.updateMu.Lock()
	if a.updateReady && a.updateVersion == version {
		a.updateMu.Unlock()
		return nil // Already staged
	}
	a.updateMu.Unlock()

	configPath := a.settings.GetConfigPath()
	updatesDir := filepath.Join(configPath, updatesDirName)
	stagingDir := filepath.Join(updatesDir, stagingDirName)

	// Clean any previous staging
	os.RemoveAll(updatesDir)
	if err := os.MkdirAll(updatesDir, 0755); err != nil {
		return fmt.Errorf("failed to create updates directory: %w", err)
	}

	// Build download URL
	zipName := fmt.Sprintf("ClaudeFu-v%s-darwin-universal.zip", version)
	downloadURL := fmt.Sprintf("https://github.com/%s/releases/download/v%s/%s", githubRepo, version, zipName)

	fmt.Printf("[Update] Downloading %s\n", downloadURL)

	// Download ZIP
	zipPath := filepath.Join(updatesDir, zipName)
	if err := downloadFile(downloadURL, zipPath); err != nil {
		os.RemoveAll(updatesDir)
		return fmt.Errorf("download failed: %w", err)
	}

	// Try to verify SHA256 from checksums.json (optional — don't fail if missing)
	checksumsURL := fmt.Sprintf("https://github.com/%s/releases/download/v%s/checksums.json", githubRepo, version)
	if expectedSHA, err := fetchExpectedSHA256(checksumsURL); err == nil && expectedSHA != "" {
		actualSHA, err := fileSHA256(zipPath)
		if err != nil {
			os.RemoveAll(updatesDir)
			return fmt.Errorf("failed to compute checksum: %w", err)
		}
		if actualSHA != expectedSHA {
			os.RemoveAll(updatesDir)
			return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedSHA, actualSHA)
		}
		fmt.Printf("[Update] SHA256 verified: %s\n", actualSHA)
	} else {
		fmt.Printf("[Update] No checksums.json found, skipping SHA256 verification\n")
	}

	// Extract ZIP
	if err := os.MkdirAll(stagingDir, 0755); err != nil {
		os.RemoveAll(updatesDir)
		return fmt.Errorf("failed to create staging directory: %w", err)
	}

	fmt.Printf("[Update] Extracting to %s\n", stagingDir)
	if err := extractZip(zipPath, stagingDir); err != nil {
		os.RemoveAll(updatesDir)
		return fmt.Errorf("extraction failed: %w", err)
	}

	// Verify ClaudeFu.app exists in staging
	stagedApp := filepath.Join(stagingDir, "ClaudeFu.app")
	if _, err := os.Stat(stagedApp); os.IsNotExist(err) {
		os.RemoveAll(updatesDir)
		return fmt.Errorf("ClaudeFu.app not found in downloaded archive")
	}

	// Clean up ZIP (keep only the extracted .app)
	os.Remove(zipPath)

	// Mark update as ready
	a.updateMu.Lock()
	a.updateReady = true
	a.updateVersion = version
	a.updateMu.Unlock()

	fmt.Printf("[Update] v%s staged and ready to apply\n", version)

	// Update the menu to show "Restart to Update..."
	a.RefreshMenu()

	// Notify frontend
	wailsrt.EventsEmit(a.ctx, "update:ready", map[string]string{
		"version": version,
	})

	return nil
}

// ApplyUpdateAndRestart replaces the current .app bundle with the staged update and restarts.
func (a *App) ApplyUpdateAndRestart() error {
	a.updateMu.Lock()
	ready := a.updateReady
	version := a.updateVersion
	a.updateMu.Unlock()

	if !ready {
		return fmt.Errorf("no update staged")
	}

	configPath := a.settings.GetConfigPath()
	stagingDir := filepath.Join(configPath, updatesDirName, stagingDirName)
	stagedApp := filepath.Join(stagingDir, "ClaudeFu.app")

	// Verify staged app still exists
	if _, err := os.Stat(stagedApp); os.IsNotExist(err) {
		return fmt.Errorf("staged update not found at %s", stagedApp)
	}

	// Find current app location by walking up from the executable
	currentExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to find current executable: %w", err)
	}

	// Resolve symlinks (Homebrew creates symlinks)
	currentExe, err = filepath.EvalSymlinks(currentExe)
	if err != nil {
		return fmt.Errorf("failed to resolve executable path: %w", err)
	}

	// Navigate from .../ClaudeFu.app/Contents/MacOS/ClaudeFu to .../ClaudeFu.app
	currentApp := filepath.Dir(filepath.Dir(filepath.Dir(currentExe)))
	if !strings.HasSuffix(currentApp, ".app") {
		return fmt.Errorf("unexpected app bundle path: %s", currentApp)
	}

	// Check we have write permission
	appParent := filepath.Dir(currentApp)
	if err := checkDirWritable(appParent); err != nil {
		return fmt.Errorf("no write permission to %s: %w", appParent, err)
	}

	fmt.Printf("[Update] Replacing %s with v%s\n", currentApp, version)

	// Atomic swap: rename current → .old, rename staged → current
	backupApp := currentApp + ".old"

	// Remove any leftover backup from a previous update
	os.RemoveAll(backupApp)

	// Step 1: Move current app to backup
	if err := os.Rename(currentApp, backupApp); err != nil {
		return fmt.Errorf("failed to backup current app: %w", err)
	}

	// Step 2: Move staged app to current location
	if err := os.Rename(stagedApp, currentApp); err != nil {
		// Rollback: restore backup
		os.Rename(backupApp, currentApp)
		return fmt.Errorf("failed to install update (rolled back): %w", err)
	}

	// Step 3: Clean up backup and staging
	os.RemoveAll(backupApp)
	os.RemoveAll(filepath.Join(configPath, updatesDirName))

	fmt.Printf("[Update] v%s installed successfully, restarting...\n", version)

	// Step 4: Launch new binary and exit
	newExe := filepath.Join(currentApp, "Contents", "MacOS", "ClaudeFu")
	cmd := exec.Command(newExe)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Start()

	// Give the new process a moment to start
	time.Sleep(500 * time.Millisecond)
	os.Exit(0)

	return nil // Unreachable
}

// =============================================================================
// HELPERS
// =============================================================================

// downloadFile downloads a URL to a local file path
func downloadFile(url, destPath string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// fetchExpectedSHA256 downloads checksums.json and returns the expected SHA256
func fetchExpectedSHA256(url string) (string, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("checksums.json not found (HTTP %d)", resp.StatusCode)
	}

	var checksums ChecksumsJSON
	if err := json.NewDecoder(resp.Body).Decode(&checksums); err != nil {
		return "", err
	}

	return checksums.SHA256, nil
}

// fileSHA256 computes the SHA256 hash of a file
func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

// extractZip extracts a ZIP archive to a destination directory
func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		destPath := filepath.Join(destDir, f.Name)

		// Prevent zip slip vulnerability
		if !strings.HasPrefix(destPath, filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path in zip: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(destPath, f.Mode())
			continue
		}

		// Ensure parent directory exists
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return err
		}

		outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()
		if err != nil {
			return err
		}
	}

	return nil
}

// checkDirWritable verifies we can write to a directory
func checkDirWritable(dir string) error {
	testFile := filepath.Join(dir, ".claudefu-update-test")
	f, err := os.Create(testFile)
	if err != nil {
		return err
	}
	f.Close()
	os.Remove(testFile)
	return nil
}

// isNewerVersion compares semantic versions (simple comparison)
// Returns true if latest > current
func isNewerVersion(latest, current string) bool {
	latestParts := strings.Split(latest, ".")
	currentParts := strings.Split(current, ".")

	for len(latestParts) < 3 {
		latestParts = append(latestParts, "0")
	}
	for len(currentParts) < 3 {
		currentParts = append(currentParts, "0")
	}

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

	return false
}

// parseVersionPart extracts the numeric portion of a version part
func parseVersionPart(part string) int {
	var num int
	fmt.Sscanf(part, "%d", &num)
	return num
}
