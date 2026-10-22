package otel

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const spoofedIdentity = `{"key":"user.id","value":{"stringValue":"spoofed-id"}},
{"key":"user.email","value":{"stringValue":"spoofed@example.org"}}`

func metricPayload() string {
	var metrics []string
	for _, kind := range []string{"gauge", "sum", "histogram", "exponentialHistogram", "summary"} {
		fields := `"asInt":"9007199254740993"`
		switch kind {
		case "histogram":
			fields = `"count":"1","sum":0.9,"bucketCounts":["0","1"],"explicitBounds":[0.5]`
		case "exponentialHistogram":
			fields = `"count":"1","sum":0.9,"scale":0,"zeroCount":"0","positive":{"offset":0,"bucketCounts":["1"]}`
		case "summary":
			fields = `"count":"1","sum":0.9,"quantileValues":[{"quantile":0.5,"value":0.9}]`
		}
		metrics = append(metrics, fmt.Sprintf(`{"name":"gen_ai.test.%s","%s":{"aggregationTemporality":1,
"dataPoints":[{"attributes":[%s,%s,{"key":"gen_ai.request.model","value":{"stringValue":"model-1"}},
{"key":"wingman.classification.matched","value":{"boolValue":true}}],
"timeUnixNano":1700000000000000001,%s,"extension":{"keep":true}}]}}`, kind, kind, spoofedIdentity, spoofedIdentity, fields))
	}
	resource := fmt.Sprintf(`{"resource":{"attributes":[%s,{"key":"service.name","value":{"stringValue":"wingman-chat"}}]},
"schemaUrl":"https://example.org/resource-schema","scopeMetrics":[{"scope":{"name":"wingman","attributes":[%s]},
"metrics":[%s]}]}`, spoofedIdentity, spoofedIdentity, strings.Join(metrics, ","))
	return `{"resourceMetrics":[` + resource + `,` + resource + `],"extension":"preserved"}`
}

func TestMetricsProxyAttachesAuthenticatedIdentity(t *testing.T) {
	tests := []struct {
		name, user, email, wantUser, wantEmail string
		gzip                                   bool
	}{
		{name: "id and email", user: " user-123 ", email: " employee@example.org ", wantUser: "user-123", wantEmail: "employee@example.org"},
		{name: "email-shaped user", user: "employee@example.org", wantUser: "employee@example.org", wantEmail: "employee@example.org"},
		{name: "opaque user", user: "user-123", wantUser: "user-123"},
		{name: "email only", email: "employee@example.org", wantEmail: "employee@example.org"},
		{name: "anonymous"},
		{name: "display name is not email", user: "Employee <employee@example.org>", wantUser: "Employee <employee@example.org>"},
		{name: "gzip", user: "user-123", email: "employee@example.org", wantUser: "user-123", wantEmail: "employee@example.org", gzip: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var forwarded []byte
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.RequestURI() != "/v1/metrics?tenant=chat" {
					t.Errorf("forwarded URL = %s", r.URL.RequestURI())
				}
				if r.Header.Get("Content-Encoding") != "" {
					t.Error("rewritten body still has Content-Encoding")
				}
				var err error
				forwarded, err = io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				if r.ContentLength != int64(len(forwarded)) {
					t.Errorf("content length = %d, want %d", r.ContentLength, len(forwarded))
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				io.WriteString(w, `{"partialSuccess":{}}`)
			}))
			defer upstream.Close()
			t.Setenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", upstream.URL+"/v1/metrics?tenant=chat")
			mux := http.NewServeMux()
			New("").Attach(mux)
			payload := []byte(metricPayload())
			if tt.gzip {
				payload = gzipBody(t, payload)
			}
			req := httptest.NewRequest(http.MethodPost, "/telemetry/v1/metrics", bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json; charset=utf-8")
			req.Header.Set("X-Forwarded-User", tt.user)
			req.Header.Set("X-Forwarded-Email", tt.email)
			if tt.gzip {
				req.Header.Set("Content-Encoding", "gzip")
			}
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != http.StatusAccepted || res.Body.String() != `{"partialSuccess":{}}` {
				t.Fatalf("upstream response not preserved: %d %s", res.Code, res.Body.String())
			}

			original := decodeMetrics(t, []byte(metricPayload()))
			got := decodeMetrics(t, forwarded)
			for index, value := range got["resourceMetrics"].([]any) {
				resource := value.(metricObject)
				checkIdentity(t, resource["resource"].(metricObject), "", "")
				scope := resource["scopeMetrics"].([]any)[0].(metricObject)
				checkIdentity(t, scope["scope"].(metricObject), "", "")
				originalResource := original["resourceMetrics"].([]any)[index].(metricObject)
				originalScope := originalResource["scopeMetrics"].([]any)[0].(metricObject)
				for metricIndex, value := range scope["metrics"].([]any) {
					metric := value.(metricObject)
					originalMetric := originalScope["metrics"].([]any)[metricIndex].(metricObject)
					for _, kind := range []string{"gauge", "sum", "histogram", "exponentialHistogram", "summary"} {
						if data, ok := metric[kind].(metricObject); ok {
							point := data["dataPoints"].([]any)[0].(metricObject)
							checkIdentity(t, point, tt.wantUser, tt.wantEmail)
							stripIdentityAttributes(point)
							originalPoint := originalMetric[kind].(metricObject)["dataPoints"].([]any)[0].(metricObject)
							stripIdentityAttributes(originalPoint)
						}
					}
				}
				stripIdentityAttributes(resource["resource"].(metricObject))
				stripIdentityAttributes(originalResource["resource"].(metricObject))
				stripIdentityAttributes(scope["scope"].(metricObject))
				stripIdentityAttributes(originalScope["scope"].(metricObject))
			}
			if !reflect.DeepEqual(got, original) {
				t.Error("non-identity metric data was changed")
			}
		})
	}
}

