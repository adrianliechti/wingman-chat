package onedrive

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/drive"
	"github.com/adrianliechti/wingman-chat/pkg/drive/graph"
)

var _ drive.Provider = (*Provider)(nil)

type Provider struct {
	client *http.Client
}

func New() *Provider {
	return &Provider{
		client: http.DefaultClient,
	}
}

func (p *Provider) List(ctx context.Context, id string) ([]drive.Entry, error) {
	token := drive.TokenFromContext(ctx)
	if token == "" {
		return nil, fmt.Errorf("authorization token required")
	}

	if id == "" {
		return p.listDrives(ctx, token)
	}

	driveID, itemID := parseID(id)

	return p.listItems(ctx, token, driveID, itemID)
}

func (p *Provider) Open(ctx context.Context, identifier string) (io.ReadCloser, string, int64, error) {
	token := drive.TokenFromContext(ctx)
	if token == "" {
		return nil, "", 0, fmt.Errorf("authorization token required")
	}

	driveID, itemID := parseID(identifier)
	if driveID == "" || itemID == "" {
		return nil, "", 0, fmt.Errorf("invalid identifier: %s", identifier)
	}

	return graph.DownloadByID(ctx, p.client, token, driveID, itemID)
}

func (p *Provider) listDrives(ctx context.Context, token string) ([]drive.Entry, error) {
	apiURL := graph.GraphURL + "/me/drives"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph API error (%d): %s", resp.StatusCode, string(body))
	}

	var result graph.DriveResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var entries []drive.Entry

	for _, d := range result.Value {
		entries = append(entries, drive.Entry{
			ID:   d.ID,
			Name: d.Name,
			Kind: "directory",
		})
	}

	return entries, nil
}

func (p *Provider) listItems(ctx context.Context, token, driveID, itemID string) ([]drive.Entry, error) {
	var apiURL string

	if itemID == "" {
		apiURL = graph.GraphURL + "/drives/" + driveID + "/root/children"
	} else {
		apiURL = graph.GraphURL + "/drives/" + driveID + "/items/" + itemID + "/children"
	}

	var entries []drive.Entry

	for apiURL != "" {
		page, nextLink, err := graph.FetchPage(ctx, p.client, token, apiURL)
		if err != nil {
			return nil, err
		}

		for _, item := range page {
			if item.Name == "PersonalCacheLibrary" {
				continue
			}

			entries = append(entries, graph.ToEntry(driveID, item))
		}

		apiURL = nextLink
	}

	return entries, nil
}

// parseID splits an entry ID of the form "{driveID}/id:{itemID}".
// If the ID has no "/id:" separator, it is treated as a bare driveID.
func parseID(id string) (driveID, itemID string) {
	driveID, rest, ok := strings.Cut(id, "/id:")
	if ok {
		itemID = rest
	}

	return
}
