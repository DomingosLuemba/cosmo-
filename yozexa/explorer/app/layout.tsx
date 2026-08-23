import type { Metadata } from "next";
import type { ReactNode } from "react";

import { chain, tryFetch } from "@/lib/chain";
import "./globals.css";

export const metadata: Metadata = {
  title: "YOZEXA Explorer",
  description: "Blocks, transactions, validators and the live YZXA supply of the YOZEXA Network.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const status = await tryFetch(() => chain.status());
  const warning = "data" in status ? status.data.network_warning : undefined;
  const chainId = "data" in status ? status.data.chain_id : "unavailable";

  return (
    <html lang="en">
      <body>
        {/*
          Every non-mainnet network says so on every page. A test network that
          looks like the real one is how somebody ends up believing their
          testnet balance is money.
        */}
        {warning ? <div className="banner">{warning}</div> : null}

        <header className="site">
          <div className="inner">
            <a href="/" className="brand">
              YOZEXA <span>Explorer</span>
            </a>
            <nav className="site">
              <a href="/">Overview</a>
              <a href="/blocks">Blocks</a>
              <a href="/validators">Validators</a>
              <a href="/supply">Supply</a>
              <a href="/transparency">Transparency</a>
              <a href="/governance">Governance</a>
            </nav>
            <span className="dim mono" style={{ marginLeft: "auto", fontSize: 12 }}>
              {chainId}
            </span>
          </div>
        </header>

        <main>
          <div className="container">{children}</div>
        </main>

        <footer className="site">
          <div className="container">
            Every figure on this site is read live from a YOZEXA node and can be verified
            against the same endpoints — nothing here is stored or edited by the explorer.
            The chain is the source of truth.
          </div>
        </footer>
      </body>
    </html>
  );
}
