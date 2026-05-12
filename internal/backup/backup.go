// Package backup persists per-port server state (e.g. workspace lists) to disk
// so it can be restored on the next launch.
package backup

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zenwerk/diffmil/internal/pidfile"
)

// State is the persisted, port-scoped server snapshot.
type State struct {
	Workspaces []WorkspaceEntry `json:"workspaces"`
}

// WorkspaceEntry is the on-disk representation of a tracked workspace.
type WorkspaceEntry struct {
	Dir string `json:"dir"`
}

// Path returns the absolute path to the backup file for the given port.
func Path(port int) string {
	return filepath.Join(pidfile.Dir(), fmt.Sprintf("workspaces-%d.json", port))
}

// Load reads the backup file for the given port. Returns an empty state when
// the file does not exist or cannot be parsed.
func Load(port int) State {
	var s State
	data, err := os.ReadFile(Path(port))
	if err != nil {
		return s
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return State{}
	}
	return s
}

// Save writes the backup file atomically (temp file + rename).
func Save(port int, s State) error {
	dir := pidfile.Dir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	path := Path(port)
	tmp, err := os.CreateTemp(dir, "workspaces-*.json.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, path)
}

// Remove deletes the backup file. Missing files are ignored.
func Remove(port int) error {
	err := os.Remove(Path(port))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
