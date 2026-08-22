"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYZXA, messages, parseAmount, signTransaction } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { client } from "@/lib/node";
import { currentAddress, withKey } from "@/lib/session";

interface ValidatorRow {
  operator: string;
  moniker: string;
  tokens_yzxa: string;
  commission_bps: number;
  jailed: boolean;
  tombstoned: boolean;
  active: boolean;
  voting_power_bps: string;
}

export default function StakePage() {
  return (
    <UnlockGate>
      <Stake />
    </UnlockGate>
  );
}

function Stake() {
  const [validators, setValidators] = useState<ValidatorRow[]>([]);
  const [positions, setPositions] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const address = currentAddress();
    if (!address) return;
    try {
      const api = client();
      const [vs, ds] = await Promise.all([api.validators(), api.delegations(address)]);
      setValidators((vs.validators ?? []) as unknown as ValidatorRow[]);
      setPositions(ds.delegations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(kind: "delegate" | "undelegate" | "withdraw", operator: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const from = currentAddress();
      if (!from) throw new Error("The wallet is locked.");
      const api = client();
      const [status, account, feeMarket] = await Promise.all([
        api.status(),
        api.account(from),
        api.feeMarket(),
      ]);
      const price = feeMarket.tiers.find((t) => t.name === "normal");
      if (!price) throw new Error("The node did not offer a fee tier.");

      const msg =
        kind === "withdraw"
          ? messages.withdrawRewards(from, operator)
          : kind === "delegate"
            ? messages.delegate(from, operator, parseAmount(amount, "YZXA"))
            : messages.undelegate(from, operator, parseAmount(amount, "YZXA"));

      const tx = withKey((key) =>
        signTransaction(
          {
            chainId: status.chain_id,
            msgs: [msg],
            sequence: account.sequence,
            fee: { gasLimit: 400_000, gasPrice: BigInt(price.gas_price) },
          },
          key,
        ),
      );
      const result = await api.broadcast(tx, "commit");
      if (result.status === "failed") throw new Error(result.log || "The transaction failed.");
      setNotice(
        kind === "delegate"
          ? "Staked. Your stake is now bonded and at risk of slashing."
          : kind === "undelegate"
            ? "Unbonding started. The funds stay locked and slashable until the unbonding period ends."
            : "Rewards claimed.",
      );
      setAmount("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Earn by staking</h1>
      <p className="subtitle">Bond YZXA to a validator and share in its rewards.</p>

      <div className="alert warn">
        <strong>Staking is not a savings account.</strong> Bonded YZXA cannot be spent, takes 21
        days to unbond, and is slashed if your validator misbehaves — 5% and permanent removal for
        double signing. Rewards depend on emission, fee revenue and how much is bonded network-wide.
        No return is guaranteed to anyone.
      </div>

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert ok">{notice}</div> : null}

      {positions.length > 0 ? (
        <>
          <h2 style={{ fontSize: 15, marginTop: 24 }}>Your positions</h2>
          <div className="list" style={{ marginBottom: 20 }}>
            {positions.map((p, i) => {
              const row = p as Record<string, string | number | boolean>;
              return (
                <div className="list-item" key={i}>
                  <div>
                    <div className="title">{String(row.moniker || row.validator)}</div>
                    <div className="meta">
                      staked {String(row.staked_yzxa)} YZXA · rewards{" "}
                      {formatYZXA(BigInt(String(row.pending_rewards || "0")))}
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 12 }}>
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => void submit("withdraw", String(row.validator))}
                      >
                        Claim rewards
                      </button>
                      <button
                        className="ghost"
                        disabled={busy || !amount}
                        onClick={() => void submit("undelegate", String(row.validator))}
                      >
                        Unstake entered amount
                      </button>
                    </div>
                  </div>
                  <div>
                    {row.tombstoned ? (
                      <span className="pill danger">Tombstoned</span>
                    ) : row.jailed ? (
                      <span className="pill warn">Jailed</span>
                    ) : (
                      <span className="pill ok">Active</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="field">
        <label htmlFor="amount">Amount to stake or unstake (YZXA)</label>
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100"
        />
      </div>

      <h2 style={{ fontSize: 15 }}>Validators</h2>
      <div className="list">
        {validators.map((v) => (
          <div className="list-item" key={v.operator}>
            <div>
              <div className="title">{v.moniker || v.operator.slice(0, 16)}</div>
              <div className="meta">
                {v.tokens_yzxa} YZXA · {(v.commission_bps / 100).toFixed(1)}% commission ·{" "}
                {(Number(v.voting_power_bps) / 100).toFixed(2)}% power
              </div>
              {v.tombstoned ? (
                <div className="meta" style={{ color: "var(--danger)" }}>
                  removed permanently for double signing
                </div>
              ) : v.jailed ? (
                <div className="meta" style={{ color: "var(--warn)" }}>jailed for downtime</div>
              ) : null}
            </div>
            <button
              className="ghost"
              disabled={busy || v.jailed || v.tombstoned || !amount}
              onClick={() => {
                setSelected(v.operator);
                void submit("delegate", v.operator);
              }}
            >
              {busy && selected === v.operator ? "…" : "Stake"}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
