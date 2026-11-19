// Package onedrivetest provides an in-memory Microsoft Graph transport for integration tests.
package onedrivetest

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Graph struct {
	DriveID                  string
	UploadURL                string
	FailReadName             string
	Mu                       sync.Mutex
	Folders                  map[string]map[string][]byte
	FailIndex                bool
	Revisions                map[string]int
	NextRevision             int
	UploadData               []byte
	UploadFolder, UploadName string
	Fragments                int
	ChunkFailures            int
	// Modified backdates listed objects by "folder!name"; others report now.
	Modified map[string]time.Time
}

func (g *Graph) RoundTrip(r *http.Request) (*http.Response, error) {
	g.Mu.Lock()
	defer g.Mu.Unlock()
	status := 200
	var output []byte
	reply := func(value any) { output, _ = json.Marshal(value) }
	driveID := g.DriveID
	if driveID == "" {
		driveID = "test-drive"
	}
	folderItem := func(name string) {
		reply(map[string]any{"id": name, "folder": map[string]any{}, "parentReference": map[string]string{"driveId": driveID}})
	}
	path := strings.TrimPrefix(r.URL.Path, "/v1.0/me/drive/")
	// Resolve fake driveItem IDs used for conditional content replacement.
	if id, ok := strings.CutPrefix(path, "items/"); ok && strings.HasSuffix(id, "/content") && strings.Contains(id, "!") {
		folder, name, _ := strings.Cut(strings.TrimSuffix(id, "/content"), "!")
		path = "items/" + folder + ":/" + name + ":/content"
	}
	if g.Revisions == nil {
		g.Revisions = map[string]int{}
	}
	if r.URL.Host == "upload.1drv.com" {
		if r.Header.Get("Authorization") != "" {
			panic("token leaked to upload host")
		}
		if r.Method == "DELETE" {
			return &http.Response{StatusCode: 204, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
		}
		if g.ChunkFailures > 0 {
			g.ChunkFailures--
			return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{"Retry-After": {"1"}}}, nil
		}
		var first, last, total int64
		if _, err := fmt.Sscanf(r.Header.Get("Content-Range"), "bytes %d-%d/%d", &first, &last, &total); err != nil {
			panic(err)
		}
		data, _ := io.ReadAll(r.Body)
		if int64(len(data)) != last-first+1 || first != int64(len(g.UploadData)) {
			panic("invalid fragment range")
		}
		if last+1 < total && len(data)%(320*1024) != 0 {
			panic("unaligned fragment")
		}
		g.UploadData = append(g.UploadData, data...)
		g.Fragments++
		status = 202
		if last+1 == total {
			status = 201
			g.Folders[g.UploadFolder][g.UploadName] = append([]byte(nil), g.UploadData...)
			reply(map[string]string{"id": "uploaded"})
		}
	} else if r.Header.Get("Authorization") != "Bearer graph-token" {
		status = 401
	} else if path == "special/approot" {
		reply(map[string]any{"id": "root", "folder": map[string]any{}})
	} else if path == "items/root/children" {
		var input struct {
			Name string `json:"name"`
		}
		_ = json.NewDecoder(r.Body).Decode(&input)
		if _, ok := g.Folders[input.Name]; ok {
			status = 409
		} else {
			g.Folders[input.Name] = map[string][]byte{}
			status = 201
			folderItem(input.Name)
		}
	} else if strings.HasPrefix(path, "items/root:/") {
		name := strings.TrimPrefix(path, "items/root:/")
		if _, ok := g.Folders[name]; !ok {
			status = 404
		} else {
			folderItem(name)
		}
	} else if strings.HasPrefix(path, "items/") {
		rest := strings.TrimPrefix(path, "items/")
		folder, tail, hasObject := strings.Cut(rest, ":/")
		listing := !hasObject && strings.HasSuffix(folder, "/children")
		if listing {
			folder = strings.TrimSuffix(folder, "/children")
		}
		files, exists := g.Folders[folder]
		if !exists {
			status = 404
		} else if listing {
			items := []map[string]any{}
			for name := range files {
				modified, ok := g.Modified[folder+"!"+name]
				if !ok {
					modified = time.Now()
				}
				items = append(items, map[string]any{"name": name, "lastModifiedDateTime": modified})
			}
			reply(map[string]any{"value": items})
		} else if !hasObject {
			if r.Method == "DELETE" {
				delete(g.Folders, folder)
				status = 204
			} else {
				var size int
				for _, data := range files {
					size += len(data)
				}
				reply(map[string]any{"id": folder, "size": size, "folder": map[string]any{}})
			}
		} else if strings.HasSuffix(tail, ":/createUploadSession") {
			g.UploadFolder = folder
			g.UploadName = strings.TrimSuffix(tail, ":/createUploadSession")
			g.UploadData = nil
			uploadURL := g.UploadURL
			if uploadURL == "" {
				uploadURL = "https://upload.1drv.com/session?secret=hidden"
			}
			reply(map[string]any{"uploadUrl": uploadURL, "expirationDateTime": time.Now().Add(time.Hour)})
		} else {
			name := strings.TrimSuffix(tail, ":/content")
			key := folder + "!" + name
			etag := func() string { return fmt.Sprintf(`"%d"`, g.Revisions[key]) }
			item := func() {
				meta := map[string]any{"id": key, "eTag": etag(), "size": len(files[name])}
				if strings.Contains(r.URL.Query().Get("$select"), "file") {
					meta["file"] = map[string]any{"hashes": map[string]string{"quickXorHash": QuickXor(files[name])}}
				}
				reply(meta)
			}
			switch r.Method {
			case "GET":
				if name == g.FailReadName {
					status = 500
					break
				}
				var ok bool
				output, ok = files[name]
				if !ok {
					status = 404
				}
				if ok && !strings.HasSuffix(tail, ":/content") {
					item()
				}
			case "PUT":
				_, exists := files[name]
				if name == "index.json" && g.FailIndex {
					status = 500
				} else if r.Header.Get("If-Match") != "" && (!exists || r.Header.Get("If-Match") != etag()) {
					status = 412
				} else if exists && (r.Header.Get("If-None-Match") == "*" || r.URL.Query().Get("@microsoft.graph.conflictBehavior") == "fail") {
					status = 409
				} else {
					files[name], _ = io.ReadAll(r.Body)
					g.NextRevision++
					g.Revisions[key] = g.NextRevision
					item()
					status = 201
				}
			case "DELETE":
				delete(files, name)
				status = 204
			default:
				status = 405
			}
		}
	} else {
		status = 404
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(output)), Header: make(http.Header)}, nil
}

