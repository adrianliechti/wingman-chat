package sharepoint

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/adrianliechti/wingman-chat/pkg/drive"
	"github.com/adrianliechti/wingman-chat/pkg/drive/graph"
)

var _ drive.Provider = (*Provider)(nil)
var _ drive.InsightsProvider = (*Provider)(nil)

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

const graphURL = "https://graph.microsoft.com/v1.0"

type graphSite struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Name        string `json:"name"`
	WebURL      string `json:"webUrl"`
}

type graphSiteResponse struct {
	Value []graphSite `json:"value"`
}

type graphDrive struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	DriveType string `json:"driveType"`
}

type graphDriveResponse struct {
	Value []graphDrive `json:"value"`
}

type driveItemResponse struct {
	Value    []driveItem `json:"value"`
	NextLink string      `json:"@odata.nextLink"`
}

type driveItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Folder *struct {
		ChildCount int `json:"childCount"`
	} `json:"folder"`
	File *struct {
		MimeType string `json:"mimeType"`
	} `json:"file"`
	DownloadURL string `json:"@microsoft.graph.downloadUrl"`
}

// parsePath splits the path into site ID, drive ID, and file path.
//
//	"" → list sites
//	"{siteId}" → list drives
//	"{siteId}/{driveId}" → list drive root
//	"{siteId}/{driveId}/folder/file" → navigate deeper
func parsePath(p string) (siteID, driveID, filePath string) {
	if p == "" {
		return
	}

	parts := strings.SplitN(p, "/", 3)

	siteID = parts[0]

	if len(parts) > 1 {
		driveID = parts[1]
	}

	if len(parts) > 2 {
		filePath = parts[2]
	}

	return
}

func (p *Provider) List(ctx context.Context, filePath string) ([]drive.Entry, error) {
	token := drive.TokenFromContext(ctx)
	if token == "" {
		return nil, fmt.Errorf("authorization token required")
	}

	siteID, driveID, itemPath := parsePath(filePath)

	if siteID == "" {
		return p.listSites(ctx, token)
	}

	if driveID == "" {
		return p.listDrives(ctx, token, siteID, filePath)
	}

	return p.listItems(ctx, token, driveID, itemPath, filePath)
}

func (p *Provider) Open(ctx context.Context, filePath string) (io.ReadCloser, string, int64, error) {
	token := drive.TokenFromContext(ctx)
	if token == "" {
		return nil, "", 0, fmt.Errorf("authorization token required")
	}

	_, driveID, itemPath := parsePath(filePath)
	if driveID == "" || itemPath == "" {
		return nil, "", 0, fmt.Errorf("invalid file path: %s", filePath)
	}

	return p.downloadItem(ctx, token, driveID, itemPath)
}

func (p *Provider) listSites(ctx context.Context, token string) ([]drive.Entry, error) {
	apiURL := graphURL + "/sites?search=*&$select=id,displayName,name,webUrl"

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
		// filter to configured hostname
		if u, err := url.Parse(s.WebURL); err == nil && u.Host != p.hostname {
			continue
		}

		name := s.DisplayName
		if name == "" {
			name = s.Name
		}

		entries = append(entries, drive.Entry{
			Name: name,
			Path: s.ID,
			Kind: "directory",
		})
	}

	return entries, nil
}

func (p *Provider) listDrives(ctx context.Context, token, siteID, fullPath string) ([]drive.Entry, error) {
	apiURL := graphURL + "/sites/" + siteID + "/drives"

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

	var result graphDriveResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var entries []drive.Entry

	for _, d := range result.Value {
		entries = append(entries, drive.Entry{
			Name: d.Name,
			Path: fullPath + "/" + d.ID,
			Kind: "directory",
		})
	}

	return entries, nil
}

func (p *Provider) listItems(ctx context.Context, token, driveID, filePath, fullPath string) ([]drive.Entry, error) {
	var apiURL string

	if filePath == "" {
		apiURL = graphURL + "/drives/" + driveID + "/root/children"
	} else {
		apiURL = graphURL + "/drives/" + driveID + "/root:/" + encodePath(filePath) + ":/children"
	}

	var entries []drive.Entry

	for apiURL != "" {
		page, nextLink, err := p.fetchPage(ctx, token, apiURL)
		if err != nil {
			return nil, err
		}

		for _, item := range page {
			entries = append(entries, toEntry(fullPath, item))
		}

		apiURL = nextLink
	}

	return entries, nil
}

func (p *Provider) fetchPage(ctx context.Context, token, apiURL string) ([]driveItem, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, "", err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, "", err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, "", fmt.Errorf("graph API error (%d): %s", resp.StatusCode, string(body))
	}

	var result driveItemResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, "", err
	}

	return result.Value, result.NextLink, nil
}

func (p *Provider) downloadItem(ctx context.Context, token, driveID, itemPath string) (io.ReadCloser, string, int64, error) {
	apiURL := graphURL + "/drives/" + driveID + "/root:/" + encodePath(itemPath) + ":/content"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, "", 0, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, "", 0, err
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, "", 0, fmt.Errorf("graph API error (%d): %s", resp.StatusCode, string(body))
	}

	mimeType := resp.Header.Get("Content-Type")
	size, _ := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)

	return resp.Body, mimeType, size, nil
}

func (p *Provider) Insights(ctx context.Context) ([]drive.InsightCategory, error) {
	token := drive.TokenFromContext(ctx)
	if token == "" {
		return nil, fmt.Errorf("authorization token required")
	}

	return graph.FetchInsights(ctx, p.client, token)
}

func encodePath(p string) string {
	parts := strings.Split(p, "/")

	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}

func toEntry(parent string, item driveItem) drive.Entry {
	entry := drive.Entry{
		Name: item.Name,
		Path: path.Join(parent, item.Name),
		Size: item.Size,
	}

	if item.Folder != nil {
		entry.Kind = "directory"
	} else {
		entry.Kind = "file"
		if item.File != nil {
			entry.Mime = item.File.MimeType
		}
	}

	return entry
}
