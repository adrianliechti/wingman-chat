package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"

	"github.com/adrianliechti/wingman-chat/pkg/drive"
)

const graphURL = "https://graph.microsoft.com/v1.0"

type insightResponse struct {
	Value []insightItem `json:"value"`
}

type insightItem struct {
	ResourceVisualization struct {
		Title     string `json:"title"`
		MediaType string `json:"mediaType"`
	} `json:"resourceVisualization"`
	ResourceReference struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	} `json:"resourceReference"`
}

type itemResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`

	File *struct {
		MimeType string `json:"mimeType"`
	} `json:"file"`

	ParentReference *struct {
		DriveID string `json:"driveId"`
		Path    string `json:"path"`
	} `json:"parentReference"`
}

type insightDef struct {
	endpoint string
	label    string
}

var insightDefs = []insightDef{
	{endpoint: "/me/insights/used", label: "Recently Used"},
	{endpoint: "/me/insights/trending", label: "Trending"},
}

func FetchInsights(ctx context.Context, client *http.Client, token string) ([]drive.InsightCategory, error) {
	type result struct {
		category drive.InsightCategory
		err      error
	}

	results := make([]result, len(insightDefs))

	var wg sync.WaitGroup

	for i, def := range insightDefs {
		wg.Add(1)

		go func(idx int, d insightDef) {
			defer wg.Done()

			entries, err := fetchInsightCategory(ctx, client, token, d.endpoint)

			results[idx] = result{
				category: drive.InsightCategory{
					Label:   d.label,
					Entries: entries,
				},
				err: err,
			}
		}(i, def)
	}

	wg.Wait()

	var categories []drive.InsightCategory

	for _, r := range results {
		if r.err != nil || len(r.category.Entries) == 0 {
			continue
		}

		categories = append(categories, r.category)
	}

	return categories, nil
}

func fetchInsightCategory(ctx context.Context, client *http.Client, token, endpoint string) ([]drive.Entry, error) {
	apiURL := graphURL + endpoint + "?$top=10"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph API error (%d): %s", resp.StatusCode, string(body))
	}

	var result insightResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var entries []drive.Entry

	for _, item := range result.Value {
		if item.ResourceReference.Type != "microsoft.graph.driveItem" {
			continue
		}

		entry, err := resolveItem(ctx, client, token, item)
		if err != nil {
			continue
		}

		entries = append(entries, entry)
	}

	return entries, nil
}

func resolveItem(ctx context.Context, client *http.Client, token string, item insightItem) (drive.Entry, error) {
	apiURL := graphURL + "/me/insights/used/" + item.ResourceReference.ID + "/resource"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return drive.Entry{}, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return drive.Entry{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Fallback to visualization data if resource resolution fails
		return drive.Entry{
			Name: item.ResourceVisualization.Title,
			Kind: "file",
			Mime: item.ResourceVisualization.MediaType,
		}, nil
	}

	var resolved itemResponse
	if err := json.NewDecoder(resp.Body).Decode(&resolved); err != nil {
		return drive.Entry{}, err
	}

	entry := drive.Entry{
		Name: resolved.Name,
		Size: resolved.Size,
		Kind: "file",
	}

	if resolved.File != nil {
		entry.Mime = resolved.File.MimeType
	}

	if resolved.ParentReference != nil && resolved.ParentReference.DriveID != "" {
		entry.Path = resolved.ParentReference.DriveID + "/" + resolved.Name

		if resolved.ParentReference.Path != "" {
			// Path format: /drive/root:/folder/subfolder
			// Extract the relative part after "root:"
			p := resolved.ParentReference.Path
			if idx := len("/drive/root:"); len(p) > idx {
				relPath := p[idx:]
				if len(relPath) > 0 && relPath[0] == '/' {
					relPath = relPath[1:]
				}
				if relPath != "" {
					entry.Path = resolved.ParentReference.DriveID + "/" + relPath + "/" + resolved.Name
				}
			}
		}
	}

	return entry, nil
}
