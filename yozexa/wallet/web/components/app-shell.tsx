"use client";

import { useEffect, useState, type ReactNode } from "react";

import { NetworkBanner } from "./network-banner";
import { TabBar } from "./tab-bar";
import { YzxSplash } from "./yzx/splash";

const SPLASH_KEY = "yozexa.splash-shown";

/**
 * The app frame: splash on first open, the network warning, the content, and
 * the tab bar.
 *
 * The splash runs once per browser session rather than on every navigation —
 * an opening animation the fourth time you look at your balance is an
 * obstacle, not an experience.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [showSplash, setShowSplash] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const seen = window.sessionStorage.getItem(SPLASH_KEY);
      if (!seen) {
        setShowSplash(true);
        window.sessionStorage.setItem(SPLASH_KEY, "1");
      }
    } catch {
      // Session storage can be unavailable in a private window. Skipping the
      // splash is the right failure: it is decoration, not function.
    }
    setReady(true);
  }, []);

  return (
    <>
      {ready && showSplash ? <YzxSplash onDone={() => setShowSplash(false)} /> : null}
      <NetworkBanner />
      <div className="yzx-app" id="main">
        {children}
      </div>
      <TabBar />
    </>
  );
}
