import { decodeAddress, isAliasSyntax, isValidAddress } from "./address.js";
import type { PrivateKey } from "./keys.js";
import type { Msg } from "./messages.js";
import {
  encodeTransaction,
  signTransaction,
  transactionHash,
  type Fee,
  type SignedTx,
} from "./transaction.js";

/** The finality states a payment can be in. */
export type TxStatus = "pending" | "confirmed" | "finalized" | "failed" | "unknown";

export interface NodeStatus {
  chain_id: string;
  height: number;
  node_version: string;
  latest_block_time?: string;
  catching_up?: boolean;
  /** Present and non-empty on every network that is not mainnet. */
  network_warning?: string;
  supply?: Record<string, string | number>;
}

export interface AccountView {
  address: string;
  alias?: string;
  balance: string;
  spendable: string;
  locked: string;
  sequence: number;
  balance_yzxa: string;
  balance_yoz: string;
  vesting?: {
    category: string;
    total: string;
    vested: string;
    locked: string;
    cliff_unix: number;
    end_unix: number;
  };
}

export interface FeeTier {
  name: "economy" | "normal" | "priority";
  gas_price: string;
  description: string;
}

export interface Simulation {
  valid: boolean;
  error?: string;
  signer: string;
  gas_required: number;
  gas_limit: number;
  base_fee: string;
  gas_price: string;
  max_fee: string;
  max_fee_yzxa: string;
  estimated_fee: string;
  estimated_fee_yzxa: string;
  signer_balance: string;
  signer_spendable: string;
  effects: Array<{
    kind: string;
    description: string;
    from?: string;
    to?: string;
    amount?: string;
    amount_yzxa?: string;
    amount_yoz?: string;
  }>;
  warnings?: string[];
}

export interface BroadcastResult {
  hash: string;
  status: TxStatus;
  code: number;
  log?: string;
  height?: number;
}

export interface TxStatusResult {
  hash: string;
  status: TxStatus;
  code: number;
  log?: string;
  height?: number;
  confirmations: number;
  /** A sentence stating what the status actually means for settlement. */
  explanation: string;
  gas_used?: number;
}

export class YozexaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "YozexaError";
  }
}

