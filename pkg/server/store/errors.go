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
	case errors.Is(err, store.ErrInvalidID), errors.Is(err, store.ErrInvalidUpload):
		status = http.StatusBadRequest
	case errors.Is(err, store.ErrDirectUnavailable):
		status = http.StatusNotImplemented
	case errors.Is(err, store.ErrUploadIncomplete):
		status = http.StatusTooEarly
	case errors.Is(err, store.ErrInvalidBackup):
		status = http.StatusUnprocessableEntity
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
