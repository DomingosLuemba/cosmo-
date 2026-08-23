import type { Metadata } from "next";
import type { ReactNode } from "react";

import { chainStatus } from "@/lib/chain";
import "./globals.css";

export const metadata: Metadata = {
  title: "YOZEXA Developer",
  description: "Build on the YOZEXA Network: quickstart, SDK, API reference and testnet faucet.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const status = await chainStatus();

  return (
    <html lang="en">
      <body>
        {status?.network_warning ? <div className="banner">{status.network_warning}</div> : null}
        <header className="site">
          <div className="inner">
            <a href="/" className="brand">
              YOZEXA <span>Developer</span>
            </a>
            <nav className="site">
              <a href="/quickstart">Quickstart</a>
              <a href="/sdk">SDK</a>
              <a href="/api-reference">API</a>
              <a href="/faucet">Faucet</a>
            </nav>
            <span className="dim mono" style={{ marginLeft: "auto", fontSize: 12 }}>
              {status?.chain_id ?? "no node"}
            </span>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="site">
          <div className="container">
            Everything documented here is implemented and runnable. Where something is planned
            rather than built, the page says so in its first line.
          </div>
        </footer>
      </body>
    </html>
  );
}
