// Package store implements YOZEXA's authenticated state.
//
// State is held in a sparse Merkle tree over SHA-256 hashed keys. Every block
// commits a 32-byte root that goes into the block header, so:
//
//   - two honest nodes that processed the same blocks provably hold the same
//     state, and any divergence halts consensus instead of silently forking
//     balances;
//   - a wallet or an auditor can be given a proof that an account holds a
//     balance, or that a key does *not* exist, without trusting the node that
//     served it.
//
// The tree uses leaf compression: an empty subtree costs nothing and a subtree
// containing exactly one key is stored as a single leaf, so the depth of a
// lookup is logarithmic in the number of stored keys rather than a fixed 256.
package store

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"

	dbm "github.com/cometbft/cometbft-db"
)

const hashSize = 32

// Node type tags. They are part of the hashed pre-image, which is what
// prevents an attacker from presenting an internal node as a leaf (or the
// reverse) to forge a proof.
const (
	tagLeaf     byte = 0x00
	tagInternal byte = 0x01
)

// emptyHash marks an empty subtree.
var emptyHash = make([]byte, hashSize)

// nodeStore reads and writes tree nodes, content-addressed by their hash.
type nodeStore interface {
	getNode(hash []byte) ([]byte, error)
	putNode(hash, data []byte)
}

func isEmpty(h []byte) bool { return len(h) == 0 || bytes.Equal(h, emptyHash) }

func hashLeaf(keyHash, valueHash []byte) []byte {
	h := sha256.New()
	h.Write([]byte{tagLeaf})
	h.Write(keyHash)
	h.Write(valueHash)
	return h.Sum(nil)
}

func hashInternal(left, right []byte) []byte {
	h := sha256.New()
	h.Write([]byte{tagInternal})
	h.Write(left)
	h.Write(right)
	return h.Sum(nil)
}

func encodeLeaf(keyHash, valueHash []byte) []byte {
	out := make([]byte, 1+hashSize*2)
	out[0] = tagLeaf
	copy(out[1:], keyHash)
	copy(out[1+hashSize:], valueHash)
	return out
}

func encodeInternal(left, right []byte) []byte {
	out := make([]byte, 1+hashSize*2)
	out[0] = tagInternal
	copy(out[1:], left)
	copy(out[1+hashSize:], right)
	return out
}

func decodeNode(data []byte) (tag byte, a, b []byte, err error) {
	if len(data) != 1+hashSize*2 {
		return 0, nil, nil, fmt.Errorf("corrupt tree node: %d bytes", len(data))
	}
	return data[0], data[1 : 1+hashSize], data[1+hashSize:], nil
}

// bitAt reports whether bit `i` (from the most significant bit of byte 0) of
// the key hash is set. It defines the path a key takes through the tree.
func bitAt(keyHash []byte, i int) bool {
	return keyHash[i/8]&(1<<(7-uint(i%8))) != 0
}

// maxDepth is the number of bits in a key hash. Two distinct keys can only
// collide for the whole depth if SHA-256 itself is broken.
const maxDepth = hashSize * 8

// smt is a sparse Merkle tree rooted at `root`.
type smt struct {
	nodes nodeStore
	root  []byte
}

// Root returns the current root hash (32 zero bytes when empty).
func (t *smt) Root() []byte {
	if isEmpty(t.root) {
		return append([]byte(nil), emptyHash...)
	}
	return append([]byte(nil), t.root...)
}

// Update inserts or replaces a key.
func (t *smt) Update(keyHash, valueHash []byte) error {
	newRoot, err := t.update(t.root, keyHash, valueHash, 0)
	if err != nil {
		return err
	}
	t.root = newRoot
	return nil
}

func (t *smt) update(node, keyHash, valueHash []byte, depth int) ([]byte, error) {
	if depth > maxDepth {
		return nil, errors.New("sparse merkle tree: maximum depth exceeded")
	}
	if isEmpty(node) {
		return t.writeLeaf(keyHash, valueHash), nil
	}
	data, err := t.nodes.getNode(node)
	if err != nil {
		return nil, err
	}
	tag, a, b, err := decodeNode(data)
	if err != nil {
		return nil, err
	}
	if tag == tagLeaf {
		existingKey, existingValue := a, b
		if bytes.Equal(existingKey, keyHash) {
			return t.writeLeaf(keyHash, valueHash), nil
		}
		// Two different keys now share this position: push both down until
		// their paths diverge, creating internal nodes on the way.
		return t.split(existingKey, existingValue, keyHash, valueHash, depth)
	}

	left, right := a, b
	if bitAt(keyHash, depth) {
		newRight, err := t.update(right, keyHash, valueHash, depth+1)
		if err != nil {
			return nil, err
		}
		right = newRight
	} else {
		newLeft, err := t.update(left, keyHash, valueHash, depth+1)
		if err != nil {
			return nil, err
		}
		left = newLeft
	}
	return t.writeInternal(left, right), nil
}

