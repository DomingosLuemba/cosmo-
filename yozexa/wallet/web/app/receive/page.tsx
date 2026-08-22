"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatYZXA, parseAmount, type Unit } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
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
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<Unit>("YOZ");
  const [note, setNote] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAddress(currentAddress());
  }, []);

  // The payment request is a URI the payer's wallet can parse. It carries no
  // personal information — just an address, an optional amount and a note the
  // user chose.
  const requestUri = (() => {
    if (!address) return "";
    const params = new URLSearchParams();
    if (amount.trim()) {
      try {
        params.set("amount", parseAmount(amount, unit).toString());
      } catch {
        /* an unparseable amount simply produces a plain address request */
      }
    }
    if (note.trim()) params.set("note", note.trim());
    const query = params.toString();
    return `yozexa:${address}${query ? `?${query}` : ""}`;
  })();

  useEffect(() => {
    if (!requestUri) return;
    let cancelled = false;
    // Generated locally: the address never goes to a QR service.
    QRCode.toString(requestUri, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
      .then((svg) => {
        if (!cancelled) setQr(svg);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [requestUri]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2_000);
    } catch {
      setError("Could not copy — select the text and copy it manually.");
    }
  }

  if (!address) return null;

  let parsedAmount: bigint | null = null;
  try {
    parsedAmount = amount.trim() ? parseAmount(amount, unit) : null;
  } catch {
    parsedAmount = null;
  }

  return (
    <>
      <h1>Receive</h1>
      <p className="subtitle">Share this address, or a request for a specific amount.</p>
      {error ? <div className="alert danger">{error}</div> : null}

      <div className="center" style={{ marginBottom: 20 }}>
        {qr ? (
          <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
        ) : (
          <div className="dim">Generating QR…</div>
        )}
      </div>

      <div className="card">
        <div className="hint">Your address</div>
        <p className="mono break" style={{ fontSize: 13, marginBottom: 10 }}>{address}</p>
        <button className="secondary" onClick={() => void copy(address, "address")}>
          {copied === "address" ? "Copied" : "Copy address"}
        </button>
      </div>

      <div className="card">
        <h2>Request a specific amount</h2>
        <div className="field">
          <label htmlFor="amount">Amount (optional)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25"
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
              style={{ width: 110 }}
              aria-label="Unit"
            >
              <option value="YOZ">YOZ</option>
              <option value="YZXA">YZXA</option>
            </select>
          </div>
          {parsedAmount !== null ? (
            <div className="hint">{formatYZXA(parsedAmount)} YZXA</div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="note">Note (optional)</label>
          <input
            id="note"
            value={note}
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Invoice 1042"
          />
          <div className="hint">
            The payer sees this. Do not put personal information in it.
          </div>
        </div>
        <button className="secondary" onClick={() => void copy(requestUri, "link")}>
          {copied === "link" ? "Copied" : "Copy payment request"}
        </button>
      </div>

      <p className="hint center">
        Sharing an address is safe: it reveals only where to pay, and anyone can already see this
        account&rsquo;s history on the explorer. It never lets anyone spend from it.
      </p>
    </>
  );
}