func stripIdentityAttributes(object metricObject) {
	var remaining []any
	if attrs, ok := object["attributes"].([]any); ok {
		for _, attr := range attrs {
			key := attr.(metricObject)["key"]
			if key != "user.id" && key != "user.email" && key != "wingman.telemetry.source" && key != "service.peer.name" {
				remaining = append(remaining, attr)
			}
		}
	}
	if len(remaining) == 0 {
		delete(object, "attributes")
	} else {
		object["attributes"] = remaining
	}
}

func checkIdentity(t *testing.T, object metricObject, user, email string) {
	t.Helper()
	got := map[string]string{}
	counts := map[string]int{}
	if attrs, ok := object["attributes"].([]any); ok {
		for _, value := range attrs {
			attr := value.(metricObject)
			key := attr["key"].(string)
			counts[key]++
			if text, ok := attr["value"].(metricObject)["stringValue"].(string); ok {
				got[key] = text
			}
			if key == "wingman.classification.matched" && attr["value"].(metricObject)["boolValue"] != true {
				t.Error("classification match attribute changed")
			}
		}
	}
	for key, want := range map[string]string{"user.id": user, "user.email": email} {
		wantCount := 0
		if want != "" {
			wantCount = 1
		}
		if got[key] != want || counts[key] != wantCount {
			t.Errorf("%s = %q (%d attributes), want %q (%d attributes)", key, got[key], counts[key], want, wantCount)
		}
	}
	if counts["gen_ai.request.model"] != 0 && got["gen_ai.request.model"] != "model-1" {
		t.Error("model attribute changed")
	}
	if counts["service.name"] != 0 && got["service.name"] != "wingman-chat" {
		t.Error("service attribute changed")
	}
}

func decodeMetrics(t *testing.T, body []byte) metricObject {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var object metricObject
	if err := decoder.Decode(&object); err != nil {
		t.Fatal(err)
	}
	return object
}

func gzipBody(t *testing.T, body []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestMetricsRejectInvalidPayloadsBeforeForwarding(t *testing.T) {
	tests := []struct {
		name, body, contentType, encoding string
		status                            int
	}{
		{name: "invalid JSON", body: `{`, status: http.StatusBadRequest},
		{name: "multiple exports", body: `{} {}`, status: http.StatusBadRequest},
		{name: "null export", body: `null`, status: http.StatusBadRequest},
		{name: "alternate resource key", body: strings.ReplaceAll(metricPayload(), "resourceMetrics", "resource_metrics"), status: http.StatusBadRequest},
		{name: "alternate scope key", body: strings.ReplaceAll(metricPayload(), "scopeMetrics", "scope_metrics"), status: http.StatusBadRequest},
		{name: "alternate point key", body: strings.ReplaceAll(metricPayload(), "dataPoints", "data_points"), status: http.StatusBadRequest},
		{name: "alternate histogram key", body: strings.ReplaceAll(metricPayload(), "exponentialHistogram", "exponential_histogram"), status: http.StatusBadRequest},
		{name: "protobuf", body: "binary", contentType: "application/x-protobuf", status: http.StatusUnsupportedMediaType},
		{name: "unsupported encoding", body: `{}`, encoding: "br", status: http.StatusUnsupportedMediaType},
		{name: "invalid gzip", body: `{}`, encoding: "gzip", status: http.StatusBadRequest},
		{name: "oversized", body: strings.Repeat(" ", maxEnrichedBodyBytes+1), status: http.StatusRequestEntityTooLarge},
		{name: "oversized gzip", body: strings.Repeat(" ", maxEnrichedBodyBytes+1), encoding: "gzip", status: http.StatusRequestEntityTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload := []byte(tt.body)
			if tt.name == "oversized gzip" {
				payload = gzipBody(t, payload)
			}
			req := httptest.NewRequest(http.MethodPost, "/telemetry/v1/metrics", bytes.NewReader(payload))
			contentType := tt.contentType
			if contentType == "" {
				contentType = "application/json"
			}
			req.Header.Set("Content-Type", contentType)
			req.Header.Set("Content-Encoding", tt.encoding)
			res := httptest.NewRecorder()
			withMetricIdentity(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Error("invalid payload was forwarded")
			}), "").ServeHTTP(res, req)
			if res.Code != tt.status {
				t.Errorf("status = %d, want %d: %s", res.Code, tt.status, res.Body.String())
			}
		})
	}
}

