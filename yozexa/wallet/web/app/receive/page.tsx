"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYZXA, parseAmount, type Unit } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard } from "@/components/yzx/card";
import { YzxAlert, YzxCopyButton, YzxNavigationBar, YzxSheet } from "@/components/yzx/primitives";
import { YzxQRCode } from "@/components/yzx/qr";
import { entryUnit } from "@/lib/display";
import { client } from "@/lib/node";
import { currentAddress } from "@/lib/session";

export default function ReceivePage() {
  return (
    <UnlockGate>
      <Receive />
    </UnlockGate>
  );
}

function Receive() {
  const [address, setAddress] = useState<string | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [amount, setAmount] = useState("");
  // Starts in whatever unit the balance is being shown in — see entryUnit.
  const [unit, setUnit] = useState<Exclude<Unit, "ayzxa">>("YZXA");
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  useEffect(() => {
    setUnit(entryUnit());
    const current = currentAddress();
    setAddress(current);
    if (current) {
      client()
        .account(current)
        .then((a) => setAlias(a.alias ?? null))
        .catch(() => setAlias(null));
    }
  }, []);

  /**
   * The payment request URI.
   *
   * It carries an address, an optional amount in base units, and a note the
   * user wrote. Nothing else — no identity, no device id, no tracking
   * parameter.
   */
  const request = useCallback((): string => {
    if (!address) return "";
    const params = new URLSearchParams();
    if (amount.trim()) {
      try {
        params.set("amount", parseAmount(amount, unit).toString());
      } catch {
        /* an unparseable amount degrades to a plain address request */
      }
    }
    if (note.trim()) params.set("note", note.trim());
    const query = params.toString();
    return `yozexa:${address}${query ? `?${query}` : ""}`;
  }, [address, amount, unit, note]);

  useEffect(() => {
    if (!amount.trim()) {
      setAmountError(null);
      return;
    }
    try {
      const parsed = parseAmount(amount, unit);
      setAmountError(parsed > 0n ? null : "Enter an amount greater than zero.");
    } catch {
      setAmountError("Enter a plain number.");
    }
  }, [amount, unit]);

  if (!address) return null;

  const uri = request();
  const hasAmount = amount.trim() !== "" && !amountError;

  return (
    <>
      <YzxNavigationBar title="Receive" back="/" />

      <div style={{ textAlign: "center", marginTop: "var(--yzx-space-4)" }}>
        <div style={{ display: "inline-block" }}>
          <YzxQRCode
            value={uri}
            label={hasAmount ? `Payment request for ${amount} ${unit}` : "Your YOZEXA address"}
          />
        </div>

        {alias ? (
          <p
            style={{
              margin: "var(--yzx-space-5) 0 var(--yzx-space-1)",
              fontSize: "var(--yzx-text-xl)",
              fontWeight: "var(--yzx-weight-semibold)",
              letterSpacing: "var(--yzx-tracking-tight)",
            }}
          >
            {alias}
          </p>
        ) : null}

        <p
          className="yzx-mono"
          style={{
            margin: alias ? "0 auto" : "var(--yzx-space-5) auto 0",
            maxWidth: "34ch",
            fontSize: "var(--yzx-text-xs)",
            color: "var(--yzx-text-secondary)",
            wordBreak: "break-all",
            lineHeight: "var(--yzx-leading-snug)",
          }}
        >
          {address}
        </p>

        {hasAmount ? (
          <p
            className="yzx-num"
            style={{
              margin: "var(--yzx-space-3) 0 0",
              fontSize: "var(--yzx-text-base)",
              color: "var(--yzx-brand-soft)",
              fontWeight: "var(--yzx-weight-semibold)",
            }}
          >
            Requesting {amount} {unit}
            {note ? ` · ${note}` : ""}
          </p>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--yzx-space-2)",
          margin: "var(--yzx-space-6) 0 var(--yzx-space-4)",
        }}
      >
        <SquareAction label="Copy">
          <YzxCopyButton value={uri} label="Copy address">
            <CopyGlyph />
          </YzxCopyButton>
        </SquareAction>
        <SquareAction label="Share">
          <button
            type="button"
            aria-label="Share address"
            onClick={async () => {
              if (navigator.share) {
                await navigator
                  .share({ title: "My YOZEXA address", text: alias ?? address, url: uri })
                  .catch(() => undefined);
              } else {
                await navigator.clipboard.writeText(uri).catch(() => undefined);
              }
            }}
            style={plainButton}
          >
            <ShareGlyph />
          </button>
        </SquareAction>
        <SquareAction label="Request">
          <button
            type="button"
            aria-label="Request a specific amount"
            onClick={() => setRequestOpen(true)}
            style={plainButton}
          >
            <RequestGlyph />
          </button>
        </SquareAction>
      </div>

      <YzxCard tone="sunken">
        <p style={{ margin: 0, fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)", lineHeight: "var(--yzx-leading-relaxed)" }}>
          Sharing this is safe. An address only says where to pay — it never lets anyone spend from
          this account. Its history is already public in the explorer.
        </p>
      </YzxCard>

      <YzxSheet open={requestOpen} onClose={() => setRequestOpen(false)} title="Request an amount">
        <label htmlFor="req-amount" style={sheetLabel}>
          Amount
        </label>
        <div style={{ display: "flex", gap: "var(--yzx-space-2)" }}>
          <input
            id="req-amount"
            className="yzx-num"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
            placeholder="50"
            style={{ ...sheetInput, flex: 1 }}
          />
          <label className="yzx-sr-only" htmlFor="req-unit">Unit</label>
          <select
            id="req-unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as Exclude<Unit, "ayzxa">)}
            style={{ ...sheetInput, width: "104px" }}
          >
            <option value="YOZ">YOZ</option>
            <option value="YZXA">YZXA</option>
          </select>
        </div>
        {amountError ? (
          <p style={{ margin: "var(--yzx-space-2) 0 0", color: "var(--yzx-negative)", fontSize: "var(--yzx-text-sm)" }}>
            {amountError}
          </p>
        ) : hasAmount ? (
          <p className="yzx-num" style={{ margin: "var(--yzx-space-2) 0 0", color: "var(--yzx-text-tertiary)", fontSize: "var(--yzx-text-xs)" }}>
            {formatYZXA(parseAmount(amount, unit))} YZXA
          </p>
        ) : null}

        <label htmlFor="req-note" style={{ ...sheetLabel, marginTop: "var(--yzx-space-5)" }}>
          What for (optional)
        </label>
        <input
          id="req-note"
          value={note}
          maxLength={120}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Dinner"
          style={sheetInput}
        />
        <p style={{ margin: "var(--yzx-space-2) 0 var(--yzx-space-5)", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-tertiary)" }}>
          The payer sees this. Keep personal information out of it.
        </p>

        <YzxButton onClick={() => setRequestOpen(false)} disabled={Boolean(amountError)}>
          Update request
        </YzxButton>
      </YzxSheet>
    </>
  );
}

function SquareAction({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--yzx-space-1)",
        padding: "var(--yzx-space-4) var(--yzx-space-2)",
        background: "var(--yzx-surface)",
        border: "1px solid var(--yzx-border)",
        borderRadius: "var(--yzx-radius-lg)",
        minHeight: "var(--yzx-touch-target)",
      }}
    >
      <span style={{ color: "var(--yzx-brand-soft)", lineHeight: 0 }}>{children}</span>
      <span style={{ fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-secondary)", fontWeight: "var(--yzx-weight-medium)" }}>
        {label}
      </span>
    </div>
  );
}

const plainButton: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "inherit",
  lineHeight: 0,
};

const sheetLabel: React.CSSProperties = {
  display: "block",
  fontSize: "var(--yzx-text-xs)",
  fontWeight: "var(--yzx-weight-semibold)",
  letterSpacing: "var(--yzx-tracking-wide)",
  textTransform: "uppercase",
  color: "var(--yzx-text-tertiary)",
  marginBottom: "var(--yzx-space-2)",
};

const sheetInput: React.CSSProperties = {
  width: "100%",
  padding: "var(--yzx-space-3) var(--yzx-space-4)",
  background: "var(--yzx-surface-sunken)",
  border: "1px solid var(--yzx-border)",
  borderRadius: "var(--yzx-radius-md)",
  color: "var(--yzx-text)",
  fontSize: "var(--yzx-text-md)",
};

function CopyGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="6.5" y="6.5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.5 6.5v-2a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ShareGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12v3.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function RequestGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.5v7M7.5 9h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
