"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYZXA, formatYOZ, formatForDisplay, type AccountView } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { client } from "@/lib/node";
import { currentAddress, lock } from "@/lib/session";

export default function HomePage() {
  return (
    <>
      <header className="app">
        <span className="logo">
          YOZEXA <span>Wallet</span>
        </span>
        <span className="spacer" />
        <button className="ghost" onClick={() => lock()}>
          Lock
        </button>
      </header>
      <UnlockGate>
        <Home />
      </UnlockGate>
    </>
  );
}

function Home() {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const address = currentAddress();
    if (!address) return;
    try {
      setAccount(await client().account(address));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 6_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const balance = account ? BigInt(account.balance) : 0n;
  const locked = account ? BigInt(account.locked) : 0n;
  const spendable = account ? BigInt(account.spendable) : 0n;
  const display = formatForDisplay(spendable);

  return (
    <>
      <div className="balance-card">
        <div className="balance-label">Total balance</div>
        <div className="balance-amount">{formatYZXA(balance)}</div>
        <div className="balance-sub">YZXA · {formatYOZ(balance)} YOZ</div>
        {locked > 0n ? (
          <div className="balance-locked">
            {formatYZXA(locked)} YZXA locked by vesting · {display.amount} {display.unit} spendable
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="alert danger">
          Cannot reach the node: {error}
          <div style={{ marginTop: 8 }}>
            <a href="/settings" style={{ color: "inherit", textDecoration: "underline" }}>
              Change the node
            </a>
          </div>
        </div>
      ) : null}

      <div className="actions">
        <a className="action" href="/send">
          <span className="glyph" aria-hidden="true">↑</span>
          Send
        </a>
        <a className="action" href="/receive">
          <span className="glyph" aria-hidden="true">↓</span>
          Receive
        </a>
        <a className="action" href="/stake">
          <span className="glyph" aria-hidden="true">▲</span>
          Earn
        </a>
        <a className="action" href="/activity">
          <span className="glyph" aria-hidden="true">≡</span>
          Activity
        </a>
      </div>

      {/*
        Buy, Sell and Swap are deliberately shown as unavailable rather than as
        buttons that lead nowhere. A control that looks live and does nothing is
        worse than one that says why it is off.
      */}
      <div className="actions">
        <span className="action" aria-disabled="true" title="Requires a licensed fiat partner">
          <span className="glyph" aria-hidden="true">＋</span>
          Buy
        </span>
        <span className="action" aria-disabled="true" title="Requires a licensed fiat partner">
          <span className="glyph" aria-hidden="true">－</span>
          Sell
        </span>
        <span className="action" aria-disabled="true" title="Requires the YOZEXA DEX, which is not built">
          <span className="glyph" aria-hidden="true">⇄</span>
          Swap
        </span>
        <a className="action" href="/permissions">
          <span className="glyph" aria-hidden="true">⚿</span>
          Access
        </a>
      </div>

      {account ? (
        <div className="card">
          <h2>This account</h2>
          {account.alias ? (
            <p>
              <strong>{account.alias}</strong>
            </p>
          ) : null}
          <p className="mono break dim" style={{ fontSize: 13 }}>{account.address}</p>
          {account.vesting ? (
            <div className="alert warn" style={{ marginTop: 12, marginBottom: 0 }}>
              <strong>Vesting position.</strong> {formatYZXA(BigInt(account.vesting.locked))} YZXA of
              your {formatYZXA(BigInt(account.vesting.total))} YZXA allocation is still locked. The
              protocol will not move it, even with your key — the schedule ends{" "}
              {new Date(account.vesting.end_unix * 1000).toISOString().slice(0, 10)}.
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="hint center">
        Buy and Sell need a licensed fiat partner in your jurisdiction. Swap needs the YOZEXA DEX,
        which does not exist yet. They are shown here so the roadmap is visible, not to imply they
        work.
      </p>
    </>
  );
}
