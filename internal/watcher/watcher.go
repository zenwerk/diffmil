package watcher

import (
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	gitcmd "github.com/zenwerk/diffmil/internal/git"
)

// GitWatcher monitors a git repository for changes and calls onChange
// when commits, HEAD, or the index changes.
type GitWatcher struct {
	watcher  *fsnotify.Watcher
	onChange func()
	done     chan struct{}
}

// New creates a GitWatcher for the given repository directory.
// onChange is called (debounced) when git state changes are detected.
func New(repoDir string, onChange func()) (*GitWatcher, error) {
	// Resolve the real .git location: repoDir may be a subdirectory of the
	// repository (registered via `diffmil` run from a subdir) or a linked
	// worktree, where repoDir/.git does not exist or is a file.
	gitDir, err := gitcmd.GitDir(context.Background(), repoDir)
	if err != nil {
		return nil, err
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	// Watch .git directory for HEAD, index, refs changes
	if err := w.Add(gitDir); err != nil {
		w.Close()
		return nil, err
	}

	// Watch refs/heads for new commits on branches
	refsHeads := filepath.Join(gitDir, "refs", "heads")
	if err := w.Add(refsHeads); err != nil {
		// Not fatal — bare repos or fresh repos may not have this dir yet
		slog.Debug("could not watch refs/heads", "error", err)
	}

	gw := &GitWatcher{
		watcher:  w,
		onChange: onChange,
		done:     make(chan struct{}),
	}

	go gw.loop()
	return gw, nil
}

func (gw *GitWatcher) loop() {
	defer close(gw.done)

	// Debounce: git operations often write multiple files in quick succession
	var debounceTimer *time.Timer
	const debounceDelay = 500 * time.Millisecond

	fire := func() {
		if debounceTimer != nil {
			debounceTimer.Stop()
			debounceTimer.Reset(debounceDelay)
		} else {
			debounceTimer = time.AfterFunc(debounceDelay, gw.onChange)
		}
	}

	for {
		select {
		case event, ok := <-gw.watcher.Events:
			if !ok {
				return
			}
			if isGitStateChange(event) {
				fire()
			}
		case _, ok := <-gw.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

// isGitStateChange returns true if the event indicates a meaningful
// git state change (new commit, HEAD change, index update, etc.)
func isGitStateChange(event fsnotify.Event) bool {
	if event.Op&(fsnotify.Write|fsnotify.Create) == 0 {
		return false
	}

	name := filepath.Base(event.Name)

	if name == "HEAD" {
		return true
	}

	if name == "COMMIT_EDITMSG" {
		return true
	}

	// refs/heads/<branch> updated (new commit pushed/created)
	if strings.Contains(event.Name, filepath.Join("refs", "heads")) {
		return true
	}

	return false
}

// Close stops the watcher.
func (gw *GitWatcher) Close() error {
	err := gw.watcher.Close()
	<-gw.done
	return err
}
