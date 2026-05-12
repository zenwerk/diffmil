package backup

import (
	"os"
	"path/filepath"
	"testing"
)

func setStateHome(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", dir)
}

func TestLoadMissing(t *testing.T) {
	setStateHome(t)
	got := Load(8080)
	if len(got.Workspaces) != 0 {
		t.Errorf("expected empty state, got %+v", got)
	}
}

func TestSaveAndLoadRoundtrip(t *testing.T) {
	setStateHome(t)
	want := State{
		Workspaces: []WorkspaceEntry{
			{Dir: "/abs/path/a", Label: "alpha"},
			{Dir: "/abs/path/b"},
		},
	}
	if err := Save(8080, want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got := Load(8080)
	if len(got.Workspaces) != len(want.Workspaces) {
		t.Fatalf("len = %d, want %d", len(got.Workspaces), len(want.Workspaces))
	}
	for i, w := range want.Workspaces {
		if got.Workspaces[i] != w {
			t.Errorf("entry[%d] = %+v, want %+v", i, got.Workspaces[i], w)
		}
	}
}

func TestSaveAtomicNoTempLeftover(t *testing.T) {
	setStateHome(t)
	s := State{Workspaces: []WorkspaceEntry{{Dir: "/x"}}}
	if err := Save(9999, s); err != nil {
		t.Fatalf("Save: %v", err)
	}
	dir := filepath.Dir(Path(9999))
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Errorf("leftover temp file: %s", e.Name())
		}
	}
}

func TestLoadCorruptedFallsBackToEmpty(t *testing.T) {
	setStateHome(t)
	dir := filepath.Dir(Path(8080))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(Path(8080), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := Load(8080)
	if len(got.Workspaces) != 0 {
		t.Errorf("expected empty fallback, got %+v", got)
	}
}

func TestRemove(t *testing.T) {
	setStateHome(t)
	if err := Save(8080, State{Workspaces: []WorkspaceEntry{{Dir: "/x"}}}); err != nil {
		t.Fatal(err)
	}
	if err := Remove(8080); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(Path(8080)); !os.IsNotExist(err) {
		t.Errorf("file should be removed, stat err = %v", err)
	}
	// Removing again should be a no-op.
	if err := Remove(8080); err != nil {
		t.Errorf("removing absent file should be no-op, got %v", err)
	}
}
