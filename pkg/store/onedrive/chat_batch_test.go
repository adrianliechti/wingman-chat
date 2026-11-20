package onedrive

import (
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
	"github.com/adrianliechti/wingman-chat/pkg/store/onedrive/onedrivetest"
)

func TestChatBatchCommitsOtherChatsWhenAHeadConflicts(t *testing.T) {
	p, graph := newTestProvider(t)
	frame := store.EventFrame{ID: "event-1", Frame: "encrypted"}
	if _, err := appendEvents(p, testSession(), "chat-stale", 0, []string{frame.ID}, [][]byte{[]byte(frame.Frame)}); err != nil {
		t.Fatal(err)
	}
	indexWrites := 0
	p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodPut && strings.Contains(r.URL.Path, indexName) {
			indexWrites++
		}
		return graph.RoundTrip(r)
	})
	results, err := p.AppendChatBatch(testSession(), []store.ChatAppend{
		{ID: "chat-stale", Events: []store.EventFrame{frame}},
		{ID: "chat-first", Events: []store.EventFrame{frame}},
		{ID: "chat-second", Events: []store.EventFrame{frame}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 || results[0] != nil || results[1] == nil || results[1].NewSeq != 1 || results[2] == nil || results[2].NewSeq != 1 {
		t.Fatalf("unexpected append results: %+v", results)
	}
	if indexWrites != 1 {
		t.Fatalf("index writes = %d, want 1", indexWrites)
	}
	for _, id := range []string{"chat-stale", "chat-first", "chat-second"} {
		r, err := p.ReadEvents(testSession(), id, 0)
		if data := readAll(t, r, err); string(data) != "{\"seq\":1,\"id\":\"event-1\",\"frame\":\"encrypted\"}\n" {
			t.Fatalf("wrong history for %s: %s", id, data)
		}
	}
}

func BenchmarkChatUploads(b *testing.B) {
	const graphLatency = 20 * time.Millisecond
	for _, count := range []int{8, 32} {
		for _, batched := range []bool{false, true} {
			name := "serial"
			if batched {
				name = "batch"
			}
			b.Run(fmt.Sprintf("%d_chats/%s", count, name), func(b *testing.B) {
				tempDir := b.TempDir()
				frame := strings.Repeat("A", 8<<10)
				writes := make([]store.ChatAppend, count)
				for i := range writes {
					writes[i] = store.ChatAppend{
						ID: fmt.Sprintf("chat-%04d", i), Events: []store.EventFrame{{ID: "event-1", Frame: frame}},
					}
				}
				var calls, commits atomic.Int64
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					b.StopTimer()
					p := New()
					p.tempDir = tempDir
					p.sweepInterval = 0
					graph := &onedrivetest.Graph{Folders: map[string]map[string][]byte{}}
					p.client = &http.Client{Transport: graph}
					if _, err := p.PutKeystore(testSession(), []byte(`{"accountId":"a","generation":"g"}`), "*"); err != nil {
						b.Fatal(err)
					}
					p.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
						calls.Add(1)
						if r.Method == http.MethodPut && strings.Contains(r.URL.Path, indexName) {
							commits.Add(1)
						}
						time.Sleep(graphLatency)
						return graph.RoundTrip(r)
					})
					b.StartTimer()
					if batched {
						for start := 0; start < count; start += store.MaxChatBatchChats {
							batch := writes[start:min(start+store.MaxChatBatchChats, count)]
							if _, err := p.AppendChatBatch(testSession(), batch); err != nil {
								b.Fatal(err)
							}
						}
					} else {
						for _, write := range writes {
							if _, err := appendEvents(p, testSession(), write.ID, 0, []string{"event-1"}, [][]byte{[]byte(frame)}); err != nil {
								b.Fatal(err)
							}
						}
					}
				}
				b.ReportMetric(float64(calls.Load())/float64(b.N), "graph_calls/op")
				b.ReportMetric(float64(commits.Load())/float64(b.N), "index_commits/op")
			})
		}
	}
}
