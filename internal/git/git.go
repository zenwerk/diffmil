package git

import (
	"bytes"
	"context"
	"io"
	"os/exec"
	"strconv"
	"strings"
)

// Commit represents a single git commit.
type Commit struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	Date    string `json:"date"`
}

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

// DiffShow runs `git diff-tree -p` for a single commit to get its diff.
func DiffShow(ctx context.Context, dir string, hash string) (io.Reader, error) {
	cmd := exec.CommandContext(ctx, "git", "diff-tree", "-p", "--no-ext-diff", "--color=never", "-r", "--root", hash)
	cmd.Dir = dir

	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(out), nil
}

// Log returns the recent commit history.
func Log(ctx context.Context, dir string, maxCount int) ([]Commit, error) {
	// Format: hash<TAB>short<TAB>subject<TAB>author<TAB>date
	format := "%H\t%h\t%s\t%an\t%ai"
	cmd := exec.CommandContext(ctx, "git", "log",
		"--format="+format,
		"--no-merges",
		"-n", strconv.Itoa(maxCount),
	)
	cmd.Dir = dir

	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var commits []Commit
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 5)
		if len(parts) < 5 {
			continue
		}
		commits = append(commits, Commit{
			Hash:    parts[0],
			Short:   parts[1],
			Subject: parts[2],
			Author:  parts[3],
			Date:    parts[4],
		})
	}

	return commits, nil
}

// HasUncommittedChanges returns true if there are uncommitted changes (staged, unstaged, or untracked).
func HasUncommittedChanges(ctx context.Context, dir string) bool {
	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return len(strings.TrimSpace(string(out))) > 0
}

// DiffUncommitted returns the diff of uncommitted changes against HEAD.
func DiffUncommitted(ctx context.Context, dir string) (io.Reader, error) {
	cmd := exec.CommandContext(ctx, "git", "diff", "--no-ext-diff", "--color=never", "HEAD")
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

