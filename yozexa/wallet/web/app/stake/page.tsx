"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYZXA, messages, signTransaction } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxAmountInput } from "@/components/yzx/amount-input";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard, YzxSectionHeader } from "@/components/yzx/card";
import { YzxAlert, YzxAvatar, YzxNavigationBar, YzxSkeleton } from "@/components/yzx/primitives";
import { entryUnit } from "@/lib/display";
import { humanize, type HumanError } from "@/lib/errors";
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
  const [validators, setValidators] = useState<ValidatorRow[] | null>(null);
  const [positions, setPositions] = useState<Array<Record<string, unknown>>>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  // Starts in whatever unit the balance is being shown in — see entryUnit.
  const [unit, setUnit] = useState<"YZXA" | "YOZ">("YZXA");
  const [baseUnits, setBaseUnits] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HumanError | null>(null);
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
      setError(humanize(err));
      setValidators([]);
    }
  }, []);

  useEffect(() => {
    setUnit(entryUnit());
    void load();
  }, [load]);

  async function submit(kind: "delegate" | "undelegate" | "withdraw", operator: string) {
    setBusy(true);
    setPending(operator);
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

      // The amount input has already validated and converted; re-parsing the
      // string here could disagree with the figure the user is looking at.
      const units = baseUnits;
      if (kind !== "withdraw" && (units === null || units <= 0n)) {
        throw new Error("Enter an amount first.");
      }
      const msg =
        kind === "withdraw"
          ? messages.withdrawRewards(from, operator)
          : kind === "delegate"
            ? messages.delegate(from, operator, units!)
            : messages.undelegate(from, operator, units!);

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
          ? "Staked. Your stake is bonded now, earning rewards and exposed to slashing."
          : kind === "undelegate"
            ? "Unbonding started. The funds stay locked and still slashable until it completes."
            : "Rewards claimed. They are in your spendable balance.",
      );
      setAmount("");
      setBaseUnits(null);
      await load();
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const canAct = baseUnits !== null && baseUnits > 0n && !busy;

  return (
    <>
      <YzxNavigationBar title="Earn" back="/" />

      <h1
        style={{
          margin: "0 0 var(--yzx-space-2)",
          fontSize: "var(--yzx-text-2xl)",
          letterSpacing: "var(--yzx-tracking-tight)",
        }}
      >
        Earn by staking
      </h1>
      <p
        style={{
          margin: "0 0 var(--yzx-space-5)",
          color: "var(--yzx-text-secondary)",
          fontSize: "var(--yzx-text-base)",
          lineHeight: "var(--yzx-leading-relaxed)",
        }}
      >
        Bond YZXA to a validator and share what it earns.
      </p>

      <YzxAlert tone="warning" title="Staking is not a savings account.">
        Bonded YZXA cannot be spent, takes 21 days to unbond, and is slashed if your validator
        misbehaves — 5% and permanent removal for double signing. What you earn depends on
        emission, fee revenue and how much of the network is bonded. No return is promised to
        anyone, and none is guaranteed.
      </YzxAlert>

      {error ? (
        <YzxAlert tone="danger" title={error.message}>
          {error.action}
        </YzxAlert>
      ) : null}
      {notice ? <YzxAlert tone="success" title={notice} /> : null}

      {positions.length > 0 ? (
        <>
          <YzxSectionHeader title="Your positions" />
          <div style={{ display: "grid", gap: "var(--yzx-space-3)", marginBottom: "var(--yzx-space-6)" }}>
            {positions.map((p, i) => {
              const row = p as Record<string, string | number | boolean>;
              const operator = String(row.validator);
              const rewards = BigInt(String(row.pending_rewards || "0"));
              return (
                <YzxCard key={i}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--yzx-space-3)" }}>
                    <YzxAvatar seed={operator} label={String(row.moniker || operator)} size={38} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: "var(--yzx-weight-semibold)", fontSize: "var(--yzx-text-base)" }}>
                        {String(row.moniker || operator.slice(0, 16))}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-secondary)" }}>
                        {String(row.staked_yzxa)} YZXA staked
                      </p>
                    </div>
                    <ValidatorState jailed={Boolean(row.jailed)} tombstoned={Boolean(row.tombstoned)} />
                  </div>

                  <p
                    style={{
                      margin: "var(--yzx-space-3) 0 0",
                      fontSize: "var(--yzx-text-sm)",
                      color: "var(--yzx-text-secondary)",
                    }}
                  >
                    Unclaimed rewards:{" "}
                    <span className="yzx-mono" style={{ color: "var(--yzx-text)" }}>
                      {formatYZXA(rewards)} YZXA
                    </span>
                  </p>

                  <div style={{ display: "grid", gap: "var(--yzx-space-2)", marginTop: "var(--yzx-space-4)" }}>
                    <YzxButton
                      variant="secondary"
                      size="md"
                      busy={busy && pending === operator}
                      disabled={busy || rewards === 0n}
                      onClick={() => void submit("withdraw", operator)}
                    >
                      {rewards === 0n ? "No rewards to claim yet" : "Claim rewards"}
                    </YzxButton>
                    <YzxButton
                      variant="ghost"
                      size="md"
                      disabled={!canAct}
                      onClick={() => void submit("undelegate", operator)}
                    >
                      {canAct ? `Unstake ${amount} ${unit}` : "Enter an amount to unstake"}
                    </YzxButton>
                  </div>
                </YzxCard>
              );
            })}
          </div>
        </>
      ) : null}

      <YzxSectionHeader title="Amount" />
      <div style={{ marginBottom: "var(--yzx-space-6)" }}>
        <YzxAmountInput
          value={amount}
          unit={unit}
          onValueChange={setAmount}
          onUnitChange={setUnit}
          onValidChange={setBaseUnits}
        />
      </div>

      <YzxSectionHeader title="Validators" />
      <div style={{ display: "grid", gap: "var(--yzx-space-3)" }}>
        {validators === null
          ? [0, 1, 2].map((i) => <YzxSkeleton key={i} height={84} radius="var(--yzx-radius-lg)" />)
          : validators.map((v) => {
              const unavailable = v.jailed || v.tombstoned;
              return (
                <YzxCard key={v.operator}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--yzx-space-3)" }}>
                    <YzxAvatar seed={v.operator} label={v.moniker || v.operator} size={38} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: "var(--yzx-weight-semibold)", fontSize: "var(--yzx-text-base)" }}>
                        {v.moniker || v.operator.slice(0, 16)}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-secondary)" }}>
                        {v.tokens_yzxa} YZXA · {(v.commission_bps / 100).toFixed(1)}% commission ·{" "}
                        {(Number(v.voting_power_bps) / 100).toFixed(2)}% of voting power
                      </p>
                    </div>
                    <ValidatorState jailed={v.jailed} tombstoned={v.tombstoned} />
                  </div>

                  {unavailable ? (
                    <p
                      style={{
                        margin: "var(--yzx-space-3) 0 0",
                        fontSize: "var(--yzx-text-xs)",
                        color: "var(--yzx-text-secondary)",
                        lineHeight: "var(--yzx-leading-relaxed)",
                      }}
                    >
                      {v.tombstoned
                        ? "Removed permanently for double signing. Stake here cannot be delegated."
                        : "Jailed for missing blocks. It earns nothing while jailed."}
                    </p>
                  ) : (
                    <div style={{ marginTop: "var(--yzx-space-4)" }}>
                      <YzxButton
                        variant="secondary"
                        size="md"
                        busy={busy && pending === v.operator}
                        disabled={!canAct}
                        onClick={() => void submit("delegate", v.operator)}
                      >
                        {canAct ? `Stake ${amount} ${unit}` : "Enter an amount above"}
                      </YzxButton>
                    </div>
                  )}
                </YzxCard>
              );
            })}
        {validators !== null && validators.length === 0 ? (
          <YzxCard tone="sunken">
            <p style={{ margin: 0, color: "var(--yzx-text-secondary)", fontSize: "var(--yzx-text-sm)" }}>
              This node reports no validators. That is a network or connection problem, not an
              empty set — nothing is staked or at risk because of it.
            </p>
          </YzxCard>
        ) : null}
      </div>
    </>
  );
}

/**
 * A validator's standing.
 *
 * Word first, then colour: the state has to survive a greyscale screen and a
 * reader who cannot distinguish the tints.
 */
function ValidatorState({ jailed, tombstoned }: { jailed: boolean; tombstoned: boolean }) {
  const [label, tone] = tombstoned
    ? ["Removed", "var(--yzx-negative)"]
    : jailed
      ? ["Jailed", "var(--yzx-warning)"]
      : ["Active", "var(--yzx-text-secondary)"];
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: "var(--yzx-text-2xs)",
        fontWeight: "var(--yzx-weight-semibold)",
        letterSpacing: "var(--yzx-tracking-wide)",
        textTransform: "uppercase",
        color: tone,
        border: `1px solid ${tone}`,
        borderRadius: "var(--yzx-radius-full)",
        padding: "3px var(--yzx-space-2)",
      }}
    >
      {label}
    </span>
  );
}
