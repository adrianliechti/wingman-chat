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

func TestInsightsReceivesTracesAndEnrichedMetrics(t *testing.T) {
	collector, collected := exportRecorder(t, 4)
	insights, copied := exportRecorder(t, 4)
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)
	t.Setenv("INSIGHTS_ENDPOINT", insights.URL)
	mux := http.NewServeMux()
	New().Attach(mux)

	traces := []byte(`{"resourceSpans":[{"scopeSpans":[{"spans":[{"name":"chat"}]}]}]}`)
	if res := post(t, mux, "/telemetry/v1/traces", traces, nil); res.Code != http.StatusOK {
		t.Fatalf("traces status = %d", res.Code)
	}
	if export := awaitExport(t, collected); !bytes.Equal(export.body, traces) || export.path != "/v1/traces" {
		t.Errorf("collector traces = %s %s", export.path, export.body)
	}
	export := awaitExport(t, copied)
	if export.path != "/v1/traces" || !bytes.Equal(export.body, traces) {
		t.Errorf("insights traces = %s %s", export.path, export.body)
	}
	if export.contentType != "application/json" {
		t.Errorf("insights content type = %q", export.contentType)
	}

	metrics := []byte(metricPayload())
	headers := map[string]string{"X-Forwarded-User": "user-123", "X-Forwarded-Email": "employee@example.org"}
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
	// Insights must see exactly what the collector sees, identity included.
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
	New().Attach(mux)

	traces := []byte(`{"resourceSpans":[]}`)
	if res := post(t, mux, "/telemetry/v1/traces", traces, nil); res.Code != http.StatusOK {
		t.Fatalf("traces status = %d", res.Code)
	}
	// An endpoint with a path is used verbatim, as in wingman.
	if export := awaitExport(t, copied); export.path != "/ingest" || !bytes.Equal(export.body, traces) {
		t.Errorf("insights traces = %s %s", export.path, export.body)
	}
}

func TestOversizedExportsReachCollectorOnly(t *testing.T) {
	collector, collected := exportRecorder(t, 1)
	insights, copied := exportRecorder(t, 1)
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", collector.URL+"/v1/traces")
	t.Setenv("INSIGHTS_ENDPOINT", insights.URL)
	mux := http.NewServeMux()
	New().Attach(mux)

	body := []byte(`{"resourceSpans":[` + strings.Repeat(" ", maxInsightsBodyBytes) + `]}`)
	if res := post(t, mux, "/telemetry/v1/traces", body, nil); res.Code != http.StatusOK {
		t.Fatalf("traces status = %d", res.Code)
	}
	if export := awaitExport(t, collected); !bytes.Equal(export.body, body) {
		t.Errorf("collector received %d bytes, want %d", len(export.body), len(body))
	}
	select {
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
