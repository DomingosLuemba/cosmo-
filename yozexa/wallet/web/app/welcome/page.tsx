"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { YzxButton } from "@/components/yzx/button";
import { YzxMark } from "@/components/yzx/logo";
import { activeEntry, loadVault } from "@/lib/vault";

export default function WelcomePage() {
  const router = useRouter();
  useEffect(() => {
    // Someone who already has a wallet should not land on onboarding.
    if (activeEntry(loadVault())) window.location.replace("/");
  }, []);

  return (
    <div
      style={{
        minHeight: "calc(100dvh - 80px)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        paddingBottom: "var(--yzx-space-10)",
      }}
    >
      <div className="yzx-rise" style={{ textAlign: "center", marginBottom: "var(--yzx-space-12)" }}>
        <YzxMark size={64} title="YOZEXA" />
        <h1
          style={{
            margin: "var(--yzx-space-6) 0 var(--yzx-space-2)",
            fontSize: "var(--yzx-text-2xl)",
            fontWeight: "var(--yzx-weight-bold)",
            letterSpacing: "var(--yzx-tracking-tight)",
            lineHeight: "var(--yzx-leading-tight)",
          }}
        >
          Welcome to
          <br />
          <span style={{ letterSpacing: "0.12em" }}>YOZEXA</span>
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--yzx-text-secondary)",
            fontSize: "var(--yzx-text-md)",
            lineHeight: "var(--yzx-leading-snug)",
          }}
        >
          Your money.
          <br />
          Your keys.
          <br />
          Your network.
        </p>
      </div>

      <div
        className="yzx-rise"
        style={{ display: "grid", gap: "var(--yzx-space-3)", animationDelay: "80ms" }}
      >
        <YzxButton onClick={() => router.push("/create")}>Create Wallet</YzxButton>
        <YzxButton variant="secondary" onClick={() => router.push("/import")}>
          Import Wallet
        </YzxButton>
        <a
          href="/explore"
          style={{
            textAlign: "center",
            padding: "var(--yzx-space-3)",
            fontSize: "var(--yzx-text-sm)",
            fontWeight: "var(--yzx-weight-medium)",
          }}
        >
          Explore YOZEXA
        </a>
      </div>

      <p
        style={{
          marginTop: "var(--yzx-space-8)",
          textAlign: "center",
          fontSize: "var(--yzx-text-xs)",
          color: "var(--yzx-text-tertiary)",
          lineHeight: "var(--yzx-leading-relaxed)",
        }}
      >
        Self-custody: your keys are created on this device and never leave it. Nobody can freeze
        this wallet, reverse a payment you make, or recover it for you.
      </p>
    </div>
  );
}
