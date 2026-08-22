package store

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strings"

	dbm "github.com/cometbft/cometbft-db"
)

var (
	dataPrefix   = []byte("d/")
	metaLastVer  = []byte("m/last-version")
	metaLastRoot = []byte("m/last-root")
)

// ErrNotFound is returned when a key is absent from the store.
var ErrNotFound = errors.New("key not found")

// Store is the committed application state: a key/value map whose contents
// are authenticated by a sparse Merkle root.
//
// Writes made through Set/Delete are staged in memory and become durable and
// visible in the root only when Commit is called. A block therefore either
// applies in full or not at all.
type Store struct {
	db      dbm.DB
	nodes   *dbNodeStore
	tree    *smt
	version int64

	// pending holds writes staged since the last Commit. A nil value means
	// the key is being deleted.
	pending map[string][]byte
}

// Open loads a store from a database, restoring the last committed version.
func Open(db dbm.DB) (*Store, error) {
	nodes := newDBNodeStore(db)
	s := &Store{
		db:      db,
		nodes:   nodes,
		tree:    &smt{nodes: nodes},
		pending: map[string][]byte{},
	}

	verBytes, err := db.Get(metaLastVer)
	if err != nil {
		return nil, err
	}
	if verBytes != nil {
		if len(verBytes) != 8 {
			return nil, fmt.Errorf("corrupt store metadata: version is %d bytes", len(verBytes))
		}
		s.version = int64(binary.BigEndian.Uint64(verBytes))
		root, err := db.Get(metaLastRoot)
		if err != nil {
			return nil, err
		}
		if len(root) != hashSize {
			return nil, fmt.Errorf("corrupt store metadata: root is %d bytes", len(root))
		}
		s.tree.root = root
	}
	return s, nil
}

// Version returns the height of the last commit.
func (s *Store) Version() int64 { return s.version }

// Root returns the committed Merkle root. Pending writes are not included:
// the root only ever describes state that has been committed.
func (s *Store) Root() []byte { return s.tree.Root() }

func dataKey(key []byte) []byte {
	return append(append([]byte(nil), dataPrefix...), key...)
}

// Get returns the value for a key, honouring pending writes.
func (s *Store) Get(key []byte) ([]byte, error) {
	if v, ok := s.pending[string(key)]; ok {
		if v == nil {
			return nil, ErrNotFound
		}
		return append([]byte(nil), v...), nil
	}
	v, err := s.db.Get(dataKey(key))
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, ErrNotFound
	}
	return v, nil
}

