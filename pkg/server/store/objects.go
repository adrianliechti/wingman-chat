package store

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/adrianliechti/wingman-chat/pkg/server/identity"
	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func (h *Handler) handleHeadBlob(w http.ResponseWriter, r *http.Request, user identity.User) {
	blobID := r.PathValue("id")

	exists, err := h.store.BlobExists(r.Context(), user.ID, blobID)
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

func (h *Handler) handleListFiles(w http.ResponseWriter, r *http.Request, user identity.User) {
	files, err := h.store.ListFiles(r.Context(), user.ID)
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
func (h *Handler) handleGetObject(kind store.ObjectKind) userHandler {
	return func(w http.ResponseWriter, r *http.Request, user identity.User) {
		reader, etag, err := h.store.GetObject(r.Context(), user.ID, kind, r.PathValue("id"))
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

func (h *Handler) handlePutObject(kind store.ObjectKind) userHandler {
	return func(w http.ResponseWriter, r *http.Request, user identity.User) {
		ifMatch := ""
		if kind == store.FileObject {
			ifMatch = casFromRequest(r)
		}
		body := http.MaxBytesReader(w, r.Body, store.MaxObjectBytes)
		etag, err := h.store.PutObject(r.Context(), user.ID, kind, r.PathValue("id"), body, ifMatch)
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

func (h *Handler) handleDeleteObject(kind store.ObjectKind) userHandler {
	return func(w http.ResponseWriter, r *http.Request, user identity.User) {
		ifMatch := ""
		if kind == store.FileObject {
			ifMatch = casFromRequest(r)
		}
		if err := h.store.DeleteObject(r.Context(), user.ID, kind, r.PathValue("id"), ifMatch); err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
