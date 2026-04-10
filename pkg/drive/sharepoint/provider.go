package sharepoint

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/drive"
	"github.com/adrianliechti/wingman-chat/pkg/drive/graph"
)

var _ drive.Provider = (*Provider)(nil)

type Provider struct {
	hostname string
	client   *http.Client
}

func New(siteURL string) (*Provider, error) {
	u, err := url.Parse(siteURL)

	if err != nil {
		return nil, fmt.Errorf("invalid site URL: %w", err)
	}

	if u.Host == "" {
		return nil, fmt.Errorf("site URL must include hostname: %s", siteURL)
	}

	return &Provider{
		hostname: u.Host,
		client:   http.DefaultClient,
	}, nil
}

type graphSite struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Name        string `json:"name"`
	WebURL      string `json:"webUrl"`
}

type graphSiteResponse struct {
	Value []graphSite `json:"value"`
}

func (p *Provider) List(ctx context.Context, id string) ([]drive.Entry, error) {
	token := drive.TokenFromContext(ctx)
	if token == "" {
		return nil, fmt.Errorf("authorization token required")
	}

	if id == "" {
		return p.listSites(ctx, token)
	}

	// {driveID}/id:{itemID} → list children of item
	if driveID, itemID, ok := parseItemID(id); ok {
		return p.listItems(ctx, token, driveID, itemID)
	}

	// siteID (contains commas) → list drives for site
	if strings.Contains(id, ",") {
		return p.listDrives(ctx, token, id)
	}

	// bare driveID → list drive root
	return p.listItems(ctx, token, id, "")
}

func (p *Provider) Open(ctx context.Context, identifier string) (io.ReadCloser, string, int64, error) {
	token := drive.TokenFromContext(ctx)
	if token == "" {
		return nil, "", 0, fmt.Errorf("authorization token required")
	}

	driveID, itemID, ok := parseItemID(identifier)
	if !ok {
		return nil, "", 0, fmt.Errorf("invalid identifier: %s", identifier)
	}

	return graph.DownloadByID(ctx, p.client, token, driveID, itemID)
}

func (p *Provider) listSites(ctx context.Context, token string) ([]drive.Entry, error) {
	apiURL := graph.GraphURL + "/sites?search=*&$select=id,displayName,name,webUrl"

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

	var result graphSiteResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var entries []drive.Entry

	for _, s := range result.Value {
		if u, err := url.Parse(s.WebURL); err == nil && u.Host != p.hostname {
			continue
		}

		name := s.DisplayName
		if name == "" {
			name = s.Name
		}

		entries = append(entries, drive.Entry{
			ID:   s.ID,
			Name: name,
			Kind: "directory",
		})
	}

	return entries, nil
}

func (p *Provider) listDrives(ctx context.Context, token, siteID string) ([]drive.Entry, error) {
	apiURL := graph.GraphURL + "/sites/" + siteID + "/drives"

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
			entries = append(entries, graph.ToEntry(driveID, item))
		}

		apiURL = nextLink
	}

	return entries, nil
}

// parseItemID splits an entry ID of the form "{driveID}/id:{itemID}".
func parseItemID(id string) (driveID, itemID string, ok bool) {
	driveID, rest, ok := strings.Cut(id, "/id:")
	if !ok {
		return "", "", false
	}

	return driveID, rest, true
}
