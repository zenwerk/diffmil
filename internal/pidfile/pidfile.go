package pidfile

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Dir returns the directory for storing PID files.
func Dir() string {
	if xdg := os.Getenv("XDG_STATE_HOME"); xdg != "" {
		return filepath.Join(xdg, "diffmil")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "diffmil")
	}
	return filepath.Join(home, ".local", "state", "diffmil")
}

// Write creates a PID file for the given port.
func Write(port int) error {
	dir := Dir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, fmt.Sprintf("diffmil-%d.pid", port))
	return os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0o644)
}

// Remove deletes the PID file for the given port.
func Remove(port int) {
	path := filepath.Join(Dir(), fmt.Sprintf("diffmil-%d.pid", port))
	os.Remove(path)
}

// DiscoverPorts scans the PID file directory and returns all ports
// that have a PID file whose process is still alive.
func DiscoverPorts() []int {
	dir := Dir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	var ports []int
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "diffmil-") || !strings.HasSuffix(name, ".pid") {
			continue
		}
		raw := strings.TrimSuffix(strings.TrimPrefix(name, "diffmil-"), ".pid")
		p, err := strconv.Atoi(raw)
		if err != nil {
			continue
		}

		// Check if process is still alive
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil {
			continue
		}
		if !processAlive(pid) {
			// Stale PID file, clean up
			os.Remove(filepath.Join(dir, name))
			continue
		}

		ports = append(ports, p)
	}
	sort.Ints(ports)
	return ports
}
