package store

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/server/identity"
	"github.com/adrianliechti/wingman-chat/pkg/store"
)

type Handler struct {
	store      store.Provider
	middleware func(http.Handler) http.Handler
}

// New serves the backup API. middleware, if non-nil, wraps every route.
func New(store store.Provider, middleware func(http.Handler) http.Handler) *Handler {
	return &Handler{store: store, middleware: middleware}
}

func (h *Handler) Attach(mux *http.ServeMux, prefix string) {
	prefix = strings.TrimRight(prefix, "/")
	handle := func(pattern string, handler http.HandlerFunc) {
		var wrapped http.Handler = handler
		if h.middleware != nil {
			wrapped = h.middleware(wrapped)
		}
		mux.Handle(pattern, wrapped)
	}

	handle("GET "+prefix+"/v1/me", h.handleMe)

	handle("GET "+prefix+"/v1/keystore", h.handleGetKeystore)
	handle("PUT "+prefix+"/v1/keystore", h.handlePutKeystore)
	handle("DELETE "+prefix+"/v1/backup", h.handleResetBackup)
	handle("GET "+prefix+"/v1/backup/usage", h.requireProtection(h.handleBackupUsage))

	handle("GET "+prefix+"/v1/chats", h.requireProtection(h.handleListChats))
	handle("GET "+prefix+"/v1/chats/{id}/events", h.requireProtection(h.handleReadEvents))
	handle("POST "+prefix+"/v1/chats/{id}/events", h.requireProtection(h.handleAppendEvents))
	handle("POST "+prefix+"/v1/chats/{id}/compact", h.requireProtection(h.handleCompactChat))
	handle("DELETE "+prefix+"/v1/chats/{id}", h.requireProtection(h.handleDeleteChat))

	handle("GET "+prefix+"/v1/blobs/{id}", h.requireProtection(h.handleGetObject(store.BlobObject)))
	handle("HEAD "+prefix+"/v1/blobs/{id}", h.requireProtection(h.handleHeadBlob))
	handle("PUT "+prefix+"/v1/blobs/{id}", h.requireProtection(h.handlePutObject(store.BlobObject)))
	handle("DELETE "+prefix+"/v1/blobs/{id}", h.requireProtection(h.handleDeleteObject(store.BlobObject)))

	handle("GET "+prefix+"/v1/files", h.requireProtection(h.handleListFiles))
	handle("GET "+prefix+"/v1/files/{id}", h.requireProtection(h.handleGetObject(store.FileObject)))
	handle("PUT "+prefix+"/v1/files/{id}", h.requireProtection(h.handlePutObject(store.FileObject)))
	handle("DELETE "+prefix+"/v1/files/{id}", h.requireProtection(h.handleDeleteObject(store.FileObject)))
}

// auth -------------------------------------------------------------------

// userFromRequest returns the normalized identity string (the storage
// key) plus the public identity. Both MUST derive from the same value:
// the client bakes the /me id into its crypto AAD, so a storage key that
// disagrees with it mixes users' data or splits one user across
// directories.
func userFromRequest(r *http.Request) (string, identity.User, bool) {
	user, ok := identity.FromRequest(r)
	if !ok {
		return "", identity.User{}, false
	}
	return user.Key, user, true
}

func requireUser(w http.ResponseWriter, r *http.Request) (string, identity.User, bool) {
	id, u, ok := userFromRequest(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return "", identity.User{}, false
	}
	return id, u, true
}

// casFromRequest maps conditional request headers onto the provider's ifMatch
// argument: "If-None-Match: *" → "*" (create only), "If-Match: <etag>" (quoted
// or bare) → "<etag>" (compare-and-swap), neither → "" (unconditional).
func casFromRequest(r *http.Request) string {
	if strings.TrimSpace(r.Header.Get("If-None-Match")) == "*" {
		return "*"
	}
	return strings.Trim(strings.TrimSpace(r.Header.Get("If-Match")), `"`)
}

// routes -----------------------------------------------------------------

