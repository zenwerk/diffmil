package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"

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

	handler := server.New(cfg)

	addr := fmt.Sprintf(":%d", *port)
	srv := &http.Server{Addr: addr, Handler: handler}

	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()

	url := fmt.Sprintf("http://localhost:%d", *port)
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
