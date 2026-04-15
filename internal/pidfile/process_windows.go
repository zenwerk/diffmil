//go:build windows

package pidfile

import "os"

func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Windows, FindProcess always succeeds; try to get exit code
	p.Release()
	return true
}