func (h *Handler) handleMe(w http.ResponseWriter, r *http.Request) {
	_, u, ok := requireUser(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(u)
}

func (h *Handler) handleGetKeystore(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	data, etag, err := h.store.GetKeystore(r.Context(), userID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Write(data)
}

func (h *Handler) handlePutKeystore(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if !protectedKeystore(body) {
		http.Error(w, "Backups require a valid PIN or passkey-protected keystore", http.StatusBadRequest)
		return
	}

	etag, err := h.store.PutKeystore(r.Context(), userID, body, casFromRequest(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("ETag", `"`+etag+`"`)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleListChats(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	chats, err := h.store.ListChats(r.Context(), userID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if chats == nil {
		chats = []store.ChatMeta{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(chats)
}

func (h *Handler) handleReadEvents(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	chatID := r.PathValue("id")

	var fromSeq int64
	if v := r.URL.Query().Get("fromSeq"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			http.Error(w, "invalid fromSeq", http.StatusBadRequest)
			return
		}
		fromSeq = n
	}

	reader, err := h.store.ReadEvents(r.Context(), userID, chatID, fromSeq)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", "application/x-ndjson")
	if _, err := io.Copy(w, reader); err != nil {
		// A later OneDrive segment can fail after earlier frames were sent. Abort
		// the HTTP stream so the client retries rather than accepting a partial log.
		panic(http.ErrAbortHandler)
	}
}

type appendRequest struct {
	ID    string `json:"id"`
	Frame string `json:"frame"`
}

func (h *Handler) handleAppendEvents(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	chatID := r.PathValue("id")

	expectedSeqHeader := r.Header.Get("X-Expected-Seq")
	if expectedSeqHeader == "" {
		http.Error(w, "X-Expected-Seq required", http.StatusBadRequest)
		return
	}
	expectedSeq, err := strconv.ParseInt(expectedSeqHeader, 10, 64)
	if err != nil || expectedSeq < 0 {
		http.Error(w, "invalid X-Expected-Seq", http.StatusBadRequest)
		return
	}

	scanner := bufio.NewScanner(http.MaxBytesReader(w, r.Body, store.MaxAppendBytes))
	scanner.Buffer(make([]byte, 64*1024), store.MaxFrameBytes+4*1024)

	var ids []string
	var frames [][]byte

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req appendRequest
		if err := json.Unmarshal(line, &req); err != nil {
			// The scanner yields the truncated tail before reporting a read error.
			var tooLarge *http.MaxBytesError
			if errors.As(scanner.Err(), &tooLarge) {
				writeStoreError(w, scanner.Err())
				return
			}
			http.Error(w, "invalid request line", http.StatusBadRequest)
			return
		}
		if req.ID == "" || req.Frame == "" {
			http.Error(w, "id and frame required", http.StatusBadRequest)
			return
		}
		ids = append(ids, req.ID)
		frames = append(frames, []byte(req.Frame))
	}
	if err := scanner.Err(); err != nil {
		var tooLarge *http.MaxBytesError
		switch {
		case errors.Is(err, bufio.ErrTooLong):
			writeStoreError(w, store.ErrFrameTooLarge)
		case errors.As(err, &tooLarge):
			writeStoreError(w, err)
		default:
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
		return
	}
	if len(ids) == 0 {
		http.Error(w, "no events", http.StatusBadRequest)
		return
	}

	res, err := h.store.AppendEvents(r.Context(), userID, chatID, expectedSeq, ids, frames)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (h *Handler) handleCompactChat(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	chatID := r.PathValue("id")
	v := r.URL.Query().Get("beforeSeq")
	if v == "" {
		http.Error(w, "beforeSeq required", http.StatusBadRequest)
		return
	}
	beforeSeq, err := strconv.ParseInt(v, 10, 64)
	if err != nil || beforeSeq < 1 {
		http.Error(w, "invalid beforeSeq", http.StatusBadRequest)
		return
	}

	if err := h.store.CompactChat(r.Context(), userID, chatID, beforeSeq); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleHeadBlob(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}
	blobID := r.PathValue("id")

	exists, err := h.store.BlobExists(r.Context(), userID, blobID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if !exists {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleDeleteChat(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	chatID := r.PathValue("id")

	if err := h.store.DeleteChat(r.Context(), userID, chatID); err != nil {
		writeStoreError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleListFiles(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	files, err := h.store.ListFiles(r.Context(), userID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if files == nil {
		files = []store.FileMeta{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

// Files use ETags for conflict resolution; content-addressed blobs are immutable
// from the client's perspective and retain unconditional upload/delete semantics.
func (h *Handler) handleGetObject(kind store.ObjectKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _, ok := requireUser(w, r)
		if !ok {
			return
		}
		reader, etag, err := h.store.GetObject(r.Context(), userID, kind, r.PathValue("id"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		defer reader.Close()

		w.Header().Set("Content-Type", "application/octet-stream")
		if kind == store.FileObject {
			w.Header().Set("ETag", `"`+etag+`"`)
		}
		if _, err := io.Copy(w, reader); err != nil {
			panic(http.ErrAbortHandler)
		}
	}
}

func (h *Handler) handlePutObject(kind store.ObjectKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _, ok := requireUser(w, r)
		if !ok {
			return
		}
		ifMatch := ""
		if kind == store.FileObject {
			ifMatch = casFromRequest(r)
		}
		body := http.MaxBytesReader(w, r.Body, store.MaxObjectBytes)
		etag, err := h.store.PutObject(r.Context(), userID, kind, r.PathValue("id"), body, ifMatch)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		if kind == store.FileObject {
			w.Header().Set("ETag", `"`+etag+`"`)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *Handler) handleDeleteObject(kind store.ObjectKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _, ok := requireUser(w, r)
		if !ok {
			return
		}
		ifMatch := ""
		if kind == store.FileObject {
			ifMatch = casFromRequest(r)
		}
		if err := h.store.DeleteObject(r.Context(), userID, kind, r.PathValue("id"), ifMatch); err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *Handler) handleBackupUsage(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}
	size, err := h.store.BackupSize(r.Context(), userID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(struct {
		Bytes int64 `json:"bytes"`
	}{Bytes: size})
}
