package otel

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type capturedExport struct {
	path        string
	contentType string
	body        []byte
}

func exportRecorder(t *testing.T, signals int) (*httptest.Server, <-chan capturedExport) {
	t.Helper()
	exports := make(chan capturedExport, signals)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		exports <- capturedExport{path: r.URL.RequestURI(), contentType: r.Header.Get("Content-Type"), body: body}
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, "{}")
	}))
	t.Cleanup(server.Close)
	return server, exports
}

func awaitExport(t *testing.T, exports <-chan capturedExport) capturedExport {
	t.Helper()
	select {
	case export := <-exports:
		return export
	case <-time.After(5 * time.Second):
		t.Fatal("no export received")
		return capturedExport{}
	}
}

func post(t *testing.T, mux *http.ServeMux, path string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	return res
}

func TestInsightsReceivesEnrichedTracesAndMetrics(t *testing.T) {
	collector, collected := exportRecorder(t, 4)
	insights, copied := exportRecorder(t, 4)
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)
	t.Setenv("INSIGHTS_ENDPOINT", insights.URL)
	mux := http.NewServeMux()
	New("").Attach(mux)

	traces := []byte(`{"resourceSpans":[{"scopeSpans":[{"spans":[{"name":"chat"}]}]}]}`)
	headers := map[string]string{"X-Forwarded-User": "user-123", "X-Forwarded-Email": "employee@example.org"}
	if res := post(t, mux, "/telemetry/v1/traces", traces, headers); res.Code != http.StatusOK {
		t.Fatalf("traces status = %d", res.Code)
	}
	// Traces are copied after identity enrichment, like metrics, so both
	// destinations receive the same attributable payload.
	forwardedTraces := awaitExport(t, collected)
	if forwardedTraces.path != "/v1/traces" {
		t.Errorf("collector traces path = %s", forwardedTraces.path)
	}
	export := awaitExport(t, copied)
	if export.path != "/v1/traces" || !bytes.Equal(export.body, forwardedTraces.body) {
		t.Errorf("insights traces = %s %s, want the forwarded payload", export.path, export.body)
	}
	if export.contentType != "application/json" {
		t.Errorf("insights content type = %q", export.contentType)
	}
	resourceSpans := decodeMetrics(t, export.body)["resourceSpans"].([]any)[0].(metricObject)
	checkIdentity(t, resourceSpans["resource"].(metricObject), "", "")
	span := resourceSpans["scopeSpans"].([]any)[0].(metricObject)["spans"].([]any)[0].(metricObject)
	checkIdentity(t, span, "user-123", "employee@example.org")

	metrics := []byte(metricPayload())
	if res := post(t, mux, "/telemetry/v1/metrics", metrics, headers); res.Code != http.StatusOK {
		t.Fatalf("metrics status = %d", res.Code)
	}
	forwarded := awaitExport(t, collected)
	if forwarded.path != "/v1/metrics" {
		t.Errorf("collector metrics path = %s", forwarded.path)
	}
	export = awaitExport(t, copied)
	if export.path != "/v1/metrics" {
		t.Errorf("insights metrics path = %s", export.path)
	}
	if !bytes.Equal(export.body, forwarded.body) {
		t.Error("insights metrics differ from forwarded metrics")
	}
	point := decodeMetrics(t, export.body)["resourceMetrics"].([]any)[0].(metricObject)["scopeMetrics"].([]any)[0].(metricObject)["metrics"].([]any)[0].(metricObject)["gauge"].(metricObject)["dataPoints"].([]any)[0].(metricObject)
	checkIdentity(t, point, "user-123", "employee@example.org")

	logs := []byte(`{"resourceLogs":[]}`)
	if res := post(t, mux, "/telemetry/v1/logs", logs, nil); res.Code != http.StatusOK {
		t.Fatalf("logs status = %d", res.Code)
	}
	if export := awaitExport(t, collected); !bytes.Equal(export.body, logs) || export.path != "/v1/logs" {
		t.Errorf("collector logs = %s %s", export.path, export.body)
	}
	select {
	case export := <-copied:
		t.Errorf("logs were copied to insights: %s", export.path)
	case <-time.After(200 * time.Millisecond):
	}
}

func TestInsightsReceivesExportsWithoutCollector(t *testing.T) {
	insights, copied := exportRecorder(t, 2)
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("INSIGHTS_ENDPOINT", insights.URL+"/ingest")
	mux := http.NewServeMux()
	New("").Attach(mux)

	traces := []byte(`{"resourceSpans":[]}`)
	if res := post(t, mux, "/telemetry/v1/traces", traces, nil); res.Code != http.StatusOK {
		t.Fatalf("traces status = %d", res.Code)
	}
	if export := awaitExport(t, copied); export.path != "/ingest" || !bytes.Equal(export.body, traces) {
		t.Errorf("insights traces = %s %s", export.path, export.body)
	}
}

