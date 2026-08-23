"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * YZXQRCode.
 *
 * Generated on this device. An address is not secret, but sending it to a
 * remote QR service would leak who is being paid, to a third party, for no
 * benefit.
 */
export function YzxQRCode({ value, size = 216, label }: { value: string; size?: number; label?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      // The encoder needs literal colours, so the tokens are read out of the
      // stylesheet rather than duplicated here.
      color: { dark: token("--yzx-scan-ink", "#000000"), light: token("--yzx-scan-field", "#ffffff") },
    })
      .then((out) => {
        if (!cancelled) setSvg(out);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (error) {
    return (
      <p style={{ color: "var(--yzx-negative)", fontSize: "var(--yzx-text-sm)" }}>
        Could not draw the QR code. The address below still works.
      </p>
    );
  }

  return (
    <div
      role="img"
      aria-label={label ?? "QR code"}
      style={{
        /* Always a white field: a QR on a dark background does not scan on
           many cameras, and a code that does not scan is not a feature. */
        background: "var(--yzx-scan-field)",
        padding: "var(--yzx-space-4)",
        borderRadius: "var(--yzx-radius-xl)",
        width: size + 32,
        height: size + 32,
        display: "grid",
        placeItems: "center",
        boxShadow: "var(--yzx-shadow-md)",
      }}
    >
      {svg ? (
        <span
          style={{ width: size, height: size, display: "block" }}
          dangerouslySetInnerHTML={{
            __html: svg.replace("<svg", `<svg width="${size}" height="${size}"`),
          }}
        />
      ) : (
        <span style={{ width: size, height: size, display: "block", background: "var(--yzx-scan-placeholder)" }} />
      )}
    </div>
  );
}

/**
 * Read a design token at runtime.
 *
 * Used only where a value has to be handed to something that cannot take a CSS
 * variable — here, the QR encoder. The fallback covers server rendering, where
 * there is no computed style to read.
 */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
