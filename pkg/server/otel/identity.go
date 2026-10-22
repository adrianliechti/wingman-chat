package otel

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strings"
)

const maxEnrichedBodyBytes = 8 << 20

var emailPattern = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// signal names the JSON shape of one OTLP signal: the resource blocks that
// carry service.name, and the leaf records whose attributes identity is stamped
// on. Logs are not enriched (insights discards them).
type signal struct {
	label     string // used in the rejection messages
	resources string
	records   string
}

var (
	metricSignal = signal{label: "metrics", resources: "resourceMetrics", records: "dataPoints"}
	traceSignal  = signal{label: "traces", resources: "resourceSpans", records: "spans"}
)

// Identity headers must be overwritten by the trusted authentication proxy.
func withMetricIdentity(next http.Handler, service string) http.Handler {
	return withIdentity(next, service, metricSignal)
}

// Attribute browser spans to the authenticated user, just like metric points.
func withTraceIdentity(next http.Handler, service string) http.Handler {
	return withIdentity(next, service, traceSignal)
}

func withIdentity(next http.Handler, service string, sig signal) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			http.Error(w, sig.label+" require OTLP JSON", http.StatusUnsupportedMediaType)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxEnrichedBodyBytes)
		defer r.Body.Close()
		var reader io.Reader = r.Body
		switch strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Encoding"))) {
		case "", "identity":
		case "gzip":
			compressed, err := gzip.NewReader(r.Body)
			if err != nil {
				http.Error(w, "invalid compressed "+sig.label, http.StatusBadRequest)
				return
			}
			defer compressed.Close()
			reader = compressed
		default:
			http.Error(w, "unsupported "+sig.label+" encoding", http.StatusUnsupportedMediaType)
			return
		}

		body, err := io.ReadAll(io.LimitReader(reader, maxEnrichedBodyBytes+1))
		var tooLarge *http.MaxBytesError
		if len(body) > maxEnrichedBodyBytes || errors.As(err, &tooLarge) {
			http.Error(w, sig.label+" payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		if err != nil {
			http.Error(w, "invalid "+sig.label+" payload", http.StatusBadRequest)
			return
		}

		user := strings.TrimSpace(r.Header.Get("X-Forwarded-User"))
		email := strings.TrimSpace(r.Header.Get("X-Forwarded-Email"))
		if email == "" && emailPattern.MatchString(user) {
			email = user
		}
		body, err = enrichIdentity(body, service, user, email, sig)
		if err != nil {
			http.Error(w, "invalid OTLP "+sig.label+" payload", http.StatusBadRequest)
			return
		}

		forward := r.Clone(r.Context())
		forward.Body = io.NopCloser(bytes.NewReader(body))
		forward.ContentLength = int64(len(body))
		forward.TransferEncoding = nil
		forward.Header.Del("Content-Encoding")
		forward.Header.Del("Content-Length")
		next.ServeHTTP(w, forward)
	})
}

type metricObject = map[string]any

// Protobuf JSON parsers also accept snake_case names, which would bypass the walk below.
var snakeCaseFields = map[string]bool{
	"resource_metrics":      true,
	"scope_metrics":         true,
	"data_points":           true,
	"exponential_histogram": true,
	"resource_spans":        true,
	"scope_spans":           true,
}

func enrichMetricIdentity(body []byte, service, user, email string) ([]byte, error) {
	return enrichIdentity(body, service, user, email, metricSignal)
}

// UseNumber preserves nanosecond timestamps and integer counts during the JSON round trip.
func enrichIdentity(body []byte, service, user, email string, sig signal) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()

	var export metricObject
	if err := decoder.Decode(&export); err != nil {
		return nil, err
	}

	if export == nil {
		return nil, errors.New("expected " + sig.label + " object")
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("expected one " + sig.label + " object")
	}

	if err := applyIdentity(export, user, email, sig.records); err != nil {
		return nil, err
	}

	applyServiceName(export, service, sig.resources)

	return json.Marshal(export)
}

// applyIdentity drops client-supplied identity attributes everywhere — span
// events and links included — and stamps the authenticated identity on every
// data point / span.
func applyIdentity(value any, user, email, records string) error {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			if err := applyIdentity(item, user, email, records); err != nil {
				return err
			}
		}

	case metricObject:
		for key, child := range v {
			if snakeCaseFields[key] {
				return errors.New("expected lowerCamelCase OTLP fields")
			}

			if key == "attributes" {
				v[key] = withoutIdentity(child)
			}

			if err := applyIdentity(child, user, email, records); err != nil {
				return err
			}
		}

		points, _ := v[records].([]any)

		for _, point := range points {
			if point, ok := point.(metricObject); ok {
				if identity := identityAttributes(user, email); len(identity) > 0 {
					attrs, _ := point["attributes"].([]any)
					point["attributes"] = append(attrs, identity...)
				}
			}
		}
	}

	return nil
}

func applyServiceName(export metricObject, service, resources string) {
	if service == "" {
		return
	}

	resourceBlocks, _ := export[resources].([]any)

	for _, item := range resourceBlocks {
		rm, ok := item.(metricObject)

		if !ok {
			continue
		}

		resource, _ := rm["resource"].(metricObject)

		if resource == nil {
			resource = metricObject{}
			rm["resource"] = resource
		}

		attrs, _ := resource["attributes"].([]any)
		filtered := make([]any, 0, len(attrs)+2)

		for _, attr := range attrs {
			if obj, ok := attr.(metricObject); ok {
				if key, _ := obj["key"].(string); key == "service.name" || key == "wingman.telemetry.source" {
					continue
				}
			}

			filtered = append(filtered, attr)
		}

		resource["attributes"] = append(filtered,
			metricObject{"key": "service.name", "value": metricObject{"stringValue": service}},
			metricObject{"key": "wingman.telemetry.source", "value": metricObject{"stringValue": "chat"}},
		)
	}
}

func withoutIdentity(value any) any {
	attrs, ok := value.([]any)

	if !ok {
		return value
	}

	filtered := make([]any, 0, len(attrs))

	for _, attr := range attrs {
		if obj, ok := attr.(metricObject); ok {
			if key, _ := obj["key"].(string); key == "user.id" || key == "user.email" || key == "service.peer.name" {
				continue
			}
		}

		filtered = append(filtered, attr)
	}

	return filtered
}

func identityAttributes(user, email string) []any {
	var attrs []any

	for _, attr := range []struct{ key, value string }{{"user.id", user}, {"user.email", email}} {
		if attr.value != "" {
			attrs = append(attrs, metricObject{"key": attr.key, "value": metricObject{"stringValue": attr.value}})
		}
	}

	return attrs
}
