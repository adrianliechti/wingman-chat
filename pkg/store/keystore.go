package store

import "encoding/json"

// PreservesBackupKey prevents a protection update from orphaning existing
// ciphertext by dropping or replacing its asymmetric backup key envelope.
func PreservesBackupKey(current, next []byte) bool {
	var previous, replacement map[string]json.RawMessage
	if json.Unmarshal(current, &previous) != nil || len(previous["backup"]) == 0 || string(previous["backup"]) == "null" {
		return true
	}
	if json.Unmarshal(next, &replacement) != nil {
		return false
	}
	var oldKey, newKey struct {
		Generation          string `json:"generation"`
		PublicKey           string `json:"publicKey"`
		EncryptedPrivateKey string `json:"encryptedPrivateKey"`
	}
	return json.Unmarshal(previous["backup"], &oldKey) == nil && json.Unmarshal(replacement["backup"], &newKey) == nil && oldKey.PublicKey == newKey.PublicKey && oldKey.EncryptedPrivateKey == newKey.EncryptedPrivateKey && (oldKey.Generation == "" || oldKey.Generation == newKey.Generation)
}
