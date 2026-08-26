package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"time"

	"github.com/pkg/browser"
	"github.com/zenwerk/diffmil/internal/backup"
	"github.com/zenwerk/diffmil/internal/diff"
	gitcmd "github.com/zenwerk/diffmil/internal/git"
	"github.com/zenwerk/diffmil/internal/logfile"
	"github.com/zenwerk/diffmil/internal/mdns"
	"github.com/zenwerk/diffmil/internal/pidfile"
	"github.com/zenwerk/diffmil/internal/server"
	"github.com/zenwerk/diffmil/internal/watcher"
)

func main() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, `diffmil - AI diff review tool

Usage:
  diffmil [options] [git-diff-args...]    Start server and view diff in browser
  diffmil [options] --status              Show running server(s)
  diffmil [options] --shutdown            Stop server
  diffmil [options] --restart             Restart server
  cat patch.diff | diffmil [options]      View diff from stdin

Examples:
  diffmil                                 View uncommitted changes
  diffmil HEAD~3..HEAD                    View diff between commits
  diffmil main..feature-branch            View branch diff
  diffmil --status                        List all running servers
  diffmil --shutdown --all                Stop all servers
  diffmil --port 3000                     Use custom port
  diffmil --mdns                          Advertise difmil.local on the LAN
  diffmil --mdns --mdns-host myhost       Advertise myhost.local instead
  sudo diffmil --mdns --port 80           Serve on port 80 (requires root)

Notes:
  --mdns advertises <mdns-host>.local on the LAN so other devices can reach
  the server without knowing your IP. Access via http://<mdns-host>.local:<port>.
  Ports below 1024 (e.g. 80) are privileged and require root, so to drop the
  ":port" suffix you must run diffmil with sudo. For everyday use, the default
  http://difmil.local:8765 is recommended.

Options:
`)
		flag.PrintDefaults()
	}

	port := flag.Int("port", 8765, "server port")
	noOpen := flag.Bool("no-open", false, "don't open browser")
	foreground := flag.Bool("foreground", false, "run server in foreground (don't daemonize)")
	doStatus := flag.Bool("status", false, "show status of running server(s)")
	doShutdown := flag.Bool("shutdown", false, "shut down running server(s)")
	doRestart := flag.Bool("restart", false, "restart running server")
	all := flag.Bool("all", false, "apply to all running servers (with --shutdown or --status)")
	enableMDNS := flag.Bool("mdns", false, "advertise <mdns-host>.local on the LAN via mDNS")
	mdnsHost := flag.String("mdns-host", mdns.DefaultHostname, "mDNS hostname (without .local suffix)")
	logLevel := flag.String("log-level", "info", "log level: debug, info, warn, or error")
	logFile := flag.String("log-file", "", "log file path (default: <state-dir>/log/diffmil-<port>.log)")
	noLog := flag.Bool("no-log", false, "disable log file output")
	flag.Parse()

	opts := runOptions{
		port:       *port,
		noOpen:     *noOpen,
		enableMDNS: *enableMDNS,
		mdnsHost:   *mdnsHost,
		logLevel:   *logLevel,
		logFile:    *logFile,
		noLog:      *noLog,
	}

	// Handle control commands
	if *doStatus {
		if *all || !portExplicitlySet() {
			runStatusAll()
		} else {
			runStatus(fmt.Sprintf("http://localhost:%d", *port))
		}
		return
	}
	if *doShutdown {
		if *all {
			runShutdownAll()
		} else {
			runShutdown(fmt.Sprintf("http://localhost:%d", *port))
		}
		return
	}
	if *doRestart {
		runRestart(fmt.Sprintf("http://localhost:%d", *port))
		return
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	cfg, err := buildConfig(ctx, flag.Args())
	if err != nil {
		log.Fatal(err)
	}

	url := fmt.Sprintf("http://localhost:%d", *port)

	if probeServer(url) {
		if cfg.RepoDir != "" {
			ws, err := postWorkspace(url, cfg.RepoDir)
			if err != nil {
				log.Fatalf("failed to register workspace: %v", err)
			}
			fmt.Fprintf(os.Stderr, "diffmil: registered workspace %q on existing server at %s\n", ws.Label, url)
		} else {
			if err := postDiff(url, cfg.InitialDiff); err != nil {
				log.Fatalf("failed to send diff to existing server: %v", err)
			}
			fmt.Fprintf(os.Stderr, "diffmil: sent diff to existing server at %s\n", url)
		}
		return
	}

	if !*foreground {
		pid, err := spawnBackground(opts)
		if err != nil {
			log.Fatal(err)
		}

		if err := waitForReady(url, 10*time.Second); err != nil {
			log.Fatalf("server failed to start (pid %d): %v", pid, err)
		}

		fmt.Fprintf(os.Stderr, "diffmil: serving at %s (pid %d)\n", url, pid)

		if !*noOpen {
			if err := browser.OpenURL(url); err != nil {
				log.Printf("could not open browser: %v", err)
			}
		}
		return
	}

	// Foreground mode
	runForeground(ctx, cancel, cfg, opts)
}

