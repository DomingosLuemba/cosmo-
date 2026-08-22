import type { Metadata } from "next";
import type { ReactNode } from "react";

import { isConnected } from "@/lib/pay";
import "./globals.css";

export const metadata: Metadata = {
  title: "YOZEXA Business",
  description: "Payments, invoices and reconciliation for businesses accepting YOZEXA.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const connected = await isConnected();

  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="inner">
            <a href="/" className="brand">
              YOZEXA <span>Business</span>
            </a>
            {connected ? (
              <nav className="site">
                <a href="/">Overview</a>
                <a href="/payments">Payments</a>
                <a href="/links">Links</a>
                <a href="/invoices">Invoices</a>
                <a href="/reconcile">Reconcile</a>
                <a href="/webhooks">Webhooks</a>
              </nav>
            ) : null}
            <span className="spacer" style={{ marginLeft: "auto" }} />
            {connected ? (
              <form action="/connect/disconnect" method="post">
                <button
                  type="submit"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Disconnect
                </button>
              </form>
            ) : null}
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="site">
          <div className="container">
            YOZEXA Labs charges for the services on this dashboard. It takes no cut of
            peer-to-peer transfers on the YOZEXA Network — the network fee is the only cost of
            sending YZXA to a person.
          </div>
        </footer>
      </body>
    </html>
  );
}
