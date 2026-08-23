import { YzxCard } from "@/components/yzx/card";
import { YzxNavigationBar } from "@/components/yzx/primitives";

export const metadata = { title: "About YZXA · YOZEXA Wallet" };

export default function AboutPage() {
  return (
    <>
      <YzxNavigationBar title="About YZXA" back="/explore" />

      <div style={{ display: "grid", gap: "var(--yzx-space-4)" }}>
        <YzxCard>
          <h2 style={heading}>A fixed supply</h2>
          <p style={body}>
            There will only ever be 10,000,000 YZXA. That number is a constant in the protocol,
            not a policy — no vote, no upgrade and no administrator can raise it, and every node
            re-checks it at the end of every block.
          </p>
        </YzxCard>

        <YzxCard>
          <h2 style={heading}>YZXA and YOZ</h2>
          <p style={body}>
            One YZXA divides into 100,000 YOZ. Small amounts read better in YOZ — 25 YOZ instead of
            0.00025 YZXA — so the wallet lets you switch between them by tapping your balance. It
            is the same money either way.
          </p>
        </YzxCard>

        <YzxCard>
          <h2 style={heading}>What it is worth</h2>
          <p style={body}>
            Nothing in this wallet tells you what a YZXA is worth, because nothing can. There is no
            fixed rate and no guarantee. If a fiat figure appears, it comes from a market source
            you configured, and it is a reference at that moment — not a promise.
          </p>
        </YzxCard>

        <YzxCard>
          <h2 style={heading}>Your keys</h2>
          <p style={body}>
            This wallet is self-custody. The key was created on this device, is encrypted here, and
            never leaves. Nobody can freeze your account, reverse a payment you made, or recover
            your wallet for you — which is the point, and also the risk.
          </p>
        </YzxCard>
      </div>
    </>
  );
}

const heading: React.CSSProperties = {
  margin: "0 0 var(--yzx-space-2)",
  fontSize: "var(--yzx-text-base)",
  fontWeight: "var(--yzx-weight-semibold)",
};

const body: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--yzx-text-sm)",
  color: "var(--yzx-text-secondary)",
  lineHeight: "var(--yzx-leading-relaxed)",
};