// runOptions carries the server-mode CLI flags. Log settings must survive
// both daemonization (spawnBackground) and self-restart, so everything here
// is propagated to child-process args.
type runOptions struct {
	port       int
	noOpen     bool
	enableMDNS bool
	mdnsHost   string
	logLevel   string
	logFile    string
	noLog      bool
}

// serverArgs renders the options as CLI args for spawned server processes.
func (o runOptions) serverArgs() []string {
	args := []string{
		"--port", fmt.Sprintf("%d", o.port),
		"--foreground",
		"--no-open",
		"--log-level", o.logLevel,
	}
	if o.enableMDNS {
		args = append(args, "--mdns", "--mdns-host", o.mdnsHost)
	}
	if o.logFile != "" {
		args = append(args, "--log-file", o.logFile)
	}
	if o.noLog {
		args = append(args, "--no-log")
	}
	return args
}

// portExplicitlySet returns true if --port was explicitly passed on the command line.
func portExplicitlySet() bool {
	found := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "port" {
			found = true
		}
	})
	return found
}

func runForeground(ctx context.Context, cancel context.CancelFunc, cfg server.Config, opts runOptions) {
	port := opts.port

	// Set up file logging first so everything below (including handler
	// errors once the server is up) lands in the log file.
	if opts.noLog && opts.logFile != "" {
		fmt.Fprintln(os.Stderr, "diffmil: warning: --no-log takes precedence over --log-file")
	}
	level, err := logfile.ParseLevel(opts.logLevel)
	if err != nil {
		log.Fatal(err)
	}
	logCleanup, logPath, err := logfile.Setup(logfile.Options{
		Port:     port,
		Level:    level,
		Path:     opts.logFile,
		Disabled: opts.noLog,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "diffmil: warning: file logging disabled: %v\n", err)
		logCleanup, _, _ = logfile.Setup(logfile.Options{Level: level, Disabled: true})
	}
	defer logCleanup()
	cfg.LogPath = logPath

	handler, state := server.New(cfg)

	if err := pidfile.Write(port); err != nil {
		slog.Warn("failed to write PID file", "error", err)
	}
	defer pidfile.Remove(port)

	if opts.enableMDNS {
		shutdown, err := mdns.Start(opts.mdnsHost, port)
		if err != nil {
			slog.Warn("mDNS disabled", "error", err)
		} else {
			fmt.Fprintf(os.Stderr, "diffmil: advertising http://%s.local:%d via mDNS\n", opts.mdnsHost, port)
			defer shutdown()
		}
	}

	// Restore previously tracked workspaces (if any).
	for _, entry := range backup.Load(port).Workspaces {
		if entry.Dir == "" {
			continue
		}
		if !gitcmd.IsGitRepo(entry.Dir) {
			continue
		}
		ws, _ := state.AddWorkspace(entry.Dir)
		if ws != nil && entry.Label != "" && entry.Label != ws.Label {
			state.UpdateWorkspaceLabel(ws.ID, entry.Label)
		}
	}

	url := fmt.Sprintf("http://localhost:%d", port)
	fmt.Fprintf(os.Stderr, "diffmil: serving at %s (pid %d)\n", url, os.Getpid())
	if logPath != "" {
		slog.Info("server starting", "url", url, "pid", os.Getpid(), "log", logPath)
	}

	if !opts.noOpen {
		if err := browser.OpenURL(url); err != nil {
			slog.Warn("could not open browser", "error", err)
		}
	}

	// Watch git repository for changes
	var (
		watchersMu sync.Mutex
		watchers   = make(map[string]*watcher.GitWatcher)
	)
	closeWatchers := func() {
		watchersMu.Lock()
		defer watchersMu.Unlock()
		for _, gw := range watchers {
			gw.Close()
		}
	}
	defer closeWatchers()

	startWatcher := func(dir, id string) {
		gw, err := watcher.New(dir, func() {
			state.NotifyCommitsChanged(id)
		})
		if err != nil {
			slog.Warn("failed to start git watcher", "dir", dir, "error", err)
			return
		}
		watchersMu.Lock()
		watchers[id] = gw
		watchersMu.Unlock()
	}

	state.WorkspaceAdded = func(ws *server.Workspace) {
		startWatcher(ws.Dir, ws.ID)
	}
	state.WorkspaceRemoved = func(id string) {
		watchersMu.Lock()
		gw, ok := watchers[id]
		delete(watchers, id)
		watchersMu.Unlock()
		if ok {
			gw.Close()
		}
	}

	for _, ws := range state.Workspaces() {
		startWatcher(ws.Dir, ws.ID)
	}

	// Persist workspaces with debouncing on State.DirtyCh().
	backupDone := make(chan struct{})
	go func() {
		defer close(backupDone)
		var pending *time.Timer
		flush := func() {
			snap := state.Workspaces()
			entries := make([]backup.WorkspaceEntry, 0, len(snap))
			for _, ws := range snap {
				entries = append(entries, backup.WorkspaceEntry{Dir: ws.Dir, Label: ws.Label})
			}
			if err := backup.Save(port, backup.State{Workspaces: entries}); err != nil {
				slog.Warn("failed to save workspaces backup", "error", err)
			}
		}
		for {
			select {
			case <-ctx.Done():
				if pending != nil {
					pending.Stop()
				}
				flush()
				return
			case <-state.DirtyCh():
				if pending != nil {
					pending.Stop()
				}
				pending = time.AfterFunc(500*time.Millisecond, flush)
			}
		}
	}()

	addr := fmt.Sprintf(":%d", port)
	srv := &http.Server{Addr: addr, Handler: handler}

	shutdown := func() {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		srv.Shutdown(shutdownCtx)
		cancel()
	}

	restartCh := make(chan struct{}, 1)

	go func() {
		select {
		case <-ctx.Done():
			shutdown()
		case <-state.ShutdownCh():
			shutdown()
		case <-state.RestartCh():
			restartCh <- struct{}{}
			shutdown()
		}
	}()

	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}

	cancel()
	<-backupDone

	restartRequested := false
	select {
	case <-restartCh:
		restartRequested = true
	default:
	}

	if restartRequested {
		time.Sleep(200 * time.Millisecond)

		binPath, err := os.Executable()
		if err != nil {
			slog.Error("restart: cannot find binary", "error", err)
			os.Exit(1)
		}
		cwd, _ := os.Getwd()
		cmd := exec.Command(binPath, opts.serverArgs()...)
		cmd.Dir = cwd
		setSysProcAttr(cmd)
		if err := cmd.Start(); err != nil {
			slog.Error("restart: failed to start new process", "error", err)
			os.Exit(1)
		}
		cmd.Process.Release()
	}
}

