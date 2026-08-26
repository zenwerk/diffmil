package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// initRepo initialises an empty git repository in a temp dir and returns its path.
func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	cmd := exec.Command("git", "init", "-q", "-b", "main")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	return dir
}

func TestGitDirFromRepoRoot(t *testing.T) {
	dir := initRepo(t)

	got, err := GitDir(context.Background(), dir)
	if err != nil {
		t.Fatalf("GitDir: %v", err)
	}
	// Compare via EvalSymlinks: macOS TempDir lives under /var -> /private/var.
	want, _ := filepath.EvalSymlinks(filepath.Join(dir, ".git"))
	gotResolved, _ := filepath.EvalSymlinks(got)
	if gotResolved != want {
		t.Errorf("GitDir = %q, want %q", gotResolved, want)
	}
}

func TestGitDirFromSubdirectory(t *testing.T) {
	dir := initRepo(t)
	sub := filepath.Join(dir, "docker")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := GitDir(context.Background(), sub)
	if err != nil {
		t.Fatalf("GitDir from subdir: %v", err)
	}
	want, _ := filepath.EvalSymlinks(filepath.Join(dir, ".git"))
	gotResolved, _ := filepath.EvalSymlinks(got)
	if gotResolved != want {
		t.Errorf("GitDir = %q, want %q", gotResolved, want)
	}
}

func TestGitDirOutsideRepo(t *testing.T) {
	dir := t.TempDir()
	if _, err := GitDir(context.Background(), dir); err == nil {
		t.Error("expected error outside a git repository")
	}
}

func TestOutputWrapsStderr(t *testing.T) {
	dir := initRepo(t)

	_, err := DiffShow(context.Background(), dir, "deadbeef")
	if err == nil {
		t.Fatal("expected error for unknown object")
	}
	msg := err.Error()
	if !strings.Contains(msg, "deadbeef") {
		t.Errorf("error %q should contain the failing command line", msg)
	}
	if !strings.Contains(msg, "fatal:") {
		t.Errorf("error %q should contain git's stderr output", msg)
	}
}