// QuickXor computes the OneDrive file checksum returned by the fake Graph API.
func QuickXor(data []byte) string {
	var checksum [20]byte
	for i, b := range data {
		shift := (i % 160) * 11 % 160
		checksum[shift/8] ^= b << (shift % 8)
		checksum[(shift/8+1)%20] ^= b >> (8 - shift%8)
	}
	var length [8]byte
	binary.LittleEndian.PutUint64(length[:], uint64(len(data)))
	for i, b := range length {
		checksum[12+i] ^= b
	}
	return base64.StdEncoding.EncodeToString(checksum[:])
}

// Accounts isolates Graph drives by bearer token, as Microsoft Graph does.
type Accounts struct {
	mu     sync.Mutex
	drives map[string]*Graph
}

func (a *Accounts) RoundTrip(r *http.Request) (*http.Response, error) {
	a.mu.Lock()
	if a.drives == nil {
		a.drives = make(map[string]*Graph)
	}
	token := r.Header.Get("Authorization")
	upload := r.URL.Host == "upload.1drv.com"
	if upload {
		token = r.URL.Query().Get("account")
	}
	g := a.drives[token]
	if g == nil {
		g = &Graph{DriveID: token, Folders: map[string]map[string][]byte{}, UploadURL: "https://upload.1drv.com/session?account=" + url.QueryEscape(token)}
		a.drives[token] = g
	}
	a.mu.Unlock()
	request := r.Clone(r.Context())
	if !upload {
		request.Header.Set("Authorization", "Bearer graph-token")
	}
	return g.RoundTrip(request)
}
