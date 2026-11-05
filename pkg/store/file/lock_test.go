//go:build linux || darwin

package file

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

const sharedTestChat = "11111111-1111-1111-1111-111111111111"

func TestSharedStoreHelperProcess(t *testing.T) {
	root := os.Getenv("WINGMAN_TEST_STORE_ROOT")
	if root == "" {
		return
	}
	provider, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	mode := os.Getenv("WINGMAN_TEST_STORE_MODE")
	if mode == "hold" {
		unlock, err := provider.lock(context.Background(), "alice:"+sharedTestChat)
		if err != nil {
			t.Fatal(err)
		}
		defer unlock()
	}
	if mode == "hold-user" {
		unlock, err := provider.LockUser(context.Background(), "alice", false)
		if err != nil {
			t.Fatal(err)
		}
		defer unlock()
	}
	fmt.Println("ready")
	if _, err := io.ReadFull(os.Stdin, make([]byte, 1)); err != nil {
		return
	}
	id := os.Getenv("WINGMAN_TEST_STORE_ID")
	switch mode {
	case "append":
		_, err = provider.AppendEvents(context.Background(), "alice", sharedTestChat, 0, []string{id}, [][]byte{[]byte("frame")})
	case "file":
		_, err = provider.PutFile(context.Background(), "alice", id, strings.NewReader("encrypted"), "*")
	}
	if errors.Is(err, store.ErrSeqConflict) {
		fmt.Println("conflict")
	} else if err != nil {
		t.Fatal(err)
	} else {
		fmt.Println("ok")
	}
}

type storeProcess struct {
	cmd    *exec.Cmd
	input  io.WriteCloser
	output *bufio.Scanner
	errors bytes.Buffer
}

func startStoreProcess(t *testing.T, root, mode, id string) *storeProcess {
	t.Helper()
	child := &storeProcess{cmd: exec.Command(os.Args[0], "-test.run=^TestSharedStoreHelperProcess$")}
	child.cmd.Env = append(os.Environ(), "WINGMAN_TEST_STORE_ROOT="+root, "WINGMAN_TEST_STORE_MODE="+mode, "WINGMAN_TEST_STORE_ID="+id)
	child.cmd.Stderr = &child.errors
	var err error
	child.input, err = child.cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := child.cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	child.output = bufio.NewScanner(output)
	if err := child.cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.input.Close(); _ = child.cmd.Process.Kill(); _ = child.cmd.Wait() })
	if !child.output.Scan() || child.output.Text() != "ready" {
		t.Fatalf("child not ready: %s", child.errors.String())
	}
	return child
}

func TestSharedStoreCrossProcessCAS(t *testing.T) {
	root := t.TempDir()
	children := make([]*storeProcess, 4)
	for i := range children {
		children[i] = startStoreProcess(t, root, "append", fmt.Sprintf("event-%d", i))
	}
	for _, child := range children {
		_, _ = child.input.Write([]byte{1})
	}
	accepted := 0
	for _, child := range children {
		if !child.output.Scan() {
			t.Fatalf("no result: %s", child.errors.String())
		}
		if child.output.Text() == "ok" {
			accepted++
		} else if child.output.Text() != "conflict" {
			t.Fatalf("unexpected result: %s", child.output.Text())
		}
		if err := child.cmd.Wait(); err != nil {
			t.Fatalf("child failed: %v %s", err, child.errors.String())
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted %d competing writes, want exactly 1", accepted)
	}
}

func TestSharedStoreCrossProcessFileManifest(t *testing.T) {
	root := t.TempDir()
	children := make([]*storeProcess, 4)
	for i := range children {
		children[i] = startStoreProcess(t, root, "file", fmt.Sprintf("file-id-%02d", i))
	}
	for _, child := range children {
		_, _ = child.input.Write([]byte{1})
	}
	for _, child := range children {
		if !child.output.Scan() || child.output.Text() != "ok" {
			t.Fatalf("file upload failed: %s", child.errors.String())
		}
		if err := child.cmd.Wait(); err != nil {
			t.Fatalf("child failed: %v %s", err, child.errors.String())
		}
	}
	provider, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	files, err := provider.ListFiles(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != len(children) {
		t.Fatalf("lost manifest updates: have %d, want %d", len(files), len(children))
	}
}

func TestSharedStoreLockCancellationAndCrashRelease(t *testing.T) {
	root := t.TempDir()
	child := startStoreProcess(t, root, "hold", "")
	provider, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, err = provider.AppendEvents(ctx, "alice", sharedTestChat, 0, []string{"event"}, [][]byte{[]byte("frame")})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("lock wait ignored cancellation: %v", err)
	}
	_ = child.cmd.Process.Kill()
	_ = child.cmd.Wait()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := provider.AppendEvents(ctx, "alice", sharedTestChat, 0, []string{"event"}, [][]byte{[]byte("frame")}); err != nil {
		t.Fatalf("crashed pod left a stale lock: %v", err)
	}
}

func TestResetWaitsForCrossProcessRequests(t *testing.T) {
	root := t.TempDir()
	provider, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.PutKeystore(context.Background(), "alice", []byte("key"), "*"); err != nil {
		t.Fatal(err)
	}
	child := startStoreProcess(t, root, "hold-user", "")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := provider.ResetUser(ctx, "alice"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("reset did not wait for the active request: %v", err)
	}
	if _, _, err := provider.GetKeystore(context.Background(), "alice"); err != nil {
		t.Fatalf("canceled reset removed the keystore: %v", err)
	}
	_ = child.cmd.Process.Kill()
	_ = child.cmd.Wait()
	if err := provider.ResetUser(context.Background(), "alice"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := provider.GetKeystore(context.Background(), "alice"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("reset left the keystore: %v", err)
	}
}
