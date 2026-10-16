package otel

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"time"
)

const (
	maxInsightsBodyBytes = 8 << 20
	insightsTimeout      = 30 * time.Second
	maxInsightsInFlight  = 32
)

// Bound buffered exports while insights is slow or unreachable.
var insightsSlots = make(chan struct{}, maxInsightsInFlight)

// Match wingman's INSIGHTS_ENDPOINT convention: preserve explicit paths.
func insightsEndpoint(endpoint, defaultPath string) string {
	if endpoint == "" {
		return ""
	}

	parsed, err := url.Parse(endpoint)

	if err != nil || parsed.Path != "" {
		return endpoint
	}

	return parsed.JoinPath(defaultPath).String()
}

// Copy independently of the primary collector; only its response reaches the browser.
func withInsights(next http.Handler, endpoints ...string) http.Handler {
	targets := make([]string, 0, len(endpoints))

	for _, endpoint := range endpoints {
		if endpoint != "" {
			targets = append(targets, endpoint)
		}
	}

	if len(targets) == 0 {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if body, ok := captureBody(r); ok {
			for _, target := range targets {
				exportInsights(target, r.Header.Get("Content-Type"), r.Header.Get("Content-Encoding"), body)
			}
		}

		next.ServeHTTP(w, r)
	})
}

type bodyReader struct {
	io.Reader
	io.Closer
}

// Replay consumed bytes to the primary collector even when capture fails or exceeds the limit.
func captureBody(r *http.Request) ([]byte, bool) {
	if r.Body == nil || r.Body == http.NoBody {
		return nil, false
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxInsightsBodyBytes+1))

	if err != nil || len(body) > maxInsightsBodyBytes {
		r.Body = bodyReader{Reader: io.MultiReader(bytes.NewReader(body), r.Body), Closer: r.Body}
		return nil, false
	}

	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
	r.TransferEncoding = nil

	return body, true
}

func exportInsights(endpoint, contentType, contentEncoding string, body []byte) {
	select {
	case insightsSlots <- struct{}{}:
	default:
		return
	}

	go func() {
		defer func() { <-insightsSlots }()

		// The browser's request context ends with its response, so the copied
		// export carries its own deadline.
		ctx, cancel := context.WithTimeout(context.Background(), insightsTimeout)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))

		if err != nil {
			return
		}

		// Only transport headers travel: identity already lives in the enriched
		// payload and browser credentials must not reach a second backend.
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}

		if contentEncoding != "" {
			req.Header.Set("Content-Encoding", contentEncoding)
		}

		resp, err := http.DefaultClient.Do(req)

		if err != nil {
			return
		}

		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()
}
