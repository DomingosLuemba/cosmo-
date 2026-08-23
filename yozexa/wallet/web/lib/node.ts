"use client";

/**
 * The node the wallet talks to.
 *
 * The wallet is self-custody: it signs locally and submits already-signed
 * bytes. Which node it submits through is the user's choice, stored locally,
 * and changing it cannot expose a key — the node never sees one.
 */
import { YozexaClient } from "@yozexa/sdk";

const STORAGE_KEY = "yozexa.node.v1";
const DEFAULT_NODE = "http://127.0.0.1:1717";

export function nodeUrl(): string {
  if (typeof window === "undefined") return DEFAULT_NODE;
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_NODE;
}

export function setNodeUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error("The node address must start with http:// or https://");
  }
  window.localStorage.setItem(STORAGE_KEY, trimmed);
}

export function client(): YozexaClient {
  return new YozexaClient({ url: nodeUrl(), timeoutMs: 20_000 });
}
