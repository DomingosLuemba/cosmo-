"use client";

import { useEffect, useState } from "react";

import { YzxMark } from "./logo";

/**
 * The opening.
 *
 * Shown once per session, for well under a second, and only while the wallet
 * is genuinely reading its local vault. It is not a timed delay pretending to
 * be work: if the vault reads instantly, this disappears instantly.
 *
 * Under prefers-reduced-motion it appears without animation rather than being
 * removed entirely, so the transition is still coherent.
 */
export function YzxSplash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Long enough for the mark to register, short enough not to be a wait.
    const hold = reduced ? 0 : 900;
    const out = setTimeout(() => setLeaving(true), hold);
    const done = setTimeout(onDone, hold + (reduced ? 0 : 260));
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "var(--yzx-bg)",
        display: "grid",
        placeItems: "center",
        opacity: leaving ? 0 : 1,
        transition: "opacity var(--yzx-duration-normal) var(--yzx-ease)",
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      {/* A single soft field behind the mark. No particles, no pulse. */}
      <div
        style={{
          position: "absolute",
          width: "min(78vw, 420px)",
          aspectRatio: "1",
          background: "radial-gradient(circle, var(--yzx-brand-wash), transparent 68%)",
          filter: "blur(12px)",
        }}
      />
      <div style={{ position: "relative", textAlign: "center" }}>
        <span
          style={{
            display: "block",
            animation: "yzx-mark-in var(--yzx-duration-slow) var(--yzx-ease-out) both",
          }}
        >
          <YzxMark size={76} />
        </span>
        <span
          style={{
            display: "block",
            marginTop: "var(--yzx-space-5)",
            fontSize: "var(--yzx-text-xl)",
            fontWeight: "var(--yzx-weight-bold)",
            letterSpacing: "0.22em",
            color: "var(--yzx-text)",
            animation: "yzx-fade var(--yzx-duration-slow) var(--yzx-ease) 120ms both",
          }}
        >
          YOZEXA
        </span>
        <span
          style={{
            display: "block",
            marginTop: "var(--yzx-space-2)",
            fontSize: "var(--yzx-text-xs)",
            letterSpacing: "0.14em",
            color: "var(--yzx-text-tertiary)",
            animation: "yzx-fade var(--yzx-duration-slow) var(--yzx-ease) 240ms both",
          }}
        >
          Own. Move. Build.
        </span>
      </div>
    </div>
  );
}