// --- Control commands ---

type statusResponse struct {
	App    string `json:"app"`
	Status string `json:"status"`
	PID    int    `json:"pid"`
	Log    string `json:"log"`
}

func fetchStatus(url string, timeout ...time.Duration) (*statusResponse, error) {
	t := 2 * time.Second
	if len(timeout) > 0 {
		t = timeout[0]
	}
	client := &http.Client{Timeout: t}
	resp, err := client.Get(url + "/_/api/status")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %s", resp.Status)
	}

	var s statusResponse
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return nil, err
	}
	if s.App != "diffmil" {
		return nil, fmt.Errorf("not a diffmil server (app=%q)", s.App)
	}
	return &s, nil
}

func runStatus(url string) {
	s, err := fetchStatus(url)
	if err != nil {
		fmt.Fprintf(os.Stderr, "diffmil: no server running at %s (%v)\n", url, err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stdout, "%s (pid %d, %s)\n", url, s.PID, s.Status)
	printLogPath(s)
}

// printLogPath appends the server's log file location to status output so
// users investigating errors can find the log without reading docs.
func printLogPath(s *statusResponse) {
	if s.Log != "" {
		fmt.Fprintf(os.Stdout, "  log: %s\n", s.Log)
	} else {
		fmt.Fprintln(os.Stdout, "  log: (logging disabled)")
	}
}

func runStatusAll() {
	ports := pidfile.DiscoverPorts()
	if len(ports) == 0 {
		fmt.Fprintln(os.Stderr, "diffmil: no running servers found")
		os.Exit(1)
	}

	for _, p := range ports {
		url := fmt.Sprintf("http://localhost:%d", p)
		s, err := fetchStatus(url, 1*time.Second)
		if err != nil {
			fmt.Fprintf(os.Stdout, "%s (stopped)\n", url)
			pidfile.Remove(p)
		} else {
			fmt.Fprintf(os.Stdout, "%s (pid %d, %s)\n", url, s.PID, s.Status)
			printLogPath(s)
		}
	}
}

func runShutdown(url string) {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Post(url+"/_/api/shutdown", "application/json", nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "diffmil: no server running at %s\n", url)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		fmt.Fprintf(os.Stderr, "diffmil: unexpected response: %s\n", resp.Status)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "diffmil: shutdown request sent to %s\n", url)
}