// Has reports whether a key exists.
func (s *Store) Has(key []byte) (bool, error) {
	_, err := s.Get(key)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Set stages a write.
func (s *Store) Set(key, value []byte) error {
	if len(key) == 0 {
		return errors.New("empty key")
	}
	s.pending[string(key)] = append([]byte(nil), value...)
	return nil
}

// Delete stages a deletion.
func (s *Store) Delete(key []byte) error {
	if len(key) == 0 {
		return errors.New("empty key")
	}
	s.pending[string(key)] = nil
	return nil
}

// Iterate visits every committed key with the given prefix in ascending order,
// merged with pending writes. It stops early if fn returns false.
//
// Iteration order is deterministic across nodes, which matters because module
// logic that iterates (validator sets, unbonding queues, proposal tallies)
// must produce identical results everywhere.
func (s *Store) Iterate(prefix []byte, fn func(key, value []byte) bool) error {
	full := dataKey(prefix)
	it, err := s.db.Iterator(full, prefixEnd(full))
	if err != nil {
		return err
	}
	defer it.Close()

	// Merge committed rows with pending writes for the same prefix.
	merged := map[string][]byte{}
	for ; it.Valid(); it.Next() {
		k := append([]byte(nil), it.Key()[len(dataPrefix):]...)
		merged[string(k)] = append([]byte(nil), it.Value()...)
	}
	if err := it.Error(); err != nil {
		return err
	}
	for k, v := range s.pending {
		if !strings.HasPrefix(k, string(prefix)) {
			continue
		}
		if v == nil {
			delete(merged, k)
		} else {
			merged[k] = v
		}
	}

	keys := make([]string, 0, len(merged))
	for k := range merged {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !fn([]byte(k), merged[k]) {
			break
		}
	}
	return nil
}

func prefixEnd(prefix []byte) []byte {
	if len(prefix) == 0 {
		return nil
	}
	end := append([]byte(nil), prefix...)
	for i := len(end) - 1; i >= 0; i-- {
		if end[i] < 0xFF {
			end[i]++
			return end[:i+1]
		}
	}
	return nil
}

// Discard drops all pending writes. Used when a transaction fails and its
// partial effects must not survive.
func (s *Store) Discard() { s.pending = map[string][]byte{} }

// PendingCount reports how many keys are staged.
func (s *Store) PendingCount() int { return len(s.pending) }

// Commit applies all pending writes atomically at the given version and
// returns the new Merkle root.
func (s *Store) Commit(version int64) ([]byte, error) {
	if version <= s.version && s.version != 0 {
		return nil, fmt.Errorf("commit version %d is not greater than current %d", version, s.version)
	}

	// Apply writes to the tree in deterministic key order. The tree result is
	// order-independent by construction, but a fixed order keeps node writes
	// (and therefore disk layout) reproducible across nodes.
	keys := make([]string, 0, len(s.pending))
	for k := range s.pending {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	batch := s.db.NewBatch()
	defer batch.Close()

	for _, k := range keys {
		v := s.pending[k]
		kh := sha256.Sum256([]byte(k))
		if v == nil {
			if err := s.tree.Delete(kh[:]); err != nil {
				return nil, err
			}
			if err := batch.Delete(dataKey([]byte(k))); err != nil {
				return nil, err
			}
			continue
		}
		vh := sha256.Sum256(v)
		if err := s.tree.Update(kh[:], vh[:]); err != nil {
			return nil, err
		}
		if err := batch.Set(dataKey([]byte(k)), v); err != nil {
			return nil, err
		}
	}

	if err := s.nodes.flush(batch); err != nil {
		return nil, err
	}

	root := s.tree.Root()
	var vb [8]byte
	binary.BigEndian.PutUint64(vb[:], uint64(version))
	if err := batch.Set(metaLastVer, vb[:]); err != nil {
		return nil, err
	}
	if err := batch.Set(metaLastRoot, root); err != nil {
		return nil, err
	}
	if err := batch.WriteSync(); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	s.pending = map[string][]byte{}
	s.version = version
	return root, nil
}

// Prove returns a Merkle proof for a key against the committed root.
// Pending (uncommitted) writes are deliberately not provable.
func (s *Store) Prove(key []byte) (*Proof, []byte, error) {
	kh := sha256.Sum256(key)
	p, err := s.tree.Prove(kh[:])
	if err != nil {
		return nil, nil, err
	}
	v, err := s.db.Get(dataKey(key))
	if err != nil {
		return nil, nil, err
	}
	return p, v, nil
}

// KeyHash exposes the hashing used to place a key in the tree, so that
// external verifiers can check proofs without depending on this package's
// internals.
func KeyHash(key []byte) []byte {
	h := sha256.Sum256(key)
	return h[:]
}

// ValueHash exposes the value hashing used by the tree.
func ValueHash(value []byte) []byte {
	h := sha256.Sum256(value)
	return h[:]
}

// SnapshotPending copies the staged write set.
//
// The state machine uses it to make a transaction's fee charge survive a
// failed message batch: the fee is applied, the pending set is snapshotted,
// the messages run, and on failure the snapshot is restored. That is what
// makes a failing transaction still cost its sender, which is what stops free
// spam.
func (s *Store) SnapshotPending() map[string][]byte {
	out := make(map[string][]byte, len(s.pending))
	for k, v := range s.pending {
		if v == nil {
			out[k] = nil
			continue
		}
		out[k] = append([]byte(nil), v...)
	}
	return out
}

// RestorePending replaces the staged write set with a previous snapshot.
func (s *Store) RestorePending(snapshot map[string][]byte) {
	next := make(map[string][]byte, len(snapshot))
	for k, v := range snapshot {
		if v == nil {
			next[k] = nil
			continue
		}
		next[k] = append([]byte(nil), v...)
	}
	s.pending = next
}
