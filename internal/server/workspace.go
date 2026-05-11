package server

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"time"
)

// Workspace represents a single git repository directory tracked by the server.
type Workspace struct {
	ID      string    `json:"id"`
	Dir     string    `json:"dir"`
	Label   string    `json:"label"`
	AddedAt time.Time `json:"addedAt"`
}

// workspaceID returns a stable short identifier for an absolute path.
func workspaceID(absPath string) string {
	h := sha256.Sum256([]byte(absPath))
	return hex.EncodeToString(h[:])[:8]
}

// newWorkspace builds a Workspace value for the given absolute directory path.
func newWorkspace(dir string) Workspace {
	return Workspace{
		ID:      workspaceID(dir),
		Dir:     dir,
		Label:   filepath.Base(dir),
		AddedAt: time.Now(),
	}
}