func TestMetricsProxyAcceptsEmptyExports(t *testing.T) {
	for _, body := range []string{`{}`, `{"resourceMetrics":[]}`, `{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"gauge":{"dataPoints":[{"asInt":"1"}]}}]}]}]}`} {
		req := httptest.NewRequest(http.MethodPost, "/telemetry/v1/metrics", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		withMetricIdentity(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusAccepted)
		}), "").ServeHTTP(res, req)
		if res.Code != http.StatusAccepted {
			t.Errorf("empty/unattributed export rejected: %d %s", res.Code, res.Body.String())
		}
	}
}

func TestMetricIdentityWithoutExistingAttributes(t *testing.T) {
	body, err := enrichMetricIdentity([]byte(`{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"sum":{"dataPoints":[{"asInt":"5"},{"asInt":"10"}]}}]}]}]}`), "", "user-123", "employee@example.org")
	if err != nil {
		t.Fatal(err)
	}
	export := decodeMetrics(t, body)
	resource := export["resourceMetrics"].([]any)[0].(metricObject)
	scope := resource["scopeMetrics"].([]any)[0].(metricObject)
	metric := scope["metrics"].([]any)[0].(metricObject)
	for _, point := range metric["sum"].(metricObject)["dataPoints"].([]any) {
		checkIdentity(t, point.(metricObject), "user-123", "employee@example.org")
	}
}

func TestMetricServiceNameIsServerAuthoritative(t *testing.T) {
	for _, tt := range []struct{ name, resource, service, want string }{
		{name: "overrides client value", resource: `{"attributes":[{"key":"service.name","value":{"stringValue":"spoofed"}},{"key":"keep","value":{"stringValue":"me"}}]}`, service: "acme", want: "acme"},
		{name: "adds missing attribute", resource: `{}`, service: "acme", want: "acme"},
		{name: "adds missing resource", service: "acme", want: "acme"},
		{name: "empty keeps client value", resource: `{"attributes":[{"key":"service.name","value":{"stringValue":"client"}}]}`, want: "client"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			resource := ""
			if tt.resource != "" {
				resource = `"resource":` + tt.resource + `,`
			}
			body, err := enrichMetricIdentity([]byte(`{"resourceMetrics":[{`+resource+`"scopeMetrics":[]}]}`), tt.service, "", "")
			if err != nil {
				t.Fatal(err)
			}
			rm := decodeMetrics(t, body)["resourceMetrics"].([]any)[0].(metricObject)
			attrs, _ := rm["resource"].(metricObject)["attributes"].([]any)
			var names []string
			for _, attr := range attrs {
				if a := attr.(metricObject); a["key"] == "service.name" {
					names = append(names, a["value"].(metricObject)["stringValue"].(string))
				}
			}
			if len(names) != 1 || names[0] != tt.want {
				t.Fatalf("service.name = %v, want [%s]", names, tt.want)
			}
		})
	}
}

