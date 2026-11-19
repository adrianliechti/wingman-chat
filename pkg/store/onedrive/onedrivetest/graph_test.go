package onedrivetest

import (
	"encoding/base64"
	"testing"
)

// The fake Graph must report the same checksum as OneDrive. Vectors from
// rclone's QuickXorHash tests, which are checked against OneDrive.
func TestQuickXorMatchesOneDrive(t *testing.T) {
	for _, vector := range []struct{ in, out string }{
		{"", "AAAAAAAAAAAAAAAAAAAAAAAAAAA="},
		{"Sg==", "SgAAAAAAAAAAAAAAAQAAAAAAAAA="},
		{"2fuxhBJXtpWFe8dOfdGeHw==", "O9tHLAghgSvYohKFyMMxnNCHaHg="},
		{"T6LYJIfDh81JrAK309H2JMJTXis=", "zBTHrspn3mEcohlJdIUAbjGNaNg="},
		{"Mb7EGva2rEE5fENDL85P+BsapHEEjv2/siVhKjvAQe02feExVOQSkfmuYzU/kTF1MaKjPmKF/w+cbvwfdWL8aQ==", "n1anP5NfvD4XDYWIeRPW3ZkPv1Y="},
	} {
		in, err := base64.StdEncoding.DecodeString(vector.in)
		if err != nil {
			t.Fatal(err)
		}
		if got := QuickXor(in); got != vector.out {
			t.Errorf("%d bytes: got %s, want %s", len(in), got, vector.out)
		}
	}
}
