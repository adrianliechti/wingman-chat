package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/adrianliechti/wingman-chat/pkg/drive"
)

const GraphURL = "https://graph.microsoft.com/v1.0"

type DriveItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`

	Folder *struct {
		ChildCount int `json:"childCount"`
	} `json:"folder"`

	File *struct {
		MimeType string `json:"mimeType"`
	} `json:"file"`

	ParentReference *struct {
		DriveID string `json:"driveId"`
	} `json:"parentReference"`
}

type DriveItemResponse struct {
	Value    []DriveItem `json:"value"`
	NextLink string      `json:"@odata.nextLink"`
}

type Drive struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	DriveType string `json:"driveType"`
}

type DriveResponse struct {
	Value []Drive `json:"value"`
}

func FetchPage(ctx context.Context, client *http.Client, token, apiURL string) ([]DriveItem, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, "", err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, "", fmt.Errorf("graph API error (%d): %s", resp.StatusCode, string(body))
	}

	var result DriveItemResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, "", err
	}

	return result.Value, result.NextLink, nil
}

func Download(ctx context.Context, client *http.Client, token, apiURL string) (io.ReadCloser, string, int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, "", 0, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
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

func DownloadByID(ctx context.Context, client *http.Client, token, driveID, itemID string) (io.ReadCloser, string, int64, error) {
	apiURL := GraphURL + "/drives/" + driveID + "/items/" + itemID + "/content"
	return Download(ctx, client, token, apiURL)
}

func ToEntry(driveID string, item DriveItem) drive.Entry {
	entry := drive.Entry{
		Name: item.Name,
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

	if item.ID != "" {
		entry.ID = driveID + "/id:" + item.ID
	}

	return entry
}