func (t *smt) split(keyA, valA, keyB, valB []byte, depth int) ([]byte, error) {
	if depth >= maxDepth {
		return nil, errors.New("sparse merkle tree: hash collision between distinct keys")
	}
	bitA, bitB := bitAt(keyA, depth), bitAt(keyB, depth)
	if bitA == bitB {
		child, err := t.split(keyA, valA, keyB, valB, depth+1)
		if err != nil {
			return nil, err
		}
		if bitA {
			return t.writeInternal(emptyHash, child), nil
		}
		return t.writeInternal(child, emptyHash), nil
	}
	leafA := t.writeLeaf(keyA, valA)
	leafB := t.writeLeaf(keyB, valB)
	if bitA {
		return t.writeInternal(leafB, leafA), nil
	}
	return t.writeInternal(leafA, leafB), nil
}

// Delete removes a key, collapsing now-redundant internal nodes so that the
// tree shape depends only on the set of live keys, never on insertion order.
func (t *smt) Delete(keyHash []byte) error {
	newRoot, _, err := t.delete(t.root, keyHash, 0)
	if err != nil {
		return err
	}
	t.root = newRoot
	return nil
}

// delete returns the new subtree hash and, when the subtree collapsed to a
// single leaf, that leaf so the parent can pull it up.
func (t *smt) delete(node, keyHash []byte, depth int) (newHash []byte, loneLeaf []byte, err error) {
	if isEmpty(node) {
		return append([]byte(nil), emptyHash...), nil, nil
	}
	data, err := t.nodes.getNode(node)
	if err != nil {
		return nil, nil, err
	}
	tag, a, b, err := decodeNode(data)
	if err != nil {
		return nil, nil, err
	}
	if tag == tagLeaf {
		if bytes.Equal(a, keyHash) {
			return append([]byte(nil), emptyHash...), nil, nil
		}
		return node, nil, nil // key absent: nothing changes
	}

	left, right := a, b
	if bitAt(keyHash, depth) {
		nr, lone, err := t.delete(right, keyHash, depth+1)
		if err != nil {
			return nil, nil, err
		}
		right = nr
		if lone != nil {
			right = lone
		}
	} else {
		nl, lone, err := t.delete(left, keyHash, depth+1)
		if err != nil {
			return nil, nil, err
		}
		left = nl
		if lone != nil {
			left = lone
		}
	}

	leftEmpty, rightEmpty := isEmpty(left), isEmpty(right)
	switch {
	case leftEmpty && rightEmpty:
		return append([]byte(nil), emptyHash...), nil, nil
	case leftEmpty:
		if leaf, ok, err := t.asLeaf(right); err != nil {
			return nil, nil, err
		} else if ok {
			return right, leaf, nil
		}
	case rightEmpty:
		if leaf, ok, err := t.asLeaf(left); err != nil {
			return nil, nil, err
		} else if ok {
			return left, leaf, nil
		}
	}
	return t.writeInternal(left, right), nil, nil
}

// asLeaf reports whether a subtree hash points at a leaf node.
func (t *smt) asLeaf(node []byte) ([]byte, bool, error) {
	if isEmpty(node) {
		return nil, false, nil
	}
	data, err := t.nodes.getNode(node)
	if err != nil {
		return nil, false, err
	}
	if len(data) == 0 {
		return nil, false, fmt.Errorf("missing tree node")
	}
	if data[0] == tagLeaf {
		return node, true, nil
	}
	return nil, false, nil
}

func (t *smt) writeLeaf(keyHash, valueHash []byte) []byte {
	enc := encodeLeaf(keyHash, valueHash)
	h := hashLeaf(keyHash, valueHash)
	t.nodes.putNode(h, enc)
	return h
}

func (t *smt) writeInternal(left, right []byte) []byte {
	l, r := left, right
	if isEmpty(l) {
		l = emptyHash
	}
	if isEmpty(r) {
		r = emptyHash
	}
	enc := encodeInternal(l, r)
	h := hashInternal(l, r)
	t.nodes.putNode(h, enc)
	return h
}

