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
	Hash    string   `json:"hash"`
	Short   string   `json:"short"`
	Subject string   `json:"subject"`
	Author  string   `json:"author"`
	Date    string   `json:"date"`
	Tags    []string `json:"tags,omitempty"`
}

// stdPrefixConfig pins the standard `a/`/`b/` diff path prefixes regardless
// of user git config. Users with diff.mnemonicPrefix (c/, w/, i/ prefixes) or
// diff.noprefix would otherwise produce patches that @pierre/diffs's patch
// parser on the frontend cannot match back to file paths.
var stdPrefixConfig = []string{"-c", "diff.mnemonicprefix=false", "-c", "diff.noprefix=false"}

// Diff runs `git diff` with the given arguments and returns the output as an io.Reader.
func Diff(ctx context.Context, dir string, args []string) (io.Reader, error) {
	cmdArgs := append([]string{}, stdPrefixConfig...)
	cmdArgs = append(cmdArgs, "diff", "--no-ext-diff", "--color=never")
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
	cmdArgs := append([]string{}, stdPrefixConfig...)
	cmdArgs = append(cmdArgs, "diff-tree", "-p", "--no-ext-diff", "--color=never", "-r", "--root", hash)
	cmd := exec.CommandContext(ctx, "git", cmdArgs...)
	cmd.Dir = dir

	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(out), nil
}

// Log returns the recent commit history.
func Log(ctx context.Context, dir string, maxCount int) ([]Commit, error) {
	// Format: hash<TAB>short<TAB>subject<TAB>author<TAB>date<TAB>refs
	format := "%H\t%h\t%s\t%an\t%ai\t%D"
	cmd := exec.CommandContext(ctx, "git", "log",
		"--format="+format,
		"--no-merges",
		"--decorate=full",
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
		parts := strings.SplitN(line, "\t", 6)
		if len(parts) < 5 {
			continue
		}
		c := Commit{
			Hash:    parts[0],
			Short:   parts[1],
			Subject: parts[2],
			Author:  parts[3],
			Date:    parts[4],
		}
		if len(parts) >= 6 {
			c.Tags = parseTags(parts[5])
		}
		commits = append(commits, c)
	}

	return commits, nil
}

// parseTags extracts tag names from `git log --decorate=full` ref output.
// Example input: "HEAD -> refs/heads/main, tag: refs/tags/v1.0.0, refs/remotes/origin/main"
func parseTags(refs string) []string {
	refs = strings.TrimSpace(refs)
	if refs == "" {
		return nil
	}
	var tags []string
	for _, ref := range strings.Split(refs, ",") {
		ref = strings.TrimSpace(ref)
		const prefix = "tag: refs/tags/"
		if strings.HasPrefix(ref, prefix) {
			tags = append(tags, strings.TrimPrefix(ref, prefix))
		}
	}
	return tags
}

// CurrentBranch returns the name of the currently checked-out branch.
// Returns "" (with nil error) when HEAD is detached.
func CurrentBranch(ctx context.Context, dir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "branch", "--show-current")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
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
	cmdArgs := append([]string{}, stdPrefixConfig...)
	cmdArgs = append(cmdArgs, "diff", "--no-ext-diff", "--color=never", "HEAD")
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

// ShowBlob returns the full contents of <ref>:<path> via `git show`.
// ref may be a commit hash or any rev (e.g. "HEAD", "HEAD^").
// Returns (nil, nil) when the object does not exist (e.g. file added in the
// commit so HEAD^:<path> is absent) so callers can treat "no blob" as a
// non-error condition.
func ShowBlob(ctx context.Context, dir string, ref string, path string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", "show", ref+":"+path)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		if _, ok := err.(*exec.ExitError); ok {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}
