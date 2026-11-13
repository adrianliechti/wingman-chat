package onedrive

import (
	"context"
	"errors"
	"net/url"
	"strings"
)

// Snapshot object names before the reset commits. Cleanup must never enumerate
// after committing: a new backup may already be publishing fresh objects then.
// Include unpublished objects left by earlier failed/uncertain writes.
func (p *Provider) resetObjects(ctx context.Context, userID string) ([]string, error) {
	folder, err := p.folder(ctx, userID)
	if err != nil {
		return nil, err
	}
	endpoint := p.base + "/me/drive/items/" + url.PathEscape(folder) + "/children"
	origin, _ := url.Parse(endpoint)
	next := endpoint + "?$select=name&$top=200"
	seen := map[string]bool{}
	var names []string
	for next != "" {
		pageURL, err := url.Parse(next)
		if err != nil || pageURL.Scheme != origin.Scheme || pageURL.Host != origin.Host || pageURL.Path != origin.Path || pageURL.User != nil || seen[next] {
			return nil, errors.New("OneDrive backup: invalid object listing continuation")
		}
		seen[next] = true
		var page struct {
			Value []struct {
				Name string `json:"name"`
			} `json:"value"`
			Next string `json:"@odata.nextLink"`
		}
		if err := p.jsonRequest(ctx, "GET", next, nil, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Value {
			if (strings.HasPrefix(item.Name, "data-") || strings.HasPrefix(item.Name, "probe-")) && objectName.MatchString(item.Name) {
				names = append(names, item.Name)
			}
		}
		next = page.Next
	}
	return names, nil
}
