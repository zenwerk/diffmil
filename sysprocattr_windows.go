//go:build windows

package main

import "os/exec"

func setSysProcAttr(_ *exec.Cmd) {
	// On Windows, child processes are independent by default.
}
