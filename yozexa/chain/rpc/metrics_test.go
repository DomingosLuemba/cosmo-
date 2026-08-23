package rpc

import (
	"strings"
	"testing"
)

// The exposition format is picky: a scraper rejects the whole response if HELP
// and TYPE are wrong or repeated, and a silently rejected scrape looks exactly
// like a healthy one with no alerts firing.
func TestMetricsRenderInTheExpositionFormat(t *testing.T) {
	out := render([]metric{
		{name: "yozexa_a", help: "first", kind: "gauge", value: 1},
		{name: "yozexa_a", help: "first", kind: "gauge", value: 0,
			labels: map[string]string{"invariant": "supply-cap"}},
		{name: "yozexa_b", help: "second", kind: "counter", value: 1.5},
	})

	if got := strings.Count(out, "# HELP yozexa_a"); got != 1 {
		t.Fatalf("HELP for yozexa_a appears %d times, want exactly 1:\n%s", got, out)
	}
	if got := strings.Count(out, "# TYPE yozexa_a"); got != 1 {
		t.Fatalf("TYPE for yozexa_a appears %d times, want exactly 1:\n%s", got, out)
	}
	for _, want := range []string{
		"# HELP yozexa_a first\n# TYPE yozexa_a gauge\nyozexa_a 1\n",
		`yozexa_a{invariant="supply-cap"} 0`,
		"# TYPE yozexa_b counter\nyozexa_b 1.5\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

// Labels are sorted so two scrapes of the same state produce identical text.
// Without that, a diff of two scrapes is unreadable and a naive change
// detector fires on nothing.
func TestMetricLabelsAreOrderedAndEscaped(t *testing.T) {
	out := render([]metric{{
		name: "m", help: "h", kind: "gauge", value: 1,
		labels: map[string]string{"zebra": "z", "alpha": "a", "quote": `a"b`},
	}})
	want := `m{alpha="a",quote="a\"b",zebra="z"} 1`
	if !strings.Contains(out, want) {
		t.Fatalf("got:\n%s\nwant a line containing %s", out, want)
	}
}

// A base-unit figure is up to 10^25, which no float64 holds exactly. Amounts
// are published in YZXA for that reason, and this pins the conversion — if it
// ever silently changed scale, every supply alert would be off by 10^18.
func TestSupplyIsConvertedFromBaseUnitsToYZXA(t *testing.T) {
	cases := []struct {
		baseUnits string
		want      float64
	}{
		{"0", 0},
		{"1000000000000000000", 1}, // 1 YZXA
		{"10000000000000000000000000", 10_000_000}, // the hard cap
		{"2500000000000000000", 2.5},
		{"not a number", 0},
		{"", 0},
	}
	for _, tc := range cases {
		if got := yzxa(tc.baseUnits); got != tc.want {
			t.Errorf("yzxa(%q) = %v, want %v", tc.baseUnits, got, tc.want)
		}
	}
}

// A gauge that reads 1e+06 instead of 1000000 is still valid, but nobody can
// scan a scrape by eye. Whole numbers stay whole.
func TestWholeNumbersAreNotPrintedInExponentForm(t *testing.T) {
	for _, tc := range []struct {
		value float64
		want  string
	}{
		{1_000_000, "1000000"},
		{0, "0"},
		{4, "4"},
		{1.5, "1.5"},
		{-3, "-3"},
	} {
		if got := formatValue(tc.value); got != tc.want {
			t.Errorf("formatValue(%v) = %q, want %q", tc.value, got, tc.want)
		}
	}
}

// A boolean metric must be exactly 0 or 1: the alert rules compare with ==.
func TestBooleanMetricsAreZeroOrOne(t *testing.T) {
	if boolValue(true) != 1 || boolValue(false) != 0 {
		t.Fatalf("boolValue must be 1/0, got %v/%v", boolValue(true), boolValue(false))
	}
}
