"use client";

import { useEffect, useState } from "react";

import { client } from "@/lib/node";

/**
 * A network that is not mainnet says so on every screen.
 *
 * A test wallet that looks exactly like the real one is how somebody comes to
 * believe their testnet balance is money.
 */
export function NetworkBanner() {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client()
      .status()
      .then((status) => {
        if (!cancelled) setWarning(status.network_warning ?? null);
      })
      .catch(() => {
        if (!cancelled) setWarning(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!warning) return null;
  return <div className="banner">{warning}</div>;
}
