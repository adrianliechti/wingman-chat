package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBackupJSONConfiguration(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Fatal(err)
		}
	})
	t.Setenv("BACKUP_PROVIDER", "")
	t.Setenv("BACKUP_DRIVE", "")
	t.Setenv("STORE_ENABLED", "")
	for _, directory := range []string{"root", "public", "dist"} {
		t.Run(directory, func(t *testing.T) {
			parent, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := os.Chdir(parent); err != nil {
					t.Error(err)
				}
			}()
			root := t.TempDir()
			if err := os.Chdir(root); err != nil {
				t.Fatal(err)
			}
			filename := "config.json"
			if directory != "root" {
				if err := os.Mkdir(directory, 0700); err != nil {
					t.Fatal(err)
				}
				filename = filepath.Join(directory, filename)
			}
			if err := os.WriteFile(filename, []byte(`{"backup":{"provider":"onedrive","drive":"personal"},"title":"browser title"}`), 0600); err != nil {
				t.Fatal(err)
			}
			var cfg Config
			loadConfigFiles(&cfg)
			applyEnvOverrides(&cfg)
			if cfg.Backup == nil || cfg.Backup.Provider != "onedrive" || cfg.Backup.Drive != "personal" {
				t.Fatalf("JSON backup not enabled: %+v", cfg)
			}
			if cfg.Title != "" {
				t.Fatal("unrelated browser fields changed server configuration")
			}
		})
	}
}

func TestBackupJSONPrecedence(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Fatal(err)
		}
	})
	t.Setenv("BACKUP_PROVIDER", "")
	t.Setenv("BACKUP_DRIVE", "")
	t.Setenv("STORE_ENABLED", "")
	if err := os.Mkdir("public", 0700); err != nil {
		t.Fatal(err)
	}
	write := func(filename, body string) {
		t.Helper()
		if err := os.WriteFile(filename, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("public/config.json", `{"backup":{"provider":"onedrive","drive":"personal"}}`)
	write("config.json", `{}`)
	if cfg := Load(); cfg.Backup != nil {
		t.Fatalf("root JSON did not take precedence: %+v", cfg.Backup)
	}
	write("config.json", `{"backup":{"provider":"onedrive","drive":"personal"}}`)
	if cfg := Load(); cfg.Backup == nil || cfg.Backup.Provider != "onedrive" {
		t.Fatalf("JSON not loaded: %+v", cfg.Backup)
	}
	write("backup.yaml", "provider: local\n")
	if cfg := Load(); cfg.Backup == nil || cfg.Backup.Provider != "local" {
		t.Fatalf("YAML did not take precedence: %+v", cfg.Backup)
	}
	t.Setenv("BACKUP_PROVIDER", "onedrive")
	t.Setenv("BACKUP_DRIVE", "override")
	if cfg := Load(); cfg.Backup.Provider != "onedrive" || cfg.Backup.Drive != "override" {
		t.Fatalf("environment overrides lost: %+v", cfg.Backup)
	}
}

func TestInvalidBackupJSONFailsStartup(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Fatal(err)
		}
	})
	if err := os.WriteFile("config.json", []byte(`{"backup":{"provider":42}}`), 0600); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("invalid JSON was silently ignored")
		}
	}()
	Load()
}

func TestLocalBackupDefaultAndExplicitProviders(t *testing.T) {
	for _, test := range []struct {
		name         string
		backup       *Backup
		wantProvider string
	}{
		{name: "absent defaults to local"},
		{name: "empty backup defaults to local", backup: &Backup{}, wantProvider: "local"},
		{name: "explicit local", backup: &Backup{Provider: "local"}, wantProvider: "local"},
		{name: "onedrive", backup: &Backup{Provider: "onedrive"}, wantProvider: "onedrive"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("BACKUP_PROVIDER", "")
			t.Setenv("BACKUP_DRIVE", "")
			t.Setenv("STORE_ENABLED", "")
			cfg := &Config{Backup: test.backup}
			applyEnvOverrides(cfg)
			if test.wantProvider != "" && (cfg.Backup == nil || cfg.Backup.Provider != test.wantProvider) {
				t.Fatalf("provider: %+v", cfg.Backup)
			}
		})
	}
}