// TestOversizedExportsAreRejected pins the trade the identity wrappers make:
// an export too large to buffer cannot be enriched, and forwarding it as the
// browser sent it would publish unattributable — and client-spoofable —
// identity to both backends, so it is rejected instead of passed through. The
// browser's batches are orders of magnitude below the limit (span content
// capture is off), so this bound is never reached in practice.
func TestOversizedExportsAreRejected(t *testing.T) {
	collector, collected := exportRecorder(t, 1)
	insights, copied := exportRecorder(t, 1)
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", collector.URL+"/v1/traces")
	t.Setenv("INSIGHTS_ENDPOINT", insights.URL)
	mux := http.NewServeMux()
	New("").Attach(mux)

	body := []byte(`{"resourceSpans":[` + strings.Repeat(" ", maxEnrichedBodyBytes) + `]}`)
	if res := post(t, mux, "/telemetry/v1/traces", body, nil); res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("traces status = %d, want %d", res.Code, http.StatusRequestEntityTooLarge)
	}
	select {
	case <-collected:
		t.Error("oversized export reached the collector")
	case <-copied:
		t.Error("oversized export was copied to insights")
	case <-time.After(200 * time.Millisecond):
	}
}

func TestInsightsEndpointPaths(t *testing.T) {
	tests := []struct{ endpoint, want string }{
		{"", ""},
		{"https://insights.example.org", "https://insights.example.org/v1/metrics"},
		{"https://insights.example.org/v1/metrics", "https://insights.example.org/v1/metrics"},
		{"https://insights.example.org/ingest?tenant=chat", "https://insights.example.org/ingest?tenant=chat"},
	}
	for _, tt := range tests {
		if got := insightsEndpoint(tt.endpoint, "/v1/metrics"); got != tt.want {
			t.Errorf("insightsEndpoint(%q) = %q, want %q", tt.endpoint, got, tt.want)
		}
	}
}

func TestMetricsUsesInsightsAcknowledgementAndSanitizesHeaders(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			headers := make(chan http.Header, 1)
			insights := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				headers <- r.Header.Clone()
				w.Header().Set("Retry-After", "2")
				w.WriteHeader(status)
				io.WriteString(w, "{}")
			}))
			defer insights.Close()
			// The collector deliberately reports the opposite result.
			collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if status == http.StatusOK {
					w.WriteHeader(http.StatusServiceUnavailable)
				} else {
					w.WriteHeader(http.StatusOK)
				}
			}))
			defer collector.Close()
			t.Setenv("INSIGHTS_ENDPOINT", insights.URL)
			t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)
			mux := http.NewServeMux()
			New("").Attach(mux)
			res := post(t, mux, "/telemetry/v1/metrics", []byte(metricPayload()), map[string]string{
				"Cookie": "session=secret", "Authorization": "Bearer secret", "X-Forwarded-Access-Token": "secret", "X-Forwarded-User": "alice",
			})
			if res.Code != status || res.Header().Get("Retry-After") != "2" {
				t.Fatalf("response=%d %v", res.Code, res.Header())
			}
			received := <-headers
			for _, key := range []string{"Cookie", "Authorization", "X-Forwarded-Access-Token", "X-Forwarded-User"} {
				if received.Get(key) != "" {
					t.Errorf("forwarded %s", key)
				}
			}
			if received.Get("Content-Type") != "application/json" {
				t.Errorf("content type=%q", received.Get("Content-Type"))
			}
		})
	}
}

func TestMetricsWaitsForInsightsAdmission(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	insights := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer insights.Close()
	t.Setenv("INSIGHTS_ENDPOINT", insights.URL)
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	mux := http.NewServeMux()
	New("").Attach(mux)
	response := make(chan int, 1)
	go func() {
		req := httptest.NewRequest(http.MethodPost, "/telemetry/v1/metrics", strings.NewReader(metricPayload()))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		response <- res.Code
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("Insights request did not start")
	}
	select {
	case status := <-response:
		close(release)
		t.Fatalf("acknowledged before Insights: %d", status)
	default:
	}
	close(release)
	select {
	case status := <-response:
		if status != http.StatusOK {
			t.Fatalf("status=%d", status)
		}
	case <-time.After(time.Second):
		t.Fatal("missing acknowledgement")
	}
}
