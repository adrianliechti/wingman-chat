package store

import "net/http"

func (h *Handler) withUserLock(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _, ok := requireUser(w, r)
		if !ok {
			return
		}
		unlock, err := h.store.LockUser(r.Context(), userID, false)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer unlock()
		next(w, r)
	}
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
	if err := h.store.ResetUser(r.Context(), userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
