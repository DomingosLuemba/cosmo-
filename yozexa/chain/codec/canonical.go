// Package codec implements YOZEXA's canonical serialisation.
//
// Every byte that a user signs is produced by CanonicalJSON. The encoding is a
// restricted profile of RFC 8785 (JSON Canonicalization Scheme):
//
//   - object keys are sorted by their UTF-8 code-unit sequence;
//   - numbers are emitted exactly as they appeared in the source (they are
//     always integers in this protocol; monetary values are strings, never
//     JSON numbers, so no float rounding can ever occur);
//   - no insignificant whitespace;
//   - strings use the shortest legal escaping.
//
// A canonical encoding matters for two reasons. First, a signature is only
// meaningful if the signer and every verifier agree bit-for-bit on what was
// signed. Second, it removes an entire class of malleability bugs where two
// different byte strings represent the same transaction and therefore hash
// differently.
package codec

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"unicode/utf8"
)

// CanonicalJSON marshals v and returns its canonical form.
func CanonicalJSON(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	return Canonicalize(raw)
}

// Canonicalize rewrites an arbitrary JSON document into canonical form.
func Canonicalize(raw []byte) ([]byte, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber() // never parse a number into float64
	var doc any
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if dec.More() {
		return nil, fmt.Errorf("trailing data after JSON value")
	}
	var buf bytes.Buffer
	if err := writeCanonical(&buf, doc); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeCanonical(buf *bytes.Buffer, v any) error {
	switch t := v.(type) {
	case nil:
		buf.WriteString("null")
	case bool:
		if t {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case json.Number:
		// Integers only: a fractional or exponential form in a signed document
		// is rejected rather than normalised, because any normalisation choice
		// would be a place for signer and verifier to disagree.
		if _, err := t.Int64(); err != nil {
			if !isBigInteger(t.String()) {
				return fmt.Errorf("non-integer number %q in canonical JSON", t.String())
			}
		}
		buf.WriteString(t.String())
	case string:
		writeCanonicalString(buf, t)
	case []any:
		buf.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeCanonical(buf, e); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			writeCanonicalString(buf, k)
			buf.WriteByte(':')
			if err := writeCanonical(buf, t[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	default:
		return fmt.Errorf("unsupported type %T in canonical JSON", v)
	}
	return nil
}

func isBigInteger(s string) bool {
	if s == "" {
		return false
	}
	i := 0
	if s[0] == '-' {
		i = 1
		if len(s) == 1 {
			return false
		}
	}
	for ; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func writeCanonicalString(buf *bytes.Buffer, s string) {
	buf.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			buf.WriteString(`\"`)
		case '\\':
			buf.WriteString(`\\`)
		case '\b':
			buf.WriteString(`\b`)
		case '\f':
			buf.WriteString(`\f`)
		case '\n':
			buf.WriteString(`\n`)
		case '\r':
			buf.WriteString(`\r`)
		case '\t':
			buf.WriteString(`\t`)
		default:
			if r < 0x20 {
				buf.WriteString(`\u`)
				buf.WriteString(fmt.Sprintf("%04x", r))
			} else if r == utf8.RuneError {
				buf.WriteString(`�`)
			} else {
				buf.WriteRune(r)
			}
		}
	}
	buf.WriteByte('"')
}

// Uint64String renders a uint64 for embedding in a canonical document.
func Uint64String(v uint64) string { return strconv.FormatUint(v, 10) }
