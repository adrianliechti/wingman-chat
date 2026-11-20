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

type invalidAppendBody struct{ error }

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

	events := func(yield func(store.EventFrame, error) bool) {
		hasEvents := false
		for scanner.Scan() {
			// Scan may yield a truncated last line alongside a body read error.
			if scanner.Err() != nil {
				break
			}
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}
			var event store.EventFrame
			if err := json.Unmarshal(line, &event); err != nil {
				yield(store.EventFrame{}, invalidAppendBody{errors.New("invalid request line")})
				return
			}
			if event.ID == "" || event.Frame == "" {
				yield(store.EventFrame{}, invalidAppendBody{errors.New("id and frame required")})
				return
			}
			hasEvents = true
			if !yield(event, nil) {
				return
			}
		}
		if err := scanner.Err(); err != nil {
			var tooLarge *http.MaxBytesError
			switch {
			case errors.Is(err, bufio.ErrTooLong):
				yield(store.EventFrame{}, store.ErrFrameTooLarge)
			case errors.As(err, &tooLarge):
				yield(store.EventFrame{}, err)
			default:
				yield(store.EventFrame{}, invalidAppendBody{err})
			}
		} else if !hasEvents {
			yield(store.EventFrame{}, invalidAppendBody{errors.New("no events")})
		}
	}

	res, err := h.store.AppendEventStream(r.Context(), chatID, expectedSeq, events)
	if err != nil {
		var badBody invalidAppendBody
		if errors.As(err, &badBody) {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else {
			writeStoreError(w, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (h *Handler) handleAppendChatBatch(appender store.ChatBatchAppender) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, store.MaxChatBatchBytes))
		var writes []store.ChatAppend
		err := decoder.Decode(&writes)
		if err == nil {
			err = decoder.Decode(new(json.RawMessage))
			switch err {
			case io.EOF:
				err = nil
			case nil:
				err = errors.New("trailing data")
			}
		}
		var tooLarge *http.MaxBytesError
		switch {
		case errors.As(err, &tooLarge):
			writeStoreError(w, err)
			return
		case err != nil || len(writes) < 2 || len(writes) > store.MaxChatBatchChats:
			http.Error(w, "invalid chat append batch", http.StatusBadRequest)
			return
		}
		for _, write := range writes {
			if write.ExpectedSeq < 0 || len(write.Events) == 0 {
				http.Error(w, "invalid chat append", http.StatusBadRequest)
				return
			}
			for _, event := range write.Events {
				if event.ID == "" || event.Frame == "" {
					http.Error(w, "id and frame required", http.StatusBadRequest)
					return
				}
			}
		}
		results, err := appender.AppendChatBatch(r.Context(), writes)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	}
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
