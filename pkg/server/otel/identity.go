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

// Identity headers must be overwritten by the trusted authentication proxy.
func withMetricIdentity(next http.Handler, service string) http.Handler {
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
		if email == "" && emailPattern.MatchString(user) {
			email = user
		}
		body, err = enrichMetricIdentity(body, service, user, email)
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

// Protobuf JSON parsers also accept snake_case names, which would bypass the walk below.
var snakeCaseFields = map[string]bool{
	"resource_metrics":      true,
	"scope_metrics":         true,
	"data_points":           true,
	"exponential_histogram": true,
}

// UseNumber preserves nanosecond timestamps and integer counts during the JSON round trip.
func enrichMetricIdentity(body []byte, service, user, email string) ([]byte, error) {
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

	if err := applyIdentity(export, user, email); err != nil {
		return nil, err
	}

	applyServiceName(export, service)

	return json.Marshal(export)
}

// applyIdentity drops client-supplied identity attributes everywhere and stamps
// the authenticated identity on every data point.
func applyIdentity(value any, user, email string) error {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			if err := applyIdentity(item, user, email); err != nil {
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

			if err := applyIdentity(child, user, email); err != nil {
				return err
			}
		}

		points, _ := v["dataPoints"].([]any)

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

func applyServiceName(export metricObject, service string) {
	if service == "" {
		return
	}

	resources, _ := export["resourceMetrics"].([]any)

	for _, item := range resources {
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
		filtered := make([]any, 0, len(attrs)+1)

		for _, attr := range attrs {
			if obj, ok := attr.(metricObject); ok {
				if key, _ := obj["key"].(string); key == "service.name" {
					continue
				}
			}

			filtered = append(filtered, attr)
		}

		resource["attributes"] = append(filtered, metricObject{"key": "service.name", "value": metricObject{"stringValue": service}})
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
			if key, _ := obj["key"].(string); key == "user.id" || key == "user.email" {
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
