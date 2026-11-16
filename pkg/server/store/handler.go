package store

import (
	"encoding/json"
	"io"
	"net/http"
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
	handle := func(pattern string, handler userHandler) {
		var wrapped http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := identity.FromRequest(r)
			if !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			handler(w, r, user)
		})
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

// userHandler keeps the public crypto identity and private storage key together.
// Attach resolves it once, after the provider middleware, for every route.
type userHandler func(http.ResponseWriter, *http.Request, identity.User)

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

func (h *Handler) handleMe(w http.ResponseWriter, r *http.Request, user identity.User) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *Handler) handleGetKeystore(w http.ResponseWriter, r *http.Request, user identity.User) {
	data, etag, err := h.store.GetKeystore(r.Context(), user.Key)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Write(data)
}

func (h *Handler) handlePutKeystore(w http.ResponseWriter, r *http.Request, user identity.User) {
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

	etag, err := h.store.PutKeystore(r.Context(), user.Key, body, casFromRequest(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("ETag", `"`+etag+`"`)
	w.WriteHeader(http.StatusNoContent)
}
