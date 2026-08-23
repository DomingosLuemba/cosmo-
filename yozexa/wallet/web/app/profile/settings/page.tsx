"use client";

import { useEffect, useState } from "react";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard } from "@/components/yzx/card";
import { YzxAlert, YzxNavigationBar } from "@/components/yzx/primitives";
import { client, nodeUrl, setNodeUrl } from "@/lib/node";
import {
  displayCurrency,
  FIAT_CURRENCIES,
  priceSourceUrl,
  setDisplayCurrency,
  setPriceSourceUrl,
  type FiatCurrency,
} from "@/lib/price";
import { humanize } from "@/lib/errors";

export default function SettingsPage() {
  return (
    <UnlockGate>
      <Settings />
    </UnlockGate>
  );
}

function Settings() {
  const [node, setNode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [currency, setCurrency] = useState<FiatCurrency>("USD");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setNode(nodeUrl());
    setSource(priceSourceUrl() ?? "");
    setCurrency(displayCurrency());
    client()
      .status()
      .then((s) => setStatus(`${s.chain_id} · height ${s.height.toLocaleString()}`))
      .catch((err: unknown) => setStatus(humanize(err).message));
  }, []);

  return (
    <>
      <YzxNavigationBar title="Settings" back="/profile" />

      {error ? <YzxAlert tone="danger">{error}</YzxAlert> : null}
      {saved ? <YzxAlert tone="success">{saved}</YzxAlert> : null}

      <YzxCard style={{ marginBottom: "var(--yzx-space-4)" }}>
        <h2 style={{ margin: "0 0 var(--yzx-space-2)", fontSize: "var(--yzx-text-base)" }}>Network</h2>
        {status ? (
          <p style={{ margin: "0 0 var(--yzx-space-3)", fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)" }}>
            {status}
          </p>
        ) : null}
        <label htmlFor="node" style={fieldLabel}>Node API address</label>
        <input
          id="node"
          className="yzx-mono"
          value={node}
          onChange={(event) => setNode(event.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          style={fieldInput}
        />
        <p style={fieldHint}>
          You choose which node this wallet reads from and submits through. A node never sees your
          key — it only receives transactions you have already signed.
        </p>
        <YzxButton
          variant="secondary"
          onClick={() => {
            setError(null);
            try {
              setNodeUrl(node);
              window.location.reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Save node
        </YzxButton>
      </YzxCard>

      <YzxCard style={{ marginBottom: "var(--yzx-space-4)" }}>
        <h2 style={{ margin: "0 0 var(--yzx-space-2)", fontSize: "var(--yzx-text-base)" }}>Currency</h2>
        <label htmlFor="currency" style={fieldLabel}>Display currency</label>
        <select
          id="currency"
          value={currency}
          onChange={(event) => {
            const next = event.target.value as FiatCurrency;
            setCurrency(next);
            setDisplayCurrency(next);
            setSaved(`Display currency set to ${next}.`);
          }}
          style={fieldInput}
        >
          {FIAT_CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <label htmlFor="source" style={{ ...fieldLabel, marginTop: "var(--yzx-space-4)" }}>
          Price source (optional)
        </label>
        <input
          id="source"
          className="yzx-mono"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="https://…"
          autoCapitalize="none"
          spellCheck={false}
          style={fieldInput}
        />
        <p style={fieldHint}>
          YZXA has no price until a market sets one. With no source configured the wallet shows
          amounts in YZXA and YOZ only — it will not invent a fiat figure.
        </p>
        <YzxButton
          variant="secondary"
          onClick={() => {
            setError(null);
            try {
              setPriceSourceUrl(source.trim() || null);
              setSaved(source.trim() ? "Price source saved." : "Price source removed.");
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Save price source
        </YzxButton>
      </YzxCard>

      <YzxCard tone="sunken">
        <h2 style={{ margin: "0 0 var(--yzx-space-2)", fontSize: "var(--yzx-text-base)" }}>Appearance</h2>
        <p style={{ margin: 0, fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)", lineHeight: "var(--yzx-leading-relaxed)" }}>
          The wallet follows your system&rsquo;s light or dark setting, your text size, your
          contrast preference and your reduced-motion preference. There is nothing to configure
          here — the settings you already made apply.
        </p>
      </YzxCard>
    </>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "var(--yzx-text-xs)",
  fontWeight: "var(--yzx-weight-semibold)",
  letterSpacing: "var(--yzx-tracking-wide)",
  textTransform: "uppercase",
  color: "var(--yzx-text-tertiary)",
  marginBottom: "var(--yzx-space-2)",
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "var(--yzx-space-3) var(--yzx-space-4)",
  background: "var(--yzx-surface-sunken)",
  border: "1px solid var(--yzx-border)",
  borderRadius: "var(--yzx-radius-md)",
  color: "var(--yzx-text)",
  fontSize: "var(--yzx-text-base)",
};

const fieldHint: React.CSSProperties = {
  margin: "var(--yzx-space-2) 0 var(--yzx-space-4)",
  fontSize: "var(--yzx-text-xs)",
  color: "var(--yzx-text-tertiary)",
  lineHeight: "var(--yzx-leading-relaxed)",
};
