package store

import (
	"bytes"
	"fmt"
	"testing"

	dbm "github.com/cometbft/cometbft-db"
)

// FuzzStoreProof asserts that a Merkle proof is sound for arbitrary key sets:
// a membership proof verifies only for the value actually stored, and an
// absence proof cannot be turned into a claim of presence.
//
// A soundness break here would let a node lie to a light client or a wallet
// about somebody's balance.
func FuzzStoreProof(f *testing.F) {
	f.Add([]byte("alpha"), []byte("1"), 8)
	f.Add([]byte(""), []byte(""), 0)
	f.Add([]byte("\x00\xff"), []byte("\x00"), 64)

	f.Fuzz(func(t *testing.T, key, value []byte, extra int) {
		if len(key) == 0 || len(key) > 512 || len(value) > 4096 {
			return
		}
		if extra < 0 || extra > 256 {
			extra = 16
		}
		s, err := Open(dbm.NewMemDB())
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < extra; i++ {
			if err := s.Set([]byte(fmt.Sprintf("filler/%d", i)), []byte{byte(i)}); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.Set(key, value); err != nil {
			t.Fatal(err)
		}
		root, err := s.Commit(1)
		if err != nil {
			t.Fatal(err)
		}

		proof, stored, err := s.Prove(key)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(stored, value) {
			t.Fatalf("stored value differs: %q vs %q", stored, value)
		}
		if !VerifyProof(root, KeyHash(key), ValueHash(value), proof) {
			t.Fatalf("membership proof failed for key %q", key)
		}
		forged := append([]byte(nil), value...)
		forged = append(forged, 'x')
		if VerifyProof(root, KeyHash(key), ValueHash(forged), proof) {
			t.Fatalf("proof verified for a value that is not stored")
		}
		if VerifyProof(root, KeyHash(key), nil, proof) {
			t.Fatalf("a present key produced a valid absence proof")
		}

		absent := append([]byte("absent/"), key...)
		absentProof, _, err := s.Prove(absent)
		if err != nil {
			t.Fatal(err)
		}
		if !VerifyProof(root, KeyHash(absent), nil, absentProof) {
			t.Fatalf("absence proof failed for key %q", absent)
		}
		if VerifyProof(root, KeyHash(absent), ValueHash([]byte("anything")), absentProof) {
			t.Fatalf("absence proof was accepted as a membership proof")
		}
	})
}

// FuzzStoreDeleteRestoresRoot asserts that the tree shape depends only on the
// live key set, never on the history of insertions and deletions.
func FuzzStoreDeleteRestoresRoot(f *testing.F) {
	f.Add(4, 7)
	f.Add(64, 3)

	f.Fuzz(func(t *testing.T, n, victim int) {
		if n < 1 || n > 256 {
			n = 32
		}
		if victim < 0 {
			victim = 0
		}
		s, err := Open(dbm.NewMemDB())
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < n; i++ {
			if err := s.Set([]byte(fmt.Sprintf("k/%d", i)), []byte(fmt.Sprintf("v%d", i))); err != nil {
				t.Fatal(err)
			}
		}
		base, err := s.Commit(1)
		if err != nil {
			t.Fatal(err)
		}

		extra := []byte(fmt.Sprintf("extra/%d", victim))
		if err := s.Set(extra, []byte("temp")); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Commit(2); err != nil {
			t.Fatal(err)
		}
		if err := s.Delete(extra); err != nil {
			t.Fatal(err)
		}
		after, err := s.Commit(3)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(base, after) {
			t.Fatalf("root did not return to its previous value after delete:\n%x\n%x", base, after)
		}
	})
}
