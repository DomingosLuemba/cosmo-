package tx

import (
	"fmt"
	"strings"
	"unicode"
)

// AliasSuffix is the namespace of every YOZEXA ID.
const AliasSuffix = ".yzx"

// Alias length bounds, measured on the label (the part before ".yzx").
const (
	MinAliasLabelLength = 3
	MaxAliasLabelLength = 32
)

// ValidateAlias enforces a deliberately narrow character set for YOZEXA IDs.
//
// Human-readable names are an attack surface: an attacker who can register a
// name that *looks* like someone else's can redirect payments. Rather than
// try to detect confusables after the fact, the protocol restricts the
// alphabet so that the vast majority of homograph attacks are impossible to
// express in the first place:
//
//   - lowercase ASCII letters, digits and single hyphens only;
//   - no Unicode at all, so no Cyrillic "а" impersonating Latin "a", no
//     zero-width joiners, no right-to-left overrides;
//   - no leading, trailing or doubled hyphens, which are the classic way to
//     make two distinct names render alike;
//   - names that are all digits are rejected, so an alias can never be
//     mistaken for an amount or an account number.
func ValidateAlias(alias string) error {
	if alias != strings.ToLower(alias) {
		return fmt.Errorf("alias %q: must be lowercase", alias)
	}
	label, ok := strings.CutSuffix(alias, AliasSuffix)
	if !ok {
		return fmt.Errorf("alias %q: must end in %s", alias, AliasSuffix)
	}
	if len(label) < MinAliasLabelLength || len(label) > MaxAliasLabelLength {
		return fmt.Errorf("alias %q: label must be %d..%d characters",
			alias, MinAliasLabelLength, MaxAliasLabelLength)
	}
	if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
		return fmt.Errorf("alias %q: label must not start or end with a hyphen", alias)
	}
	if strings.Contains(label, "--") {
		return fmt.Errorf("alias %q: label must not contain consecutive hyphens", alias)
	}
	allDigits := true
	for _, r := range label {
		if r > unicode.MaxASCII {
			return fmt.Errorf("alias %q: only ASCII characters are allowed", alias)
		}
		switch {
		case r >= 'a' && r <= 'z':
			allDigits = false
		case r >= '0' && r <= '9':
			// allowed
		case r == '-':
			allDigits = false
		default:
			return fmt.Errorf("alias %q: character %q is not allowed", alias, r)
		}
	}
	if allDigits {
		return fmt.Errorf("alias %q: an alias may not be entirely numeric", alias)
	}
	if reservedAliasLabels[label] {
		return fmt.Errorf("alias %q: this name is reserved by the protocol", alias)
	}
	return nil
}

// reservedAliasLabels are names that must never be claimable by a user,
// because a wallet or a person could reasonably read them as official.
var reservedAliasLabels = map[string]bool{
	"yozexa": true, "yzxa": true, "yoz": true, "treasury": true,
	"admin": true, "support": true, "official": true, "labs": true,
	"foundation": true, "team": true, "founder": true, "security": true,
	"wallet": true, "pay": true, "explorer": true, "faucet": true,
	"validator": true, "staking": true, "governance": true, "network": true,
}