func runShutdownAll() {
	ports := pidfile.DiscoverPorts()
	if len(ports) == 0 {
		fmt.Fprintln(os.Stderr, "diffmil: no running servers found")
		return
	}

	for _, p := range ports {
		url := fmt.Sprintf("http://localhost:%d", p)
		s, err := fetchStatus(url, 1*time.Second)
		if err != nil {
			fmt.Fprintf(os.Stderr, "diffmil: %s (already stopped, cleaning up)\n", url)
			pidfile.Remove(p)
			continue
		}
		runShutdown(url)
		fmt.Fprintf(os.Stderr, "  pid %d\n", s.PID)
	}
}

func runRestart(url string) {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Post(url+"/_/api/restart", "application/json", nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "diffmil: no server running at %s\n", url)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		fmt.Fprintf(os.Stderr, "diffmil: unexpected response: %s\n", resp.Status)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "diffmil: restart request sent to %s\n", url)

	time.Sleep(500 * time.Millisecond)
	if err := waitForReady(url, 10*time.Second); err != nil {
		fmt.Fprintf(os.Stderr, "diffmil: warning: new server did not come up: %v\n", err)
	} else {
		fmt.Fprintf(os.Stderr, "diffmil: server restarted at %s\n", url)
	}
}

// --- Background spawning ---

func spawnBackground(opts runOptions) (int, error) {
	binPath, err := os.Executable()
	if err != nil {
		return 0, fmt.Errorf("cannot find binary: %w", err)
	}

	args := append(opts.serverArgs(), flag.Args()...)

	cmd := exec.Command(binPath, args...)
	if isStdinPipe() {
		cmd.Stdin = os.Stdin
	}
	setSysProcAttr(cmd)

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("failed to start background process: %w", err)
	}

	pid := cmd.Process.Pid
	if err := cmd.Process.Release(); err != nil {
		log.Printf("warning: failed to release process: %v", err)
	}

	return pid, nil
}

func waitForReady(baseURL string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if _, err := fetchStatus(baseURL, 500*time.Millisecond); err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("server did not become ready within %s", timeout)
}

func probeServer(baseURL string) bool {
	_, err := fetchStatus(baseURL, 500*time.Millisecond)
	return err == nil
}

func postDiff(baseURL string, diffResp *diff.DiffResponse) error {
	data, err := json.Marshal(diffResp)
	if err != nil {
		return fmt.Errorf("failed to marshal diff: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(baseURL+"/_/api/diff", "application/json", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to post diff: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}
	return nil
}

func postWorkspace(baseURL, dir string) (*server.Workspace, error) {
	body, err := json.Marshal(map[string]string{"dir": dir})
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(baseURL+"/_/api/workspaces", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var ws server.Workspace
	if err := json.NewDecoder(resp.Body).Decode(&ws); err != nil {
		return nil, err
	}
	return &ws, nil
}

// --- Config building ---

func buildConfig(ctx context.Context, args []string) (server.Config, error) {
	var cfg server.Config

	raw, err := readDiffInput(ctx, args, &cfg)
	if err != nil {
		return cfg, err
	}

	cfg.InitialDiff, err = diff.ParsePatch(raw)
	if err != nil {
		return cfg, fmt.Errorf("failed to parse diff: %w", err)
	}
	return cfg, nil
}

func readDiffInput(ctx context.Context, args []string, cfg *server.Config) ([]byte, error) {
	if isStdinPipe() {
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			return nil, fmt.Errorf("failed to read diff: %w", err)
		}
		return raw, nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory: %w", err)
	}

	if !gitcmd.IsGitRepo(cwd) {
		return nil, fmt.Errorf("not a git repository: %s", cwd)
	}

	cfg.RepoDir = cwd
	return gitcmd.Diff(ctx, cwd, args)
}

func isStdinPipe() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice == 0
}
