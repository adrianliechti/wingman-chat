package store

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

type Handler struct {
	store store.Provider
}

func New(store store.Provider) *Handler {
	return &Handler{store: store}
}

func (h *Handler) Attach(mux *http.ServeMux, prefix string) {
	prefix = strings.TrimRight(prefix, "/")

	mux.HandleFunc("GET "+prefix+"/v1/me", h.handleMe)

	mux.HandleFunc("GET "+prefix+"/v1/keystore", h.handleGetKeystore)
	mux.HandleFunc("PUT "+prefix+"/v1/keystore", h.handlePutKeystore)

	mux.HandleFunc("GET "+prefix+"/v1/chats", h.handleListChats)
	mux.HandleFunc("GET "+prefix+"/v1/chats/{id}/events", h.handleReadEvents)
	mux.HandleFunc("POST "+prefix+"/v1/chats/{id}/events", h.handleAppendEvents)
	mux.HandleFunc("POST "+prefix+"/v1/chats/{id}/compact", h.handleCompactChat)
	mux.HandleFunc("DELETE "+prefix+"/v1/chats/{id}", h.handleDeleteChat)

	mux.HandleFunc("GET "+prefix+"/v1/blobs/{id}", h.handleGetBlob)
	mux.HandleFunc("HEAD "+prefix+"/v1/blobs/{id}", h.handleHeadBlob)
	mux.HandleFunc("PUT "+prefix+"/v1/blobs/{id}", h.handlePutBlob)
	mux.HandleFunc("DELETE "+prefix+"/v1/blobs/{id}", h.handleDeleteBlob)

	mux.HandleFunc("GET "+prefix+"/v1/files", h.handleListFiles)
	mux.HandleFunc("GET "+prefix+"/v1/files/{id}", h.handleGetFile)
	mux.HandleFunc("PUT "+prefix+"/v1/files/{id}", h.handlePutFile)
	mux.HandleFunc("DELETE "+prefix+"/v1/files/{id}", h.handleDeleteFile)
}

// auth -------------------------------------------------------------------

type userIdentity struct {
	ID    string `json:"id"`
	Email string `json:"email,omitempty"`
}

func userFromRequest(r *http.Request) (userIdentity, bool) {
	user := strings.TrimSpace(r.Header.Get("X-Forwarded-User"))
	email := strings.TrimSpace(r.Header.Get("X-Forwarded-Email"))

	id := user
	if id == "" {
		id = email
	}

	if id == "" {
		return userIdentity{}, false
	}

	sum := sha256.Sum256([]byte(id))
	return userIdentity{
		ID:    hex.EncodeToString(sum[:16]),
		Email: email,
	}, true
}

func requireUser(w http.ResponseWriter, r *http.Request) (string, userIdentity, bool) {
	u, ok := userFromRequest(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return "", userIdentity{}, false
	}

	rawID := r.Header.Get("X-Forwarded-User")
	if rawID == "" {
		rawID = r.Header.Get("X-Forwarded-Email")
	}
	return rawID, u, true
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
	if errors.Is(err, store.ErrNotFound) {
		http.Error(w, "no keystore", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	ifMatch := strings.Trim(r.Header.Get("If-Match"), `"`)
	ifNone := strings.TrimSpace(r.Header.Get("If-None-Match"))

	var cas string
	switch {
	case ifNone == "*":
		cas = "*"
	case ifMatch != "":
		cas = ifMatch
	}

	etag, err := h.store.PutKeystore(r.Context(), userID, body, cas)
	if errors.Is(err, store.ErrKeystoreConflict) {
		http.Error(w, "keystore conflict", http.StatusPreconditionFailed)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	if errors.Is(err, store.ErrInvalidID) {
		http.Error(w, "invalid chat id", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", "application/x-ndjson")
	io.Copy(w, reader)
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

	scanner := bufio.NewScanner(r.Body)
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
		if errors.Is(err, bufio.ErrTooLong) {
			http.Error(w, "frame too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(ids) == 0 {
		http.Error(w, "no events", http.StatusBadRequest)
		return
	}

	res, err := h.store.AppendEvents(r.Context(), userID, chatID, expectedSeq, ids, frames)
	switch {
	case errors.Is(err, store.ErrInvalidID):
		http.Error(w, "invalid chat id", http.StatusBadRequest)
		return
	case errors.Is(err, store.ErrSeqConflict):
		http.Error(w, "seq conflict", http.StatusConflict)
		return
	case errors.Is(err, store.ErrFrameTooLarge):
		http.Error(w, "frame too large", http.StatusRequestEntityTooLarge)
		return
	case err != nil:
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		if errors.Is(err, store.ErrInvalidID) {
			http.Error(w, "invalid chat id", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	if errors.Is(err, store.ErrInvalidID) {
		http.Error(w, "invalid blob id", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		if errors.Is(err, store.ErrInvalidID) {
			http.Error(w, "invalid chat id", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleGetBlob(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	blobID := r.PathValue("id")

	reader, err := h.store.GetBlob(r.Context(), userID, blobID)
	if errors.Is(err, store.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if errors.Is(err, store.ErrInvalidID) {
		http.Error(w, "invalid blob id", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, reader)
}

func (h *Handler) handlePutBlob(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	blobID := r.PathValue("id")

	if err := h.store.PutBlob(r.Context(), userID, blobID, r.Body); err != nil {
		if errors.Is(err, store.ErrInvalidID) {
			http.Error(w, "invalid blob id", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if files == nil {
		files = []store.FileMeta{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (h *Handler) handleGetFile(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	fileID := r.PathValue("id")

	reader, etag, err := h.store.GetFile(r.Context(), userID, fileID)
	if errors.Is(err, store.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if errors.Is(err, store.ErrInvalidID) {
		http.Error(w, "invalid file id", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", `"`+etag+`"`)
	io.Copy(w, reader)
}

func (h *Handler) handlePutFile(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	fileID := r.PathValue("id")

	ifMatch := strings.Trim(r.Header.Get("If-Match"), `"`)
	ifNone := strings.TrimSpace(r.Header.Get("If-None-Match"))

	var cas string
	switch {
	case ifNone == "*":
		cas = "*"
	case ifMatch != "":
		cas = ifMatch
	}

	etag, err := h.store.PutFile(r.Context(), userID, fileID, r.Body, cas)
	if errors.Is(err, store.ErrFileConflict) {
		http.Error(w, "file conflict", http.StatusPreconditionFailed)
		return
	}
	if errors.Is(err, store.ErrInvalidID) {
		http.Error(w, "invalid file id", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("ETag", `"`+etag+`"`)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	fileID := r.PathValue("id")

	if err := h.store.DeleteFile(r.Context(), userID, fileID); err != nil {
		if errors.Is(err, store.ErrInvalidID) {
			http.Error(w, "invalid file id", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleDeleteBlob(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}

	blobID := r.PathValue("id")

	if err := h.store.DeleteBlob(r.Context(), userID, blobID); err != nil {
		if errors.Is(err, store.ErrInvalidID) {
			http.Error(w, "invalid blob id", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
