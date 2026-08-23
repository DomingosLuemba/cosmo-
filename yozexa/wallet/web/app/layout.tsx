import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "YOZEXA Wallet",
  description: "Own. Move. Build. A self-custody wallet for the YOZEXA Network.",
  applicationName: "YOZEXA",
  // A wallet has no business being indexed or previewed by a crawler.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom is left available: capping it breaks the wallet for anyone who
  // needs to magnify an address before approving a payment.
  maximumScale: 5,
  viewportFit: "cover",
  // A meta tag cannot take a CSS variable, so these two are the only place in
  // the app where a background colour is written out rather than referenced.
  // They must stay equal to --yzx-bg (dark) and --yzx-bg (light) in
  // globals.css: they paint the browser and OS chrome around the app, and a
  // drift shows up as a seam above the status bar.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07080d" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="yzx-skip">
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
