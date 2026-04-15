package git

import (
	"bytes"
	"context"
	"io"
	"os/exec"
)

// Diff runs `git diff` with the given arguments and returns the output as an io.Reader.
func Diff(ctx context.Context, dir string, args []string) (io.Reader, error) {
	cmdArgs := []string{"diff", "--no-ext-diff", "--color=never"}
	cmdArgs = append(cmdArgs, args...)

	cmd := exec.CommandContext(ctx, "git", cmdArgs...)
	cmd.Dir = dir

	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(out), nil
}

// IsGitRepo returns true if the given directory is inside a git repository.
func IsGitRepo(dir string) bool {
	cmd := exec.Command("git", "rev-parse", "--is-inside-work-tree")
	cmd.Dir = dir
	return cmd.Run() == nil
}
