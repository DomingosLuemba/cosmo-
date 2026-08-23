"use client";

/**
 * The unlocked session.
 *
 * The decrypted key lives here, in memory, and nowhere else. It is never
 * written to storage, never put in React state that could be serialised into
 * the page, and never sent over the network. Locking zeroes it.
 *
 * An idle timeout locks the wallet automatically: a browser tab left open on a
 * shared machine should not stay able to spend.
 */
import { PrivateKey } from "@yozexa/sdk";

const IDLE_LOCK_MS = 10 * 60 * 1000;

let unlockedKey: PrivateKey | null = null;
let unlockedAddress: string | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function unlock(key: PrivateKey): void {
  unlockedKey = key;
  unlockedAddress = key.address();
  resetIdleTimer();
  notify();
}

export function lock(): void {
  if (unlockedKey) {
    // Erase the scalar itself, in place. `toBytes()` returns a copy, so
    // zeroing that would leave the real key in memory until the garbage
    // collector happened to reach it — recoverable from a heap snapshot, which
    // is exactly what the idle lock exists to prevent.
    unlockedKey.destroy();
  }
  unlockedKey = null;
  unlockedAddress = null;
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = null;
  notify();
}

export function isUnlocked(): boolean {
  return unlockedKey !== null;
}

export function currentAddress(): string | null {
  return unlockedAddress;
}

/**
 * Borrow the unlocked key for one operation.
 *
 * Callers get the key only inside the callback, which keeps the window in
 * which a reference exists as small as the operation that needs it.
 */
export function withKey<T>(fn: (key: PrivateKey) => T): T {
  if (!unlockedKey) throw new Error("The wallet is locked.");
  resetIdleTimer();
  return fn(unlockedKey);
}

export function resetIdleTimer(): void {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(lock, IDLE_LOCK_MS);
}

export const IDLE_LOCK_MINUTES = IDLE_LOCK_MS / 60_000;