export interface ClientOptions {
  /** Node API base URL, e.g. "http://127.0.0.1:1717". */
  url: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * A client for the YOZEXA node HTTP API.
 *
 * The client never sees a private key. Signing happens locally in
 * `signTransaction`; this class only reads state and submits already-signed
 * bytes.
 */
export class YozexaClient {
  readonly #url: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: ClientOptions | string) {
    const opts = typeof options === "string" ? { url: options } : options;
    let url = opts.url;
    if (!/^https?:\/\//.test(url)) url = `http://${url}`;
    this.#url = url.replace(/\/+$/, "");
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#url}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new YozexaError(`node returned a non-JSON response: ${text.slice(0, 200)}`, response.status);
      }
      if (!response.ok) {
        const record = body as { error?: string; log?: string };
        throw new YozexaError(record.error ?? record.log ?? `node returned ${response.status}`, response.status);
      }
      return body as T;
    } catch (err) {
      if (err instanceof YozexaError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new YozexaError(`request to ${this.#url}${path} timed out`);
      }
      throw new YozexaError(`cannot reach the YOZEXA node at ${this.#url}: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  status(): Promise<NodeStatus> {
    return this.#request<NodeStatus>("/v1/status");
  }

  account(address: string): Promise<AccountView> {
    return this.#request<AccountView>(`/v1/account/${encodeURIComponent(address)}`);
  }

  supply(): Promise<Record<string, string | number>> {
    return this.#request("/v1/supply");
  }

  verifySupply(): Promise<Record<string, unknown>> {
    return this.#request("/v1/supply/verify");
  }

  feeMarket(): Promise<{ base_fee: string; tiers: FeeTier[] }> {
    return this.#request("/v1/feemarket");
  }

  validators(): Promise<{ validators: Array<Record<string, unknown>>; total_bonded: string }> {
    return this.#request("/v1/validators");
  }

  validator(operator: string): Promise<Record<string, unknown>> {
    return this.#request(`/v1/validator/${encodeURIComponent(operator)}`);
  }

  proposals(): Promise<{ proposals: Array<Record<string, unknown>> }> {
    return this.#request("/v1/proposals");
  }

  proposal(id: number | string): Promise<Record<string, unknown>> {
    return this.#request(`/v1/proposal/${encodeURIComponent(String(id))}`);
  }

  emission(): Promise<Record<string, string | number>> {
    return this.#request("/v1/emission");
  }

  params(): Promise<Record<string, unknown>> {
    return this.#request("/v1/params");
  }

  unbonding(address: string): Promise<{ unbonding: Array<Record<string, unknown>> }> {
    return this.#request(`/v1/unbonding/${encodeURIComponent(address)}`);
  }

  delegations(address: string): Promise<{ delegations: Array<Record<string, unknown>> }> {
    return this.#request(`/v1/delegations/${encodeURIComponent(address)}`);
  }

  grants(granter: string): Promise<{ grants: Array<Record<string, unknown>> }> {
    return this.#request(`/v1/grants/${encodeURIComponent(granter)}`);
  }

  vesting(): Promise<{ vesting: Array<Record<string, unknown>> }> {
    return this.#request("/v1/vesting");
  }

  blocks(limit = 20): Promise<{ blocks: Array<Record<string, unknown>>; latest_height: number }> {
    return this.#request(`/v1/blocks?limit=${limit}`);
  }

  block(height: number): Promise<Record<string, unknown>> {
    return this.#request(`/v1/block/${height}`);
  }

  invariants(): Promise<{ ok: boolean; results: Array<{ name: string; ok: boolean; message?: string }> }> {
    return this.#request("/v1/invariants");
  }

  /** Ask the node what a transaction would do, before anyone signs off on it. */
  simulate(tx: SignedTx): Promise<Simulation> {
    return this.#request<Simulation>("/v1/simulate", {
      method: "POST",
      body: `{"tx":${encodeTransaction(tx)}}`,
    });
  }

  /**
   * Submit a signed transaction.
   *
   * `mode: "sync"` returns once the mempool accepts it — which is **not**
   * settlement. `mode: "commit"` waits for inclusion in a committed block.
   */
  broadcast(tx: SignedTx, mode: "sync" | "commit" = "sync"): Promise<BroadcastResult> {
    return this.#request<BroadcastResult>("/v1/tx", {
      method: "POST",
      body: `{"tx":${encodeTransaction(tx)},"mode":${JSON.stringify(mode)}}`,
    });
  }

  txStatus(hash: string): Promise<TxStatusResult> {
    return this.#request<TxStatusResult>(`/v1/tx/${encodeURIComponent(hash)}`);
  }

  /**
   * Resolve an address or a YOZEXA ID to an address.
   *
   * Always call this before showing a confirmation screen, so the destination
   * the user sees is the one the chain will actually credit.
   */
  async resolveRecipient(input: string): Promise<string> {
    const value = input.trim();
    if (isValidAddress(value)) {
      decodeAddress(value); // re-validate the checksum
      return value;
    }
    if (!isAliasSyntax(value)) {
      throw new YozexaError(
        `${JSON.stringify(input)} is neither a valid YOZEXA address nor a well-formed YOZEXA ID`,
      );
    }
    const alias = await this.#request<{ name: string; owner: string }>(
      `/v1/alias/${encodeURIComponent(value)}`,
    );
    return alias.owner;
  }

  /**
   * Build, sign and submit a transaction.
   *
   * The account's sequence and the live fee market are read immediately before
   * signing, so a wallet cannot accidentally sign a stale transaction.
   */
  async signAndBroadcast(
    key: PrivateKey,
    msgs: Msg[],
    options: {
      feeTier?: "economy" | "normal" | "priority";
      gasLimit?: number;
      memo?: string;
      mode?: "sync" | "commit";
      chainId?: string;
      timeoutHeight?: number;
    } = {},
  ): Promise<BroadcastResult & { tx: SignedTx }> {
    const [status, account, feeMarket] = await Promise.all([
      options.chainId ? Promise.resolve(null) : this.status(),
      this.account(key.address()),
      this.feeMarket(),
    ]);
    const chainId = options.chainId ?? status?.chain_id;
    if (!chainId) throw new YozexaError("could not determine the chain id");

    const tierName = options.feeTier ?? "normal";
    const tier = feeMarket.tiers.find((t) => t.name === tierName);
    if (!tier) throw new YozexaError(`the node does not offer a ${tierName} fee tier`);

    const fee: Fee = { gasLimit: options.gasLimit ?? 300_000, gasPrice: BigInt(tier.gas_price) };
    const tx = signTransaction(
      {
        chainId,
        msgs,
        sequence: account.sequence,
        fee,
        ...(options.memo ? { memo: options.memo } : {}),
        ...(options.timeoutHeight ? { timeoutHeight: options.timeoutHeight } : {}),
      },
      key,
    );
    const result = await this.broadcast(tx, options.mode ?? "commit");
    return { ...result, tx };
  }

  /**
   * Wait for a transaction to reach a settled state.
   *
   * Resolves on `confirmed`, `finalized` or `failed`. It does not resolve on
   * `pending`, because a pending transaction is not a payment.
   */
  async waitForSettlement(
    hash: string,
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<TxStatusResult> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const pollMs = options.pollMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      try {
        const result = await this.txStatus(hash);
        if (result.status === "confirmed" || result.status === "finalized" || result.status === "failed") {
          return result;
        }
      } catch (err) {
        if (!(err instanceof YozexaError) || err.status !== 404) throw err;
      }
      if (Date.now() >= deadline) {
        throw new YozexaError(
          `transaction ${hash} did not settle within ${timeoutMs}ms; it may still be pending`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export { transactionHash };
