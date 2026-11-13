package store

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/store"
)

// writeStoreError is the single mapping from provider errors to HTTP status.
// Upstream storage errors expose HTTPStatus (and optionally RetryAfter); only
// statuses the client can act on are passed through, everything else is 500.
func writeStoreError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	var tooLarge *http.MaxBytesError
	var upstream interface{ HTTPStatus() int }
	switch {
	case errors.As(err, &tooLarge), errors.Is(err, store.ErrFrameTooLarge):
		status = http.StatusRequestEntityTooLarge
	case errors.Is(err, store.ErrInvalidID):
		status = http.StatusBadRequest
	case errors.Is(err, store.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, store.ErrBackupConflict), errors.Is(err, store.ErrSeqConflict):
		status = http.StatusConflict
	case errors.Is(err, store.ErrObjectConflict), errors.Is(err, store.ErrKeystoreConflict):
		status = http.StatusPreconditionFailed
	case errors.As(err, &upstream):
		switch code := upstream.HTTPStatus(); code {
		case http.StatusUnauthorized, http.StatusForbidden, http.StatusInsufficientStorage:
			status = code
		case http.StatusTooManyRequests:
			status = code
			var throttled interface{ RetryAfter() time.Duration }
			if errors.As(err, &throttled) && throttled.RetryAfter() > 0 {
				w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(throttled.RetryAfter().Seconds()))))
			}
		}
	}
	http.Error(w, err.Error(), status)
}

func (h *Handler) handleResetBackup(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := requireUser(w, r)
	if !ok {
		return
	}
	// A non-simple header prevents cross-origin form submissions. Reset needs
	// the signed-in account, not the lost PIN/passkey used for decryption.
	if r.Header.Get("X-Confirm-Backup-Reset") != "true" {
		http.Error(w, "Backup reset confirmation required", http.StatusBadRequest)
		return
	}
	if err := h.store.ResetUser(r.Context(), userID, r.Header.Get("X-Backup-Reset-ID")); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
