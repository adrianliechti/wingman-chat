package store

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func decodeUploadRequest(w http.ResponseWriter, r *http.Request, dst any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	err := decoder.Decode(dst)
	if err == nil {
		// Exactly one JSON value: anything after it, even valid JSON, is rejected.
		if err = decoder.Decode(new(json.RawMessage)); err == io.EOF {
			return nil
		}
	}
	var sizeErr *http.MaxBytesError
	if errors.As(err, &sizeErr) {
		return err
	}
	return store.ErrInvalidUpload
}

func (h *Handler) handleStartUpload(uploader store.DirectUploader, kind store.ObjectKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Size int64 `json:"size"`
		}
		if err := decodeUploadRequest(w, r, &input); err != nil {
			writeStoreError(w, err)
			return
		}
		ifMatch := ""
		if kind == store.FileObject {
			ifMatch = casFromRequest(r)
		}
		session, err := uploader.StartUpload(r.Context(), kind, r.PathValue("id"), input.Size, ifMatch)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)
	}
}

func (h *Handler) handleCompleteUpload(uploader store.DirectUploader, kind store.ObjectKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Ticket   string `json:"ticket"`
			SHA256   string `json:"sha256"`
			QuickXor string `json:"quickXor"`
		}
		if err := decodeUploadRequest(w, r, &input); err != nil {
			writeStoreError(w, err)
			return
		}
		etag, err := uploader.CompleteUpload(r.Context(), kind, r.PathValue("id"), input.Ticket, input.SHA256, input.QuickXor)
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
