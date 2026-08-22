package store

import (
	"bytes"
	"fmt"
	"math/rand"
	"testing"

	dbm "github.com/cometbft/cometbft-db"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(dbm.NewMemDB())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return s
}

func TestSetGetCommit(t *testing.T) {
	s := newTestStore(t)
	if err := s.Set([]byte("account/alice"), []byte("100")); err != nil {
		t.Fatal(err)
	}
	v, err := s.Get([]byte("account/alice"))
	if err != nil {
		t.Fatal(err)
	}
	if string(v) != "100" {
		t.Fatalf("got %q", v)
	}
	root, err := s.Commit(1)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(root, emptyHash) {
		t.Fatal("root is empty after a commit with data")
	}
	if s.Version() != 1 {
		t.Fatalf("version = %d", s.Version())
	}
}

func TestDiscardDropsPendingWrites(t *testing.T) {
	s := newTestStore(t)
	_ = s.Set([]byte("k"), []byte("v"))
	s.Discard()
	if _, err := s.Get([]byte("k")); err == nil {
		t.Fatal("discarded write is still visible")
	}
}

// The root must depend only on the *set* of key/value pairs, never on the
// order they were written. Without this property two honest validators that
// processed the same transactions in the same block could commit different
// app hashes and halt the chain.
func TestRootIsIndependentOfInsertionOrder(t *testing.T) {
	pairs := make([][2]string, 0, 200)
	for i := 0; i < 200; i++ {
		pairs = append(pairs, [2]string{fmt.Sprintf("key-%03d", i), fmt.Sprintf("value-%d", i*7)})
	}

	a := newTestStore(t)
	for _, p := range pairs {
		_ = a.Set([]byte(p[0]), []byte(p[1]))
	}
	rootA, err := a.Commit(1)
	if err != nil {
		t.Fatal(err)
	}

	rng := rand.New(rand.NewSource(42))
	rng.Shuffle(len(pairs), func(i, j int) { pairs[i], pairs[j] = pairs[j], pairs[i] })

	b := newTestStore(t)
	for _, p := range pairs {
		_ = b.Set([]byte(p[0]), []byte(p[1]))
	}
	rootB, err := b.Commit(1)
	if err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(rootA, rootB) {
		t.Fatalf("root depends on insertion order:\n%x\n%x", rootA, rootB)
	}
}

func TestDeleteRestoresPreviousRoot(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < 50; i++ {
		_ = s.Set([]byte(fmt.Sprintf("k%d", i)), []byte("v"))
	}
	base, err := s.Commit(1)
	if err != nil {
		t.Fatal(err)
	}

	_ = s.Set([]byte("temporary"), []byte("value"))
	withExtra, err := s.Commit(2)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(base, withExtra) {
		t.Fatal("adding a key did not change the root")
	}

	_ = s.Delete([]byte("temporary"))
	afterDelete, err := s.Commit(3)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(base, afterDelete) {
		t.Fatalf("deleting the key did not restore the root:\n%x\n%x", base, afterDelete)
	}
}

func TestMembershipAndNonMembershipProofs(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < 300; i++ {
		_ = s.Set([]byte(fmt.Sprintf("balance/%d", i)), []byte(fmt.Sprintf("%d000", i)))
	}
	root, err := s.Commit(1)
	if err != nil {
		t.Fatal(err)
	}

	key := []byte("balance/42")
	proof, value, err := s.Prove(key)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyProof(root, KeyHash(key), ValueHash(value), proof) {
		t.Fatal("membership proof did not verify")
	}
	// A proof must not verify against a value the account does not hold.
	if VerifyProof(root, KeyHash(key), ValueHash([]byte("999999")), proof) {
		t.Fatal("proof verified for a forged value")
	}

	absent := []byte("balance/does-not-exist")
	absentProof, _, err := s.Prove(absent)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyProof(root, KeyHash(absent), nil, absentProof) {
		t.Fatal("non-membership proof did not verify")
	}
	// An absence proof must not be usable to claim the key is present.
	if VerifyProof(root, KeyHash(absent), ValueHash([]byte("1")), absentProof) {
		t.Fatal("absence proof verified as a membership proof")
	}
}

func TestIterateIsOrderedAndPrefixScoped(t *testing.T) {
	s := newTestStore(t)
	_ = s.Set([]byte("a/1"), []byte("1"))
	_ = s.Set([]byte("a/3"), []byte("3"))
	_ = s.Set([]byte("b/1"), []byte("x"))
	if _, err := s.Commit(1); err != nil {
		t.Fatal(err)
	}
	_ = s.Set([]byte("a/2"), []byte("2")) // pending, must still be visible

	var got []string
	if err := s.Iterate([]byte("a/"), func(k, v []byte) bool {
		got = append(got, string(k)+"="+string(v))
		return true
	}); err != nil {
		t.Fatal(err)
	}
	want := []string{"a/1=1", "a/2=2", "a/3=3"}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
}

func TestReopenPreservesRoot(t *testing.T) {
	db := dbm.NewMemDB()
	s, err := Open(db)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Set([]byte("supply/minted"), []byte("5000000"))
	root, err := s.Commit(7)
	if err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(db)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Version() != 7 {
		t.Fatalf("version = %d after reopen", reopened.Version())
	}
	if !bytes.Equal(reopened.Root(), root) {
		t.Fatal("root changed across reopen")
	}
	v, err := reopened.Get([]byte("supply/minted"))
	if err != nil || string(v) != "5000000" {
		t.Fatalf("value lost across reopen: %q %v", v, err)
	}
}
