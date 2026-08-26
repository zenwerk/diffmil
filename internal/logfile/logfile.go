// Package logfile configures slog to write JSON logs to a size-rotated file
// under the diffmil state directory, so daemonized servers leave a trail that
// can be inspected after failures.
package logfile

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/zenwerk/diffmil/internal/pidfile"
)

const logFilePrefix = "diffmil-"

const (
	maxSize    = 10 * 1024 * 1024 // 10MB
	maxBackups = 3
	maxAge     = 7 * 24 * time.Hour
)

// Options controls where and how much the server logs.
type Options struct {
	// Port selects the default log file name (diffmil-<port>.log).
	Port int
	// Level is the minimum level written to the log.
	Level slog.Level
	// Path overrides the default log file location when non-empty.
	Path string
	// Disabled turns off file output entirely; logs still go to stderr,
	// which is /dev/null for daemonized servers.
	Disabled bool
}

// DefaultPath returns the default log file path for the given port.
func DefaultPath(port int) string {
	return filepath.Join(pidfile.Dir(), "log", fmt.Sprintf("%s%d.log", logFilePrefix, port))
}

// ParseLevel converts a --log-level flag value to a slog.Level.
func ParseLevel(s string) (slog.Level, error) {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("invalid log level %q (want debug, info, warn, or error)", s)
	}
}

// Setup installs the default slog logger. Logs are written to both the log
// file and stderr; stderr is discarded for daemonized servers, so the file is
// the durable record while foreground runs still print to the terminal.
// It returns a cleanup function that closes the file and the resolved log
// file path ("" when disabled).
func Setup(opts Options) (func(), string, error) {
	if opts.Disabled {
		setDefault(os.Stderr, opts.Level)
		return func() {}, "", nil
	}

	path := opts.Path
	if path == "" {
		path = DefaultPath(opts.Port)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, "", err
	}
	// Age-based cleanup only scans the default directory: walking a
	// user-supplied --log-file directory and deleting from it is unsafe.
	if opts.Path == "" {
		cleanOldLogs(filepath.Dir(path), maxAge)
	}

	w, err := newRotatingWriter(path, maxSize, maxBackups)
	if err != nil {
		return nil, "", err
	}

	setDefault(io.MultiWriter(w, os.Stderr), opts.Level)
	return func() { w.Close() }, path, nil
}

func setDefault(w io.Writer, level slog.Level) {
	slog.SetDefault(slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})))
}

func cleanOldLogs(dir string, age time.Duration) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	now := time.Now()
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), logFilePrefix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > age {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// rotatingWriter is an io.Writer that rotates log files by size.
type rotatingWriter struct {
	filename   string
	maxSize    int64
	maxBackups int

	mu   sync.Mutex
	file *os.File
	size int64
}

func openLogFile(filename string) (*os.File, error) {
	return os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
}

func newRotatingWriter(filename string, maxSize int64, maxBackups int) (*rotatingWriter, error) {
	f, err := openLogFile(filename)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return &rotatingWriter{
		filename:   filename,
		maxSize:    maxSize,
		maxBackups: maxBackups,
		file:       f,
		size:       info.Size(),
	}, nil
}

func (w *rotatingWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.size+int64(len(p)) > w.maxSize {
		if err := w.rotate(); err != nil {
			return 0, err
		}
	}

	n, err = w.file.Write(p)
	w.size += int64(n)
	return
}

func (w *rotatingWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.file.Close()
}

func (w *rotatingWriter) backupName(i int) string {
	return fmt.Sprintf("%s.%d", w.filename, i)
}

func (w *rotatingWriter) rotate() error {
	if err := w.file.Close(); err != nil {
		return err
	}

	// Remove oldest backup
	os.Remove(w.backupName(w.maxBackups))

	// Shift existing backups: .2 -> .3, .1 -> .2
	for i := w.maxBackups - 1; i >= 1; i-- {
		if err := os.Rename(w.backupName(i), w.backupName(i+1)); err != nil && !os.IsNotExist(err) {
			return w.recoverOpen(err)
		}
	}

	// Current -> .1
	if err := os.Rename(w.filename, w.backupName(1)); err != nil && !os.IsNotExist(err) {
		return w.recoverOpen(err)
	}

	f, err := openLogFile(w.filename)
	if err != nil {
		return err
	}
	w.file = f
	w.size = 0
	return nil
}

// recoverOpen reopens the log file so the writer remains functional after a rotation failure.
func (w *rotatingWriter) recoverOpen(cause error) error {
	f, err := openLogFile(w.filename)
	if err != nil {
		return fmt.Errorf("rotate failed (%w) and recovery open also failed: %w", cause, err)
	}
	w.file = f
	w.size = 0
	if info, err := f.Stat(); err == nil {
		w.size = info.Size()
	}
	return cause
}
