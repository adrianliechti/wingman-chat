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
	uploads    *uploadLimiter
}

// New serves the backup API. middleware, if non-nil, wraps every route.
func New(store store.Provider, middleware func(http.Handler) http.Handler) *Handler {
	return &Handler{
		store: store, middleware: middleware,
		uploads: newUploadLimiter(podUploads, perAccountUploads, uploadQueueWait, uploadBodyTimeout),
	}
}

func (h *Handler) Attach(mux *http.ServeMux, basePath string) {
	handle := func(pattern string, handler http.HandlerFunc) {
		var wrapped http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := identity.FromRequest(r); !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			handler(w, r)
		})
		if h.middleware != nil {
			wrapped = h.middleware(wrapped)
		}
		mux.Handle(pattern, wrapped)
	}

	handle("GET "+basePath+"/keystore", h.handleGetKeystore)
	handle("PUT "+basePath+"/keystore", h.handlePutKeystore)
	handle("DELETE "+basePath, h.handleResetBackup)
	handle("GET "+basePath+"/usage", h.requireProtection(h.handleBackupUsage))

	handle("GET "+basePath+"/chats", h.requireProtection(h.handleListChats))
	if appender, ok := h.store.(store.ChatBatchAppender); ok {
		handle("POST "+basePath+"/chats/append", h.uploads.wrap(h.requireProtection(h.handleAppendChatBatch(appender))))
	}
	handle("GET "+basePath+"/chats/{id}/events", h.requireProtection(h.handleReadEvents))
	handle("POST "+basePath+"/chats/{id}/events", h.uploads.wrap(h.requireProtection(h.handleAppendEvents)))
	handle("POST "+basePath+"/chats/{id}/compact", h.requireProtection(h.handleCompactChat))
	handle("DELETE "+basePath+"/chats/{id}", h.requireProtection(h.handleDeleteChat))

	handle("GET "+basePath+"/blobs/{id}", h.requireProtection(h.handleGetObject(store.BlobObject)))
	handle("HEAD "+basePath+"/blobs/{id}", h.requireProtection(h.handleHeadBlob))
	handle("PUT "+basePath+"/blobs/{id}", h.uploads.wrap(h.requireProtection(h.handlePutObject(store.BlobObject))))
	handle("DELETE "+basePath+"/blobs/{id}", h.requireProtection(h.handleDeleteObject(store.BlobObject)))

	handle("GET "+basePath+"/files", h.requireProtection(h.handleListFiles))
	handle("POST "+basePath+"/files", h.uploads.wrap(h.requireProtection(h.handlePutFiles)))
	handle("POST "+basePath+"/files/delete", h.requireProtection(h.handleDeleteFiles))
	handle("GET "+basePath+"/files/{id}", h.requireProtection(h.handleGetObject(store.FileObject)))
	handle("PUT "+basePath+"/files/{id}", h.uploads.wrap(h.requireProtection(h.handlePutObject(store.FileObject))))
	handle("DELETE "+basePath+"/files/{id}", h.requireProtection(h.handleDeleteObject(store.FileObject)))

	uploader, supportsDirect := h.store.(store.DirectUploader)
	for resource, kind := range map[string]store.ObjectKind{"blobs": store.BlobObject, "files": store.FileObject} {
		base := "POST " + basePath + "/" + resource + "/{id}"
		if !supportsDirect || !uploader.DirectUploadsEnabled() {
			unavailable := func(w http.ResponseWriter, _ *http.Request) {
				writeStoreError(w, store.ErrDirectUnavailable)
			}
			mux.HandleFunc(base+"/upload-session", unavailable)
			mux.HandleFunc(base+"/upload-complete", unavailable)
			continue
		}
		handle(base+"/upload-session", h.uploads.wrap(h.requireProtection(h.handleStartUpload(uploader, kind))))
		handle(base+"/upload-complete", h.uploads.wrap(h.requireProtection(h.handleCompleteUpload(uploader, kind))))
	}
}

// casFromRequest maps conditional request headers onto the provider's ifMatch
// argument: "If-None-Match: *" → "*" (create only), "If-Match: <etag>" (quoted
// or bare) → "<etag>" (compare-and-swap), neither → "" (unconditional).
// Keystore writes require one of the two headers.
func casFromRequest(r *http.Request) string {
	if strings.TrimSpace(r.Header.Get("If-None-Match")) == "*" {
		return "*"
	}
	return strings.Trim(strings.TrimSpace(r.Header.Get("If-Match")), `"`)
}

// routes -----------------------------------------------------------------

func (h *Handler) handleGetKeystore(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, no-transform")
	data, etag, err := h.store.GetKeystore(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Write(data)
}

func (h *Handler) handlePutKeystore(w http.ResponseWriter, r *http.Request) {
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

	ifMatch := casFromRequest(r)
	if ifMatch == "" {
		http.Error(w, "If-Match or If-None-Match required", http.StatusPreconditionRequired)
		return
	}

	etag, err := h.store.PutKeystore(r.Context(), body, ifMatch)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("ETag", `"`+etag+`"`)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleResetBackup(w http.ResponseWriter, r *http.Request) {
	// A non-simple header prevents cross-origin form submissions. Reset needs
	// the signed-in account, not the lost PIN/passkey used for decryption.
	var cond store.ResetCondition
	switch r.Header.Get("X-Confirm-Backup-Reset") {
	case "true":
	case "unreadable":
		cond.Unreadable = true
	default:
		http.Error(w, "Backup reset confirmation required", http.StatusBadRequest)
		return
	}
	// The confirmed backup must still be current: a delayed retry must not
	// delete a backup configured after the user confirmed the reset.
	if !cond.Unreadable {
		switch cas := casFromRequest(r); cas {
		case "":
			http.Error(w, "If-Match or If-None-Match required", http.StatusPreconditionRequired)
			return
		case "*":
		default:
			cond.Keystore = cas
		}
	}
	if err := h.store.ResetUser(r.Context(), cond); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleBackupUsage(w http.ResponseWriter, r *http.Request) {
	size, err := h.store.BackupSize(r.Context())
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
