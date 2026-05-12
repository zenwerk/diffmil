package server

import (
	"testing"
)

func TestWorkspaceIDStability(t *testing.T) {
	// Same input should always produce the same ID.
	got1 := workspaceID("/abs/path/repo")
	got2 := workspaceID("/abs/path/repo")
	if got1 != got2 {
		t.Fatalf("workspaceID not deterministic: %q vs %q", got1, got2)
	}
	if len(got1) != 8 {
		t.Fatalf("workspaceID length = %d, want 8", len(got1))
	}
}

func TestWorkspaceIDDistinct(t *testing.T) {
	a := workspaceID("/abs/path/a")
	b := workspaceID("/abs/path/b")
	if a == b {
		t.Fatalf("different paths produced identical IDs: %q", a)
	}
}

func TestNewWorkspaceFields(t *testing.T) {
	ws := newWorkspace("/abs/path/foo")
	if ws.Dir != "/abs/path/foo" {
		t.Errorf("Dir = %q, want %q", ws.Dir, "/abs/path/foo")
	}
	if ws.Label != "foo" {
		t.Errorf("Label = %q, want %q", ws.Label, "foo")
	}
	if ws.ID == "" || len(ws.ID) != 8 {
		t.Errorf("ID = %q, want 8-char hex", ws.ID)
	}
	if ws.AddedAt.IsZero() {
		t.Error("AddedAt should be set")
	}
}
