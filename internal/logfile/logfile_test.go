package logfile

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewRotatingWriter(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")

	w, err := newRotatingWriter(filename, 1024, 3)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	if w.size != 0 {
		t.Errorf("initial size = %d, want 0", w.size)
	}

	data := []byte("hello\n")
	n, err := w.Write(data)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if n != len(data) {
		t.Errorf("Write returned %d, want %d", n, len(data))
	}
	if w.size != int64(len(data)) {
		t.Errorf("size after write = %d, want %d", w.size, len(data))
	}
}

func TestNewRotatingWriterResumesSize(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")

	if err := os.WriteFile(filename, []byte("existing content\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	w, err := newRotatingWriter(filename, 1024, 3)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	if w.size == 0 {
		t.Error("expected non-zero initial size for pre-existing file")
	}
}

func TestRotation(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")
	maxSize := int64(50)

	w, err := newRotatingWriter(filename, maxSize, 2)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	line := strings.Repeat("x", 30) + "\n"
	for range 3 {
		if _, err := w.Write([]byte(line)); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}

	if _, err := os.Stat(filename + ".1"); err != nil {
		t.Errorf("expected backup .1 to exist: %v", err)
	}

	info, err := os.Stat(filename)
	if err != nil {
		t.Fatalf("stat current file: %v", err)
	}
	if info.Size() > maxSize {
		t.Errorf("current file size %d exceeds maxSize %d", info.Size(), maxSize)
	}
}

func TestRotationShiftsBackups(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "test.log")
	maxSize := int64(20)
	maxBackups := 2

	w, err := newRotatingWriter(filename, maxSize, maxBackups)
	if err != nil {
		t.Fatalf("newRotatingWriter: %v", err)
	}
	defer w.Close()

	line := strings.Repeat("a", 21) + "\n"
	for range 5 {
		if _, err := w.Write([]byte(line)); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}

	if _, err := os.Stat(filename + ".1"); err != nil {
		t.Errorf("expected .1 backup: %v", err)
	}
	if _, err := os.Stat(filename + ".2"); err != nil {
		t.Errorf("expected .2 backup: %v", err)
	}
	if _, err := os.Stat(filename + ".3"); !os.IsNotExist(err) {
		t.Error("expected .3 backup to not exist")
	}
}

func TestCleanOldLogs(t *testing.T) {
	dir := t.TempDir()

	oldFile := filepath.Join(dir, "diffmil-1234.log")
	if err := os.WriteFile(oldFile, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-10 * 24 * time.Hour)
	if err := os.Chtimes(oldFile, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	recentFile := filepath.Join(dir, "diffmil-5678.log")
	if err := os.WriteFile(recentFile, []byte("recent"), 0o600); err != nil {
		t.Fatal(err)
	}

	otherFile := filepath.Join(dir, "other.txt")
	if err := os.WriteFile(otherFile, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(otherFile, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	cleanOldLogs(dir, 7*24*time.Hour)

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Error("expected old log file to be removed")
	}
	if _, err := os.Stat(recentFile); err != nil {
		t.Error("expected recent log file to remain")
	}
	if _, err := os.Stat(otherFile); err != nil {
		t.Error("expected non-log file to remain")
	}
}

func TestSetupDefaultPath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", dir)

	cleanup, path, err := Setup(Options{Port: 19999, Level: slog.LevelInfo})
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	cleanup()

	want := filepath.Join(dir, "diffmil", "log", "diffmil-19999.log")
	if path != want {
		t.Errorf("path = %q, want %q", path, want)
	}
	if _, err := os.Stat(want); err != nil {
		t.Errorf("expected log file to be created: %v", err)
	}
}

func TestSetupCustomPath(t *testing.T) {
	dir := t.TempDir()
	custom := filepath.Join(dir, "nested", "custom.log")

	cleanup, path, err := Setup(Options{Port: 19999, Level: slog.LevelInfo, Path: custom})
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	cleanup()

	if path != custom {
		t.Errorf("path = %q, want %q", path, custom)
	}
	if _, err := os.Stat(custom); err != nil {
		t.Errorf("expected custom log file to be created: %v", err)
	}
}

func TestSetupDisabled(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", dir)

	cleanup, path, err := Setup(Options{Port: 19999, Level: slog.LevelInfo, Disabled: true})
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	cleanup()

	if path != "" {
		t.Errorf("path = %q, want empty for disabled logging", path)
	}
	if _, err := os.Stat(DefaultPath(19999)); !os.IsNotExist(err) {
		t.Error("expected no log file to be created when disabled")
	}
}

func TestParseLevel(t *testing.T) {
	for in, want := range map[string]slog.Level{
		"debug": slog.LevelDebug,
		"info":  slog.LevelInfo,
		"WARN":  slog.LevelWarn,
		"error": slog.LevelError,
	} {
		got, err := ParseLevel(in)
		if err != nil {
			t.Errorf("ParseLevel(%q): %v", in, err)
		}
		if got != want {
			t.Errorf("ParseLevel(%q) = %v, want %v", in, got, want)
		}
	}
	if _, err := ParseLevel("verbose"); err == nil {
		t.Error("expected error for invalid level")
	}
}

func TestCleanOldLogsNonexistentDir(t *testing.T) {
	// Should not panic on nonexistent directory
	cleanOldLogs("/nonexistent/path/that/does/not/exist", time.Hour)
}
