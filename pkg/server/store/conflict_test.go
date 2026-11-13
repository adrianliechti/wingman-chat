package store

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

type conflictingStore struct{ store.Provider }

func (conflictingStore) GetKeystore(context.Context, string) ([]byte, string, error) {
	return []byte(protectedTestKey("")), "key", nil
}
func (conflictingStore) DeleteChat(context.Context, string, string, int64) error {
	return store.ErrSeqConflict
}
func (conflictingStore) CompactChat(context.Context, string, string, int64) error {
	return store.ErrSeqConflict
}
func (conflictingStore) DeleteObject(context.Context, string, store.ObjectKind, string, string) error {
	return store.ErrObjectConflict
}
func (conflictingStore) ResetUser(context.Context, string, string) error {
	return store.ErrBackupConflict
}

func TestConcurrentStoreChangesReturnConflict(t *testing.T) {
	mux := http.NewServeMux()
	New(conflictingStore{}, nil).Attach(mux, "")
	for _, test := range []struct {
		method, path string
		status       int
	}{
		{"DELETE", "/v1/chats/chat-1234", 412},
		{"POST", "/v1/chats/chat-1234/compact?beforeSeq=2", 409},
		{"DELETE", "/v1/files/file-1234", 412},
		{"DELETE", "/v1/backup", 409},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			req.Header.Set("X-Forwarded-User", "alice")
			req.Header.Set("X-Backup-Generation", "test-generation")
			req.Header.Set("X-Confirm-Backup-Reset", "true")
			req.Header.Set("X-Expected-Seq", "1")
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != test.status {
				t.Fatalf("got %d: %s", res.Code, res.Body.String())
			}
		})
	}
}
