package main

import (
	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"
)

// =============================================================================
// DIALOG WRAPPERS (Go-only runtime functions exposed to frontend)
// =============================================================================

// SelectDirectory opens a directory picker dialog
func (a *App) SelectDirectory(title string) (string, error) {
	return wailsrt.OpenDirectoryDialog(a.ctx, wailsrt.OpenDialogOptions{
		Title: title,
	})
}

// SelectFile opens a file picker dialog
func (a *App) SelectFile(title string) (string, error) {
	return wailsrt.OpenFileDialog(a.ctx, wailsrt.OpenDialogOptions{
		Title: title,
	})
}

// SaveFile opens a save file dialog
func (a *App) SaveFile(defaultFilename string) (string, error) {
	return wailsrt.SaveFileDialog(a.ctx, wailsrt.SaveDialogOptions{
		DefaultFilename: defaultFilename,
	})
}

// ConfirmDialog shows a confirmation dialog
func (a *App) ConfirmDialog(title, message string) (bool, error) {
	result, err := wailsrt.MessageDialog(a.ctx, wailsrt.MessageDialogOptions{
		Type:    wailsrt.QuestionDialog,
		Title:   title,
		Message: message,
	})
	return result == "Yes", err
}

// AlertDialog shows an info alert dialog
func (a *App) AlertDialog(title, message string) error {
	_, err := wailsrt.MessageDialog(a.ctx, wailsrt.MessageDialogOptions{
		Type:    wailsrt.InfoDialog,
		Title:   title,
		Message: message,
	})
	return err
}
