package main

import (
	"bufio"
	"embed"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"claudefu/internal/settings"
	"claudefu/internal/workspace"
)

// CLIArgs holds resolved command-line arguments (after interactive prompts)
type CLIArgs struct {
	Folder      string // Absolute path to folder to add as agent
	WorkspaceID string // Resolved workspace ID to add to
}

//go:embed all:frontend/dist
var assets embed.FS

func parseCLIArgs() *CLIArgs {
	wsName := flag.String("workspace", "", "Target workspace name")
	flag.Parse()

	args := flag.Args()
	if len(args) == 0 {
		return nil
	}

	// Resolve folder to absolute path
	folder := args[0]
	absFolder, err := filepath.Abs(folder)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving path: %v\n", err)
		return nil
	}
	info, err := os.Stat(absFolder)
	if err != nil || !info.IsDir() {
		fmt.Fprintf(os.Stderr, "Error: %q is not a valid directory\n", absFolder)
		return nil
	}

	// Load workspace manager to enumerate workspaces
	sm, err := settings.NewManager()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading settings: %v\n", err)
		return nil
	}
	wm := workspace.NewManager(sm.GetConfigPath())
	allWS, err := wm.GetAllWorkspaces()
	if err != nil || len(allWS) == 0 {
		fmt.Fprintf(os.Stderr, "Error: no workspaces found\n")
		return nil
	}

	// Sort alphabetically
	sort.Slice(allWS, func(i, j int) bool {
		return strings.ToLower(allWS[i].Name) < strings.ToLower(allWS[j].Name)
	})

	var selectedID string

	// Try --workspace flag first (case-insensitive match)
	if *wsName != "" {
		nameLower := strings.ToLower(*wsName)
		for _, ws := range allWS {
			if strings.ToLower(ws.Name) == nameLower {
				selectedID = ws.ID
				break
			}
		}
		if selectedID != "" {
			// Matched — skip interactive prompt
		} else {
			fmt.Fprintf(os.Stderr, "No workspace named %q, please select:\n", *wsName)
		}
	}

	if selectedID == "" && len(allWS) == 1 {
		// Only one workspace — use it automatically
		selectedID = allWS[0].ID
		fmt.Printf("Adding to workspace: %s\n", allWS[0].Name)
	}

	if selectedID == "" {
		// Interactive terminal prompt
		fmt.Printf("\nWhich workspace would you like to add this to:\n")
		for i, ws := range allWS {
			fmt.Printf("  %d) %s\n", i+1, ws.Name)
		}
		fmt.Print("\nSelect workspace: ")

		reader := bufio.NewReader(os.Stdin)
		input, err := reader.ReadString('\n')
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading input: %v\n", err)
			return nil
		}
		input = strings.TrimSpace(input)
		num, err := strconv.Atoi(input)
		if err != nil || num < 1 || num > len(allWS) {
			fmt.Fprintf(os.Stderr, "Invalid selection\n")
			return nil
		}
		selectedID = allWS[num-1].ID
	}

	return &CLIArgs{
		Folder:      absFolder,
		WorkspaceID: selectedID,
	}
}

func main() {
	// Parse CLI args before Wails starts (e.g., `claudefu .` or `claudefu /path --workspace "name"`)
	cliArgs := parseCLIArgs()

	// Create an instance of the app structure
	app := NewApp()
	app.cliArgs = cliArgs

	// Create application with options
	err := wails.Run(&options.App{
		Title:            "ClaudeFu",
		Width:            1024,
		Height:           768,
		WindowStartState: options.Maximised,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Menu:             app.GetMenu(),
		Mac: &mac.Options{
			About: &mac.AboutInfo{
				Title:   "ClaudeFu",
				Message: "Multi-Claude Code Orchestration\n\nVersion " + GetVersionString(),
			},
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
