package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/bluekeyes/go-gitdiff/gitdiff"
	"github.com/pkg/browser"
	"github.com/zenwerk/diffmil/internal/diff"
	gitcmd "github.com/zenwerk/diffmil/internal/git"
	"github.com/zenwerk/diffmil/internal/server"
)

func main() {
	port := flag.Int("port", 8080, "server port")
	noOpen := flag.Bool("no-open", false, "don't open browser")
	flag.Parse()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	cfg, err := buildConfig(ctx, flag.Args())
	if err != nil {
		log.Fatal(err)
	}

	url := fmt.Sprintf("http://localhost:%d", *port)

	// Check if a server is already running on this port
	if probeServer(url) {
		// Post diff to existing server
		if err := postDiff(url, cfg.InitialDiff); err != nil {
			log.Fatalf("failed to send diff to existing server: %v", err)
		}
		fmt.Printf("Sent diff to existing server at %s\n", url)
		if !*noOpen {
			browser.OpenURL(url)
		}
		return
	}

	// Start new server
	handler := server.New(cfg)

	addr := fmt.Sprintf(":%d", *port)
	srv := &http.Server{Addr: addr, Handler: handler}

	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()

	fmt.Printf("diffmil running at %s\n", url)

	if !*noOpen {
		if err := browser.OpenURL(url); err != nil {
			log.Printf("could not open browser: %v", err)
		}
	}

	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// probeServer checks if a diffmil server is already running at the given URL.
func probeServer(baseURL string) bool {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	resp, err := client.Get(baseURL + "/_/api/status")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// postDiff sends diff data to an existing server via POST.
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

func buildConfig(ctx context.Context, args []string) (server.Config, error) {
	var cfg server.Config

	reader, err := getDiffReader(ctx, args, &cfg)
	if err != nil {
		return cfg, err
	}

	files, _, err := gitdiff.Parse(reader)
	if err != nil {
		return cfg, fmt.Errorf("failed to parse diff: %w", err)
	}

	cfg.InitialDiff = diff.FromGitDiff(files)
	return cfg, nil
}

// getDiffReader returns an io.Reader for the diff content and populates config.
func getDiffReader(ctx context.Context, args []string, cfg *server.Config) (io.Reader, error) {
	if isStdinPipe() {
		return os.Stdin, nil
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
