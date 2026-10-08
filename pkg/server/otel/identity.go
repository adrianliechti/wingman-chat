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

const maxMetricBodyBytes = 8 << 20

var emailPattern = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// withMetricIdentity enriches the browser's OTLP/HTTP JSON metrics. Identity
// headers must be set/overwritten by the trusted authentication proxy, as in
// wingman's header auth. Browser-supplied identity is never authoritative.
func withMetricIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			http.Error(w, "metrics require OTLP JSON", http.StatusUnsupportedMediaType)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxMetricBodyBytes)
		defer r.Body.Close()
		var reader io.Reader = r.Body
		switch strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Encoding"))) {
		case "", "identity":
		case "gzip":
			compressed, err := gzip.NewReader(r.Body)
			if err != nil {
				http.Error(w, "invalid compressed metrics", http.StatusBadRequest)
				return
			}
			defer compressed.Close()
			reader = compressed
		default:
			http.Error(w, "unsupported metrics encoding", http.StatusUnsupportedMediaType)
			return
		}

		body, err := io.ReadAll(io.LimitReader(reader, maxMetricBodyBytes+1))
		var tooLarge *http.MaxBytesError
		if len(body) > maxMetricBodyBytes || errors.As(err, &tooLarge) {
			http.Error(w, "metrics payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		if err != nil {
			http.Error(w, "invalid metrics payload", http.StatusBadRequest)
			return
		}

		user := strings.TrimSpace(r.Header.Get("X-Forwarded-User"))
		email := strings.TrimSpace(r.Header.Get("X-Forwarded-Email"))
		// Same email-shaped user fallback as wingman's header auth.
		if email == "" && emailPattern.MatchString(user) {
			email = user
		}
		body, err = enrichMetricIdentity(body, user, email)
		if err != nil {
			http.Error(w, "invalid OTLP metrics payload", http.StatusBadRequest)
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

// UseNumber preserves nanosecond timestamps and integer counts during the JSON
// round trip. Unknown OTLP fields and non-identity attributes are retained.
func enrichMetricIdentity(body []byte, user, email string) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var export metricObject
	if err := decoder.Decode(&export); err != nil {
		return nil, err
	}
	if export == nil {
		return nil, errors.New("expected metrics object")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("expected one metrics object")
	}
	if err := rejectSnakeCase(export); err != nil {
		return nil, err
	}
	err := metricObjects(export, "resourceMetrics", func(resource metricObject) error {
		if err := clearMetricIdentity(resource, "resource"); err != nil {
			return err
		}
		return metricObjects(resource, "scopeMetrics", func(scope metricObject) error {
			if err := clearMetricIdentity(scope, "scope"); err != nil {
				return err
			}
			return metricObjects(scope, "metrics", func(metric metricObject) error {
				for _, kind := range []string{"gauge", "sum", "histogram", "exponentialHistogram", "summary"} {
					value, exists := metric[kind]
					if !exists {
						continue
					}
					data, ok := value.(metricObject)
					if !ok {
						return errors.New("expected metric data object")
					}
					if err := rejectSnakeCase(data); err != nil {
						return err
					}
					if err := metricObjects(data, "dataPoints", func(point metricObject) error {
						return setMetricIdentity(point, user, email)
					}); err != nil {
						return err
					}
				}
				return nil
			})
		})
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(export)
}

// Some collectors accept protobuf's snake_case names as well as OTLP JSON's
// lowerCamelCase names. Reject alternate structural keys so they cannot skip
// identity enrichment. Browser exporters only use the canonical spelling.
func rejectSnakeCase(object metricObject) error {
	for _, field := range []string{"resource_metrics", "scope_metrics", "data_points", "exponential_histogram"} {
		if _, exists := object[field]; exists {
			return errors.New("expected lowerCamelCase OTLP fields")
		}
	}
	return nil
}

func metricObjects(parent metricObject, key string, visit func(metricObject) error) error {
	value, exists := parent[key]
	if !exists {
		return nil
	}
	objects, ok := value.([]any)
	if !ok {
		return errors.New("expected metrics array")
	}
	for _, value := range objects {
		object, ok := value.(metricObject)
		if !ok {
			return errors.New("expected metrics object")
		}
		if err := rejectSnakeCase(object); err != nil {
			return err
		}
		if err := visit(object); err != nil {
			return err
		}
	}
	return nil
}

func clearMetricIdentity(parent metricObject, key string) error {
	value, exists := parent[key]
	if !exists {
		return nil
	}
	object, ok := value.(metricObject)
	if !ok {
		return errors.New("expected metadata object")
	}
	return setMetricIdentity(object, "", "")
}

func setMetricIdentity(object metricObject, user, email string) error {
	var attrs []any
	if value, exists := object["attributes"]; exists {
		var ok bool
		attrs, ok = value.([]any)
		if !ok {
			return errors.New("expected attributes array")
		}
	}
	filtered := make([]any, 0, len(attrs)+2)
	for _, value := range attrs {
		attr, ok := value.(metricObject)
		if !ok {
			return errors.New("expected attribute object")
		}
		key, ok := attr["key"].(string)
		if !ok {
			return errors.New("expected attribute key")
		}
		if key != "user.id" && key != "user.email" {
			filtered = append(filtered, attr)
		}
	}
	for _, attr := range []struct{ key, value string }{{"user.id", user}, {"user.email", email}} {
		if attr.value != "" {
			filtered = append(filtered, metricObject{"key": attr.key, "value": metricObject{"stringValue": attr.value}})
		}
	}
	if len(filtered) == 0 {
		delete(object, "attributes")
	} else {
		object["attributes"] = filtered
	}
	return nil
}
