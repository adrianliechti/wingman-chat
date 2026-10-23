package public

import (
	"io"
	"io/fs"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// Serve build-time compression variants directly from disk. The OS page cache
// keeps hot files in memory without retaining another copy in the Go heap or
// spending CPU compressing large WASM runtimes during requests.
func (h *Handler) serveAsset(w http.ResponseWriter, r *http.Request, name string, original fs.FileInfo) {
	w.Header().Add("Vary", "Accept-Encoding")

	encodings := acceptedEncodings(r.Header.Values("Accept-Encoding"))
	if r.Header.Get("Range") != "" {
		// Keep ranges over the original bytes when the client permits it.
		for _, encoding := range encodings {
			if encoding == "identity" {
				encodings = []string{"identity"}
				break
			}
		}
	}
	for _, encoding := range encodings {
		filename := name
		switch encoding {
		case "br":
			filename += ".br"
		case "gzip":
			filename += ".gz"
		}

		file, err := h.dist.Open(filename)
		if err != nil {
			if encoding == "identity" {
				http.Error(w, "asset unavailable", http.StatusInternalServerError)
				return
			}
			continue
		}
		info, err := file.Stat()
		if err != nil || info.IsDir() || (encoding != "identity" && info.ModTime().Before(original.ModTime())) {
			file.Close()
			continue
		}
		content, ok := file.(io.ReadSeeker)
		if !ok {
			file.Close()
			http.Error(w, "asset is not seekable", http.StatusInternalServerError)
			return
		}
		defer file.Close()

		w.Header().Set("Cache-Control", cacheControl(name))
		if encoding != "identity" {
			w.Header().Set("Content-Encoding", encoding)
			// ServeContent otherwise omits the length for encoded responses.
			w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
			if r.Header.Get("Range") != "" {
				// If identity is forbidden, send the complete encoded file. A
				// fragment (or multipart body) cannot be decoded independently.
				r = r.Clone(r.Context())
				r.Header.Del("Range")
			}
		}
		// Use the original filename for MIME detection (especially application/wasm).
		// ServeContent handles HEAD, conditional requests and byte ranges over the
		// selected representation, including clearing encoding headers on errors.
		http.ServeContent(w, r, name, info.ModTime(), content)
		return
	}

	http.Error(w, "no acceptable asset encoding", http.StatusNotAcceptable)
}

// Prefer Brotli on ties, then gzip, while honoring explicit weights, exclusions
// and wildcards. An unspecified identity is the fallback, not a preference over
// a compressed representation the client explicitly accepts.
func acceptedEncodings(headers []string) []string {
	weights := make(map[string]float64)
	for _, field := range strings.Split(strings.Join(headers, ","), ",") {
		parts := strings.Split(field, ";")
		name := strings.ToLower(strings.TrimSpace(parts[0]))
		if name == "" {
			continue
		}
		weight := 1.0
		for _, param := range parts[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(param), "=")
			if ok && strings.EqualFold(strings.TrimSpace(key), "q") {
				parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
				if err != nil || !(parsed >= 0 && parsed <= 1) {
					weight = 0
				} else {
					weight = parsed
				}
			}
		}
		weights[name] = weight
	}

	var encodings []string
	for _, name := range []string{"br", "gzip", "identity"} {
		weight, explicit := weights[name]
		if !explicit && name != "identity" {
			weight = weights["*"]
			weights[name] = weight
		}
		if weight > 0 {
			encodings = append(encodings, name)
		}
	}
	sort.SliceStable(encodings, func(i, j int) bool {
		return weights[encodings[i]] > weights[encodings[j]]
	})
	if _, explicit := weights["identity"]; !explicit {
		if wildcard, present := weights["*"]; !present || wildcard > 0 {
			encodings = append(encodings, "identity")
		}
	}
	return encodings
}
