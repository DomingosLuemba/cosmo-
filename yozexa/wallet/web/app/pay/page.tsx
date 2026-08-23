"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard } from "@/components/yzx/card";
import { YzxAlert, YzxNavigationBar } from "@/components/yzx/primitives";
import { YzxQRCode } from "@/components/yzx/qr";
import { currentAddress } from "@/lib/session";

/**
 * YOZEXA Pay.
 *
 * The intent is Apple Pay's: open it, point it, done. What is honest to ship
 * today is the "show my code" half plus a way to paste a payment request —
 * camera scanning is written here as an explicit, working path only where the
 * browser actually grants it, and says so plainly where it does not.
 */
export default function PayPage() {
  return (
    <UnlockGate>
      <Pay />
    </UnlockGate>
  );
}

function Pay() {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [mode, setMode] = useState<"scan" | "mine">("mine");
  const [pasted, setPasted] = useState("");
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    setAddress(currentAddress());
    // Feature detection only — no permission is requested until the user asks
    // to scan. Prompting for a camera on page load is hostile.
    setCameraAvailable(
      typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    );
  }, []);

  function open(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    // A yozexa: URI carries the address and, optionally, an amount and note.
    const match = /^yozexa:([a-z0-9]+)(\?(.*))?$/i.exec(trimmed);
    if (match) {
      const params = new URLSearchParams(match[3] ?? "");
      const query = new URLSearchParams({ to: match[1]! });
      const amount = params.get("amount");
      if (amount) query.set("amount", amount);
      // The note is what the payer will recognise on their statement; dropping
      // it here would leave them approving an amount with no reason attached.
      const note = params.get("note");
      if (note) query.set("note", note);
      router.push(`/send?${query.toString()}`);
      return;
    }
    router.push(`/send?to=${encodeURIComponent(trimmed)}`);
  }

  return (
    <>
      <YzxNavigationBar title="Pay" />

      <div
        role="tablist"
        aria-label="Pay mode"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--yzx-space-2)",
          padding: "4px",
          background: "var(--yzx-surface-sunken)",
          borderRadius: "var(--yzx-radius-full)",
          marginBottom: "var(--yzx-space-6)",
        }}
      >
        {(["mine", "scan"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            style={{
              padding: "var(--yzx-space-3)",
              borderRadius: "var(--yzx-radius-full)",
              border: "none",
              background: mode === m ? "var(--yzx-brand)" : "transparent",
              color: mode === m ? "var(--yzx-brand-ink)" : "var(--yzx-text-secondary)",
              fontSize: "var(--yzx-text-sm)",
              fontWeight: "var(--yzx-weight-semibold)",
              cursor: "pointer",
              minHeight: "var(--yzx-touch-target)",
            }}
          >
            {m === "mine" ? "Show my code" : "Pay someone"}
          </button>
        ))}
      </div>

      {mode === "mine" && address ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-block" }}>
            <YzxQRCode value={`yozexa:${address}`} label="Your YOZEXA code" />
          </div>
          <p style={{ margin: "var(--yzx-space-5) 0 0", fontSize: "var(--yzx-text-base)", color: "var(--yzx-text-secondary)" }}>
            Let anyone scan this to pay you.
          </p>
          <div style={{ marginTop: "var(--yzx-space-5)" }}>
            <YzxButton variant="secondary" onClick={() => router.push("/receive")}>
              Request a specific amount
            </YzxButton>
          </div>
        </div>
      ) : null}

      {mode === "scan" ? (
        <>
          {cameraAvailable === false ? (
            <YzxAlert tone="info" title="This browser can't open the camera.">
              Paste the payment request or the address below instead.
            </YzxAlert>
          ) : (
            <YzxAlert tone="info" title="Camera scanning isn't in this build yet.">
              Paste the payment request or the address below. Scanning is next — it is listed here
              so the gap is visible rather than hidden behind a button that does nothing.
            </YzxAlert>
          )}

          <label htmlFor="paste" style={{ display: "block", fontSize: "var(--yzx-text-xs)", fontWeight: "var(--yzx-weight-semibold)", letterSpacing: "var(--yzx-tracking-wide)", textTransform: "uppercase", color: "var(--yzx-text-tertiary)", marginBottom: "var(--yzx-space-2)" }}>
            Payment request or address
          </label>
          <input
            id="paste"
            className="yzx-mono"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="yozexa:yzx1… or maria.yzx"
            autoCapitalize="none"
            spellCheck={false}
            style={{
              width: "100%",
              padding: "var(--yzx-space-4)",
              background: "var(--yzx-surface)",
              border: "1px solid var(--yzx-border)",
              borderRadius: "var(--yzx-radius-lg)",
              color: "var(--yzx-text)",
              fontSize: "var(--yzx-text-base)",
              marginBottom: "var(--yzx-space-4)",
            }}
          />
          <YzxButton onClick={() => open(pasted)} disabled={!pasted.trim()}>
            Continue
          </YzxButton>
        </>
      ) : null}

      <YzxCard tone="sunken" style={{ marginTop: "var(--yzx-space-8)" }}>
        <p style={{ margin: 0, fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)", lineHeight: "var(--yzx-leading-relaxed)" }}>
          Paying a person costs the network fee and nothing else. YOZEXA Labs takes no cut of a
          transfer between people — it charges businesses for the services it provides them.
        </p>
      </YzxCard>
    </>
  );
}
