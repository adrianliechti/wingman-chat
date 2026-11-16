package store

import (
	"encoding/json"
	"net/http"

	"github.com/adrianliechti/wingman-chat/pkg/server/identity"
)

func (h *Handler) handleResetBackup(w http.ResponseWriter, r *http.Request, user identity.User) {
	// A non-simple header prevents cross-origin form submissions. Reset needs
	// the signed-in account, not the lost PIN/passkey used for decryption.
	if r.Header.Get("X-Confirm-Backup-Reset") != "true" {
		http.Error(w, "Backup reset confirmation required", http.StatusBadRequest)
		return
	}
	if err := h.store.ResetUser(r.Context(), user.Key, r.Header.Get("X-Backup-Reset-ID")); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleBackupUsage(w http.ResponseWriter, r *http.Request, user identity.User) {
	size, err := h.store.BackupSize(r.Context(), user.Key)
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
