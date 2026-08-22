// Package keyring stores YOZEXA account keys on disk, encrypted.
//
// Private keys are never written in plaintext, never logged, and never leave
// this package unencrypted. The file format is deliberately simple and
// documented so that a user is never locked out by tooling: given the
// passphrase, the key can be recovered with a short script.
//
// Encryption: scrypt (N=2^17, r=8, p=1) stretches the passphrase into a
// 32-byte key, which encrypts the private key with XChaCha20-Poly1305. Both
// are standard, modern primitives; nothing here is home-made.
package keyring

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/scrypt"

	"github.com/tyler-smith/go-bip39"

	"github.com/yozexa/yozexa/chain/crypto"
	"github.com/yozexa/yozexa/chain/types"
)

// scrypt parameters. N is high enough that brute-forcing a weak passphrase is
// expensive on commodity hardware, and low enough to unlock in about a second.
const (
	scryptN      = 1 << 17
	scryptR      = 8
	scryptP      = 1
	scryptKeyLen = 32
	saltLen      = 32
)

// Record is one stored key.
type Record struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	PubKey  string `json:"pubkey"`
	// Salt and Ciphertext hold the encrypted private key. There is no field
	// anywhere in this struct that contains key material in the clear.
	Salt       string `json:"salt"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
	KDF        string `json:"kdf"`
	Cipher     string `json:"cipher"`
	// HasMnemonic records whether the key came from a BIP-39 mnemonic, so the
	// CLI can tell the user whether their seed phrase can restore it.
	HasMnemonic bool `json:"has_mnemonic"`
}

// Keyring is a directory of encrypted key files.
type Keyring struct{ dir string }

// Open prepares a keyring rooted at dir, creating it with owner-only
// permissions if needed.
func Open(dir string) (*Keyring, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create keyring directory: %w", err)
	}
	// Refuse to use a keyring that other users on the machine can read.
	info, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		if err := os.Chmod(dir, 0o700); err != nil {
			return nil, fmt.Errorf(
				"keyring directory %s is readable by other users (mode %o) and could not be tightened: %w",
				dir, perm, err)
		}
	}
	return &Keyring{dir: dir}, nil
}

func (k *Keyring) path(name string) string { return filepath.Join(k.dir, name+".json") }

func validateName(name string) error {
	if name == "" {
		return fmt.Errorf("key name is required")
	}
	if strings.ContainsAny(name, `/\.`) || strings.Contains(name, "..") {
		return fmt.Errorf("key name %q may not contain path separators", name)
	}
	if len(name) > 64 {
		return fmt.Errorf("key name too long")
	}
	return nil
}

// GenerateMnemonic produces a fresh 24-word BIP-39 seed phrase (256 bits of
// entropy from the operating system CSPRNG).
func GenerateMnemonic() (string, error) {
	entropy, err := bip39.NewEntropy(256)
	if err != nil {
		return "", fmt.Errorf("generate entropy: %w", err)
	}
	return bip39.NewMnemonic(entropy)
}

// KeyFromMnemonic derives an account key from a BIP-39 mnemonic.
//
// The derivation is: seed = BIP-39(mnemonic, passphrase), then the private key
// is the first 32 bytes of the seed reduced into the secp256k1 scalar field.
// It is documented in docs/WALLET_SECURITY.md so that any wallet can
// reproduce it.
func KeyFromMnemonic(mnemonic, passphrase string) (*crypto.PrivKey, error) {
	if !bip39.IsMnemonicValid(mnemonic) {
		return nil, fmt.Errorf("the recovery phrase is not a valid BIP-39 mnemonic")
	}
	seed := bip39.NewSeed(mnemonic, passphrase)
	return crypto.PrivKeyFromBytes(seed[:32])
}

// Create generates a new key, stores it encrypted and returns the record plus
// the mnemonic that can restore it.
func (k *Keyring) Create(name, passphrase string) (Record, string, error) {
	if err := validateName(name); err != nil {
		return Record{}, "", err
	}
	if _, err := os.Stat(k.path(name)); err == nil {
		return Record{}, "", fmt.Errorf("a key named %q already exists", name)
	}
	mnemonic, err := GenerateMnemonic()
	if err != nil {
		return Record{}, "", err
	}
	key, err := KeyFromMnemonic(mnemonic, "")
	if err != nil {
		return Record{}, "", err
	}
	rec, err := k.store(name, key, passphrase, true)
	if err != nil {
		return Record{}, "", err
	}
	return rec, mnemonic, nil
}

// Import stores an existing mnemonic under a name.
func (k *Keyring) Import(name, mnemonic, bip39Passphrase, passphrase string) (Record, error) {
	if err := validateName(name); err != nil {
		return Record{}, err
	}
	if _, err := os.Stat(k.path(name)); err == nil {
		return Record{}, fmt.Errorf("a key named %q already exists", name)
	}
	key, err := KeyFromMnemonic(mnemonic, bip39Passphrase)
	if err != nil {
		return Record{}, err
	}
	return k.store(name, key, passphrase, true)
}

func (k *Keyring) store(name string, key *crypto.PrivKey, passphrase string, fromMnemonic bool) (Record, error) {
	if len(passphrase) < 8 {
		return Record{}, fmt.Errorf("the keyring passphrase must be at least 8 characters")
	}
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return Record{}, err
	}
	derived, err := scrypt.Key([]byte(passphrase), salt, scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		return Record{}, fmt.Errorf("derive encryption key: %w", err)
	}
	aead, err := chacha20poly1305.NewX(derived)
	if err != nil {
		return Record{}, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return Record{}, err
	}

	secret := key.Bytes()
	// The address is authenticated as associated data, so a ciphertext cannot
	// be moved between records to make a key decrypt "as" another account.
	addr := key.Address()
	ciphertext := aead.Seal(nil, nonce, secret, []byte(addr.String()))
	for i := range secret {
		secret[i] = 0
	}

	rec := Record{
		Name:        name,
		Address:     addr.String(),
		PubKey:      key.PubKey().Hex(),
		Salt:        base64.StdEncoding.EncodeToString(salt),
		Nonce:       base64.StdEncoding.EncodeToString(nonce),
		Ciphertext:  base64.StdEncoding.EncodeToString(ciphertext),
		KDF:         fmt.Sprintf("scrypt(N=%d,r=%d,p=%d)", scryptN, scryptR, scryptP),
		Cipher:      "xchacha20poly1305",
		HasMnemonic: fromMnemonic,
	}
	raw, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return Record{}, err
	}
	if err := os.WriteFile(k.path(name), raw, 0o600); err != nil {
		return Record{}, fmt.Errorf("write key file: %w", err)
	}
	return rec, nil
}

// Unlock decrypts a stored key.
func (k *Keyring) Unlock(name, passphrase string) (*crypto.PrivKey, error) {
	rec, err := k.Get(name)
	if err != nil {
		return nil, err
	}
	salt, err := base64.StdEncoding.DecodeString(rec.Salt)
	if err != nil {
		return nil, fmt.Errorf("corrupt key file: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(rec.Nonce)
	if err != nil {
		return nil, fmt.Errorf("corrupt key file: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(rec.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("corrupt key file: %w", err)
	}
	derived, err := scrypt.Key([]byte(passphrase), salt, scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		return nil, err
	}
	aead, err := chacha20poly1305.NewX(derived)
	if err != nil {
		return nil, err
	}
	secret, err := aead.Open(nil, nonce, ciphertext, []byte(rec.Address))
	if err != nil {
		return nil, fmt.Errorf("could not unlock key %q: wrong passphrase, or the key file has been altered", name)
	}
	key, err := crypto.PrivKeyFromBytes(secret)
	for i := range secret {
		secret[i] = 0
	}
	if err != nil {
		return nil, err
	}
	// Confirm the decrypted key really controls the stored address.
	if key.Address().String() != rec.Address {
		return nil, fmt.Errorf("key file %q is inconsistent: the stored key does not control the stored address", name)
	}
	return key, nil
}

// Get reads a record without decrypting it.
func (k *Keyring) Get(name string) (Record, error) {
	if err := validateName(name); err != nil {
		return Record{}, err
	}
	raw, err := os.ReadFile(k.path(name))
	if err != nil {
		if os.IsNotExist(err) {
			return Record{}, fmt.Errorf("no key named %q in this keyring", name)
		}
		return Record{}, err
	}
	var rec Record
	if err := json.Unmarshal(raw, &rec); err != nil {
		return Record{}, fmt.Errorf("corrupt key file %q: %w", name, err)
	}
	return rec, nil
}

// List returns every stored key, sorted by name.
func (k *Keyring) List() ([]Record, error) {
	entries, err := os.ReadDir(k.dir)
	if err != nil {
		return nil, err
	}
	var out []Record
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		rec, err := k.Get(strings.TrimSuffix(e.Name(), ".json"))
		if err != nil {
			continue
		}
		out = append(out, rec)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Delete removes a key file.
func (k *Keyring) Delete(name string) error {
	if err := validateName(name); err != nil {
		return err
	}
	return os.Remove(k.path(name))
}

// Address resolves a key name to its address.
func (k *Keyring) Address(name string) (types.Address, error) {
	rec, err := k.Get(name)
	if err != nil {
		return types.Address{}, err
	}
	return types.ParseAddress(rec.Address)
}