// tracePayload is a span export that spoofs identity at every level a client
// controls — resource, scope, span, span event and span link attributes.
func tracePayload() string {
	span := fmt.Sprintf(`{"traceId":"0102030405060708090a0b0c0d0e0f10","spanId":"0102030405060708",
"name":"chat gpt-5.1 #0","kind":3,"startTimeUnixNano":"1700000000000000001","endTimeUnixNano":"1700000000000000002",
"attributes":[%s,{"key":"gen_ai.request.model","value":{"stringValue":"model-1"}},
{"key":"gen_ai.usage.input_tokens","value":{"intValue":"9007199254740993"}}],
"events":[{"name":"exception","timeUnixNano":"1700000000000000002","attributes":[%s]}],
"links":[{"traceId":"1112131415161718191a1b1c1d1e1f20","spanId":"1112131415161718","attributes":[%s]}],
"status":{"code":1}}`, spoofedIdentity, spoofedIdentity, spoofedIdentity)
	resource := fmt.Sprintf(`{"resource":{"attributes":[%s,{"key":"service.name","value":{"stringValue":"wingman-chat"}}]},
"schemaUrl":"https://example.org/resource-schema","scopeSpans":[{"scope":{"name":"wingman","attributes":[%s]},
"spans":[%s,%s]}]}`, spoofedIdentity, spoofedIdentity, span, span)
	return `{"resourceSpans":[` + resource + `,` + resource + `],"extension":"preserved"}`
}

// TestTracesProxyAttachesAuthenticatedIdentity is the spans counterpart of
// TestMetricsProxyAttachesAuthenticatedIdentity, and the reason cost can be
// attributed at all: insights prices spans and groups that spend by the span's
// user.id.
func TestTracesProxyAttachesAuthenticatedIdentity(t *testing.T) {
	tests := []struct {
		name, user, email, wantUser, wantEmail string
		gzip                                   bool
	}{
		{name: "id and email", user: " user-123 ", email: " employee@example.org ", wantUser: "user-123", wantEmail: "employee@example.org"},
		{name: "email-shaped user", user: "employee@example.org", wantUser: "employee@example.org", wantEmail: "employee@example.org"},
		{name: "opaque user", user: "user-123", wantUser: "user-123"},
		{name: "email only", email: "employee@example.org", wantEmail: "employee@example.org"},
		{name: "anonymous"},
		{name: "gzip", user: "user-123", email: "employee@example.org", wantUser: "user-123", wantEmail: "employee@example.org", gzip: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var forwarded []byte
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.RequestURI() != "/v1/traces?tenant=chat" {
					t.Errorf("forwarded URL = %s", r.URL.RequestURI())
				}
				if r.Header.Get("Content-Encoding") != "" {
					t.Error("rewritten body still has Content-Encoding")
				}
				var err error
				forwarded, err = io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				if r.ContentLength != int64(len(forwarded)) {
					t.Errorf("content length = %d, want %d", r.ContentLength, len(forwarded))
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				io.WriteString(w, `{"partialSuccess":{}}`)
			}))
			defer upstream.Close()
			t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", upstream.URL+"/v1/traces?tenant=chat")
			mux := http.NewServeMux()
			New("").Attach(mux)
			payload := []byte(tracePayload())
			if tt.gzip {
				payload = gzipBody(t, payload)
			}
			req := httptest.NewRequest(http.MethodPost, "/telemetry/v1/traces", bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json; charset=utf-8")
			req.Header.Set("X-Forwarded-User", tt.user)
			req.Header.Set("X-Forwarded-Email", tt.email)
			if tt.gzip {
				req.Header.Set("Content-Encoding", "gzip")
			}
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != http.StatusAccepted || res.Body.String() != `{"partialSuccess":{}}` {
				t.Fatalf("upstream response not preserved: %d %s", res.Code, res.Body.String())
			}

			original := decodeMetrics(t, []byte(tracePayload()))
			got := decodeMetrics(t, forwarded)
			for index, value := range got["resourceSpans"].([]any) {
				resource := value.(metricObject)
				checkIdentity(t, resource["resource"].(metricObject), "", "")
				scope := resource["scopeSpans"].([]any)[0].(metricObject)
				checkIdentity(t, scope["scope"].(metricObject), "", "")
				originalResource := original["resourceSpans"].([]any)[index].(metricObject)
				originalScope := originalResource["scopeSpans"].([]any)[0].(metricObject)
				for spanIndex, value := range scope["spans"].([]any) {
					span := value.(metricObject)
					checkIdentity(t, span, tt.wantUser, tt.wantEmail)
					// Identity belongs on the span, not on its events or links.
					for _, key := range []string{"events", "links"} {
						for _, nested := range span[key].([]any) {
							checkIdentity(t, nested.(metricObject), "", "")
						}
					}
					stripIdentityAttributes(span)
					originalSpan := originalScope["spans"].([]any)[spanIndex].(metricObject)
					stripIdentityAttributes(originalSpan)
					for _, key := range []string{"events", "links"} {
						for index, nested := range span[key].([]any) {
							stripIdentityAttributes(nested.(metricObject))
							stripIdentityAttributes(originalSpan[key].([]any)[index].(metricObject))
						}
					}
				}
				// service.name is server-authoritative; the rest of the resource,
				// scope and span payload must survive the round trip untouched.
				stripIdentityAttributes(resource["resource"].(metricObject))
				stripIdentityAttributes(originalResource["resource"].(metricObject))
				stripIdentityAttributes(scope["scope"].(metricObject))
				stripIdentityAttributes(originalScope["scope"].(metricObject))
			}
			if !reflect.DeepEqual(got, original) {
				t.Errorf("payload changed beyond identity:\n got %s\nwant %s", forwarded, tracePayload())
			}
		})
	}
}

