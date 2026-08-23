"use client";

import { useEffect, useRef, useState } from "react";

import { YzxMark } from "./logo";

/**
 * The balance card.
 *
 * A digital object, not a picture of a bank card: no magnetic stripe, no chip,
 * no embossed-number pastiche. Depth comes from a single soft brand wash and a
 * highlight edge, which is enough to read as an object without becoming
 * decoration.
 *
 * On a device with a motion sensor it tilts very slightly with the device, and
 * only after the user has granted permission — the effect is turned off
 * entirely under prefers-reduced-motion, where it would be an accessibility
 * problem rather than a flourish.
 */
export function YzxBalanceCard({
  children,
  network,
}: {
  children: React.ReactNode;
  network?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Only pointer-driven: requesting motion-sensor permission unprompted is
    // hostile, and the effect is not worth a permission dialog.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const element = ref.current;
    if (!element) return;

    function onMove(event: PointerEvent) {
      const rect = element!.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      setTilt({ x: -py * 4, y: px * 5 });
    }
    function onLeave() {
      setTilt({ x: 0, y: 0 });
    }

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        borderRadius: "var(--yzx-radius-2xl)",
        padding: "var(--yzx-space-6) var(--yzx-space-5) var(--yzx-space-5)",
        background: "var(--yzx-brand-gradient-soft), var(--yzx-surface)",
        border: "1px solid var(--yzx-border)",
        boxShadow: "var(--yzx-shadow-md), var(--yzx-shadow-inset)",
        overflow: "hidden",
        transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: "transform var(--yzx-duration-normal) var(--yzx-ease-out)",
        willChange: "transform",
      }}
    >
      {/* A single soft glow, positioned once. Not an animated background. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "-40% -20% auto -20%",
          height: "160%",
          background:
            "radial-gradient(ellipse at 30% 0%, var(--yzx-brand-wash), transparent 62%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--yzx-space-5)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--yzx-space-2)" }}>
          <YzxMark size={18} />
          <span
            style={{
              fontSize: "var(--yzx-text-2xs)",
              fontWeight: "var(--yzx-weight-bold)",
              letterSpacing: "var(--yzx-tracking-wide)",
              color: "var(--yzx-text-secondary)",
            }}
          >
            YOZEXA
          </span>
        </span>
        {network ? (
          <span
            style={{
              fontSize: "var(--yzx-text-2xs)",
              fontWeight: "var(--yzx-weight-medium)",
              letterSpacing: "var(--yzx-tracking-wide)",
              color: "var(--yzx-text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            {network}
          </span>
        ) : null}
      </div>

      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}
