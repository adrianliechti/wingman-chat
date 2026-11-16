package store

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

func (h *Handler) handleListChats(w http.ResponseWriter, r *http.Request) {
	chats, err := h.store.ListChats(r.Context())
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

	reader, err := h.store.ReadEvents(r.Context(), chatID, fromSeq)
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

	res, err := h.store.AppendEvents(r.Context(), chatID, expectedSeq, ids, frames)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (h *Handler) handleCompactChat(w http.ResponseWriter, r *http.Request) {
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

	if err := h.store.CompactChat(r.Context(), chatID, beforeSeq); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleDeleteChat(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("id")
	expectedSeq, err := strconv.ParseInt(r.Header.Get("X-Expected-Seq"), 10, 64)
	if err != nil || expectedSeq < 0 {
		http.Error(w, "valid X-Expected-Seq required", http.StatusBadRequest)
		return
	}

	if err := h.store.DeleteChat(r.Context(), chatID, expectedSeq); err != nil {
		if errors.Is(err, store.ErrSeqConflict) {
			http.Error(w, err.Error(), http.StatusPreconditionFailed)
			return
		}
		writeStoreError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
