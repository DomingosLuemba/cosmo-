import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { NetworkBanner } from "@/components/network-banner";
import { TabBar } from "@/components/tab-bar";
import "./globals.css";

export const metadata: Metadata = {
  title: "YOZEXA Wallet",
  description: "Self-custody wallet for the YOZEXA Network.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#07090e",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NetworkBanner />
        <div className="shell">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