func TestTracesRejectInvalidPayloadsBeforeForwarding(t *testing.T) {
	tests := []struct {
		name, body, contentType, encoding string
		status                            int
	}{
		{name: "invalid JSON", body: `{`, status: http.StatusBadRequest},
		{name: "multiple exports", body: `{} {}`, status: http.StatusBadRequest},
		{name: "null export", body: `null`, status: http.StatusBadRequest},
		{name: "alternate resource key", body: strings.ReplaceAll(tracePayload(), "resourceSpans", "resource_spans"), status: http.StatusBadRequest},
		{name: "alternate scope key", body: strings.ReplaceAll(tracePayload(), "scopeSpans", "scope_spans"), status: http.StatusBadRequest},
		{name: "protobuf", body: "binary", contentType: "application/x-protobuf", status: http.StatusUnsupportedMediaType},
		{name: "unsupported encoding", body: `{}`, encoding: "br", status: http.StatusUnsupportedMediaType},
		{name: "invalid gzip", body: `{}`, encoding: "gzip", status: http.StatusBadRequest},
		{name: "oversized", body: strings.Repeat(" ", maxEnrichedBodyBytes+1), status: http.StatusRequestEntityTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/telemetry/v1/traces", strings.NewReader(tt.body))
			contentType := tt.contentType
			if contentType == "" {
				contentType = "application/json"
			}
			req.Header.Set("Content-Type", contentType)
			req.Header.Set("Content-Encoding", tt.encoding)
			res := httptest.NewRecorder()
			withTraceIdentity(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Error("invalid payload was forwarded")
			}), "").ServeHTTP(res, req)
			if res.Code != tt.status {
				t.Errorf("status = %d, want %d: %s", res.Code, tt.status, res.Body.String())
			}
		})
	}
}

func TestTraceServiceNameIsServerAuthoritative(t *testing.T) {
	body, err := enrichIdentity([]byte(`{"resourceSpans":[{"resource":{"attributes":[
		{"key":"service.name","value":{"stringValue":"spoofed"}}]},"scopeSpans":[]}]}`),
		"acme", "", "", traceSignal)
	if err != nil {
		t.Fatal(err)
	}
	attrs := decodeMetrics(t, body)["resourceSpans"].([]any)[0].(metricObject)["resource"].(metricObject)["attributes"].([]any)
	var names []string
	for _, attr := range attrs {
		if a := attr.(metricObject); a["key"] == "service.name" {
			names = append(names, a["value"].(metricObject)["stringValue"].(string))
		}
	}
	if len(names) != 1 || names[0] != "acme" {
		t.Fatalf("service.name = %v, want [acme]", names)
	}
}

func TestTraceSourceCannotBeForgedByBrowser(t *testing.T) {
	body := []byte(`{"resourceSpans":[{"resource":{"attributes":[{"key":"wingman.telemetry.source","value":{"stringValue":"gateway"}}]},"scopeSpans":[{"scope":{"name":"github.com/adrianliechti/wingman"},"spans":[{"attributes":[{"key":"service.peer.name","value":{"stringValue":"other-app"}},{"key":"wingman.mcp.server.id","value":{"stringValue":"files"}}]}]}]}]}`)
	enriched, err := enrichIdentity(body, "trusted-chat", "user-1", "", traceSignal)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(enriched, &result); err != nil {
		t.Fatal(err)
	}
	block := result["resourceSpans"].([]any)[0].(map[string]any)
	resource := block["resource"].(map[string]any)
	attrs := resource["attributes"].([]any)
	source := ""
	for _, attr := range attrs {
		a := attr.(map[string]any)
		if a["key"] == "wingman.telemetry.source" {
			source = a["value"].(map[string]any)["stringValue"].(string)
		}
	}
	if source != "chat" {
		t.Fatalf("source=%q", source)
	}
	if bytes.Contains(enriched, []byte("other-app")) {
		t.Fatal("client app identity survived")
	}
	if !bytes.Contains(enriched, []byte("files")) {
		t.Fatal("MCP metadata was lost")
	}
}
