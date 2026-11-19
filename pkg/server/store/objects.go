package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func (h *Handler) handleHeadBlob(w http.ResponseWriter, r *http.Request) {
	blobID := r.PathValue("id")

	exists, err := h.store.BlobExists(r.Context(), blobID)
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

func (h *Handler) handleListFiles(w http.ResponseWriter, r *http.Request) {
	files, err := h.store.ListFiles(r.Context())
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
		reader, etag, err := h.store.GetObject(r.Context(), kind, r.PathValue("id"))
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
		ifMatch := ""
		if kind == store.FileObject {
			ifMatch = casFromRequest(r)
		}
		body := http.MaxBytesReader(w, r.Body, store.MaxObjectBytes)
		etag, err := h.store.PutObject(r.Context(), kind, r.PathValue("id"), body, ifMatch)
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
		ifMatch := ""
		if kind == store.FileObject {
			ifMatch = casFromRequest(r)
		}
		if err := h.store.DeleteObject(r.Context(), kind, r.PathValue("id"), ifMatch); err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

var errMalformedBatch = errors.New("malformed file batch")

type batchEntry struct {
	ID          string `json:"id"`
	IfMatch     string `json:"ifMatch,omitempty"`
	IfNoneMatch string `json:"ifNoneMatch,omitempty"`
}

// handlePutFiles accepts multipart/form-data: a JSON "manifest" part listing
// files and their preconditions, followed by one part per file in manifest
// order, each named by its file ID. Parts stream into the provider unbuffered.
func (h *Handler) handlePutFiles(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, store.MaxBatchBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, "multipart body required", http.StatusBadRequest)
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "manifest" {
		http.Error(w, "manifest part required", http.StatusBadRequest)
		return
	}
	var manifest []batchEntry
	if err := json.NewDecoder(io.LimitReader(part, 1<<20)).Decode(&manifest); err != nil {
		http.Error(w, "invalid manifest", http.StatusBadRequest)
		return
	}
	if len(manifest) == 0 || len(manifest) > store.MaxBatchFiles {
		http.Error(w, "batch must contain 1 to "+strconv.Itoa(store.MaxBatchFiles)+" files", http.StatusBadRequest)
		return
	}

	parts := &batchParts{reader: reader}
	writes := make([]store.FileWrite, len(manifest))
	for i, entry := range manifest {
		ifMatch := strings.Trim(strings.TrimSpace(entry.IfMatch), `"`)
		if strings.TrimSpace(entry.IfNoneMatch) == "*" {
			ifMatch = "*"
		}
		writes[i] = store.FileWrite{ID: entry.ID, IfMatch: ifMatch, Body: &batchPart{parts: parts, index: i, id: entry.ID}}
	}

	etags, err := h.store.PutFiles(r.Context(), writes)
	if errors.Is(err, errMalformedBatch) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	type result struct {
		ID   string `json:"id"`
		ETag string `json:"etag"`
	}
	results := make([]result, len(writes))
	for i, write := range writes {
		results[i] = result{ID: write.ID, ETag: etags[i]}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		Files []result `json:"files"`
	}{Files: results})
}

// handleDeleteFiles accepts {"files":[{"id","ifMatch"}]} and reports per file
// whether it is gone; a file whose precondition failed is kept.
func (h *Handler) handleDeleteFiles(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Files []batchEntry `json:"files"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, "invalid batch", http.StatusBadRequest)
		return
	}
	if len(body.Files) == 0 || len(body.Files) > store.MaxBatchFiles {
		http.Error(w, "batch must contain 1 to "+strconv.Itoa(store.MaxBatchFiles)+" files", http.StatusBadRequest)
		return
	}
	deletes := make([]store.FileDelete, len(body.Files))
	for i, entry := range body.Files {
		deletes[i] = store.FileDelete{ID: entry.ID, IfMatch: strings.Trim(strings.TrimSpace(entry.IfMatch), `"`)}
	}
	deleted, err := h.store.DeleteFiles(r.Context(), deletes)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	type result struct {
		ID      string `json:"id"`
		Deleted bool   `json:"deleted"`
	}
	results := make([]result, len(deletes))
	for i, d := range deletes {
		results[i] = result{ID: d.ID, Deleted: deleted[i]}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		Files []result `json:"files"`
	}{Files: results})
}

type batchParts struct {
	reader *multipart.Reader
	next   int
}

// batchPart opens its multipart section on first read and requires the
// provider to consume parts in manifest order.
type batchPart struct {
	parts *batchParts
	index int
	id    string
	part  *multipart.Part
}

func (b *batchPart) Read(p []byte) (int, error) {
	if b.part == nil {
		if b.parts.next != b.index {
			return 0, errMalformedBatch
		}
		part, err := b.parts.reader.NextPart()
		if err == io.EOF {
			return 0, fmt.Errorf("%w: missing part for %s", errMalformedBatch, b.id)
		}
		if err != nil {
			return 0, err
		}
		if part.FormName() != b.id {
			return 0, fmt.Errorf("%w: expected part %s", errMalformedBatch, b.id)
		}
		b.part = part
		b.parts.next++
	}
	return b.part.Read(p)
}
