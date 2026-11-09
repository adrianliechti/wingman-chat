package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// Read only the backup section: browser preferences in this JSON file do not
// replace the backend's other configuration. YAML and environment overrides are
// applied afterward. The first existing file wins, even without a backup field.
func loadBackupJSON(cfg *Config) {
	for _, filename := range []string{"config.json", "public/config.json", "dist/config.json"} {
		data, err := os.ReadFile(filename)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			panic(fmt.Errorf("backup configuration: %s: %w", filename, err))
		}
		var document struct {
			Backup *Backup `json:"backup"`
		}
		if err := json.Unmarshal(data, &document); err != nil {
			panic(fmt.Errorf("backup configuration: %s: %w", filename, err))
		}
		cfg.Backup = document.Backup
		return
	}
}