// Proof is a Merkle proof of membership or non-membership.
type Proof struct {
	// Siblings are the sibling hashes from the leaf position up to the root.
	Siblings [][]byte `json:"siblings"`
	// LeafKeyHash and LeafValueHash describe the leaf actually found at the
	// end of the path. For a membership proof it is the queried key. For a
	// non-membership proof it is either empty (the path ends in an empty
	// subtree) or a *different* key, which proves the queried key is absent
	// because that other key occupies the position.
	LeafKeyHash   []byte `json:"leaf_key_hash,omitempty"`
	LeafValueHash []byte `json:"leaf_value_hash,omitempty"`
}

// Prove builds a proof for the given key hash.
func (t *smt) Prove(keyHash []byte) (*Proof, error) {
	p := &Proof{}
	node := t.root
	for depth := 0; depth <= maxDepth; depth++ {
		if isEmpty(node) {
			return p, nil // absent: path ends in an empty subtree
		}
		data, err := t.nodes.getNode(node)
		if err != nil {
			return nil, err
		}
		tag, a, b, err := decodeNode(data)
		if err != nil {
			return nil, err
		}
		if tag == tagLeaf {
			p.LeafKeyHash = append([]byte(nil), a...)
			p.LeafValueHash = append([]byte(nil), b...)
			return p, nil
		}
		if bitAt(keyHash, depth) {
			p.Siblings = append(p.Siblings, append([]byte(nil), a...))
			node = b
		} else {
			p.Siblings = append(p.Siblings, append([]byte(nil), b...))
			node = a
		}
	}
	return nil, errors.New("proof path exceeded maximum depth")
}

// VerifyProof recomputes the root from a proof and compares it with `root`.
//
// When valueHash is nil the proof is checked as a non-membership proof.
func VerifyProof(root, keyHash, valueHash []byte, p *Proof) bool {
	if p == nil || len(root) != hashSize || len(keyHash) != hashSize {
		return false
	}
	if len(p.Siblings) > maxDepth {
		return false
	}

	var current []byte
	if valueHash == nil {
		// Non-membership: either the path ended empty, or it ended on a leaf
		// holding some other key.
		if len(p.LeafKeyHash) == 0 {
			current = emptyHash
		} else {
			if bytes.Equal(p.LeafKeyHash, keyHash) {
				return false // the key is present; this is not an absence proof
			}
			current = hashLeaf(p.LeafKeyHash, p.LeafValueHash)
		}
	} else {
		if len(p.LeafKeyHash) == 0 || !bytes.Equal(p.LeafKeyHash, keyHash) {
			return false
		}
		if !bytes.Equal(p.LeafValueHash, valueHash) {
			return false
		}
		current = hashLeaf(keyHash, valueHash)
	}

	for i := len(p.Siblings) - 1; i >= 0; i-- {
		sibling := p.Siblings[i]
		if len(sibling) != hashSize {
			return false
		}
		if bitAt(keyHash, i) {
			current = hashInternal(sibling, current)
		} else {
			current = hashInternal(current, sibling)
		}
	}
	return bytes.Equal(current, root)
}

// dbNodeStore persists nodes in a CometBFT database behind a prefix, batching
// writes so that a whole block commits atomically.
type dbNodeStore struct {
	db    dbm.DB
	cache map[string][]byte
}

func newDBNodeStore(db dbm.DB) *dbNodeStore {
	return &dbNodeStore{db: db, cache: map[string][]byte{}}
}

var nodePrefix = []byte("n/")

func (s *dbNodeStore) getNode(hash []byte) ([]byte, error) {
	if v, ok := s.cache[string(hash)]; ok {
		return v, nil
	}
	v, err := s.db.Get(append(append([]byte(nil), nodePrefix...), hash...))
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, fmt.Errorf("tree node %x not found", hash)
	}
	return v, nil
}

func (s *dbNodeStore) putNode(hash, data []byte) {
	s.cache[string(hash)] = data
}

// flush writes every node created since the last flush into the batch.
func (s *dbNodeStore) flush(batch dbm.Batch) error {
	for h, data := range s.cache {
		if err := batch.Set(append(append([]byte(nil), nodePrefix...), []byte(h)...), data); err != nil {
			return err
		}
	}
	s.cache = map[string][]byte{}
	return nil
}
