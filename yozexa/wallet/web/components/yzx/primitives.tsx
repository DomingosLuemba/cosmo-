"use client";

import Link from "next/link";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

/* ══════════════════════════════════════════════════════════════════════
   YZXAvatar
   ══════════════════════════════════════════════════════════════════════ */

/**
 * An identity mark derived from the address itself.
 *
 * Deterministic, so the same account always looks the same — which makes a
 * substituted address visibly different, not just textually different. It is
 * an aid, never the only check: the address is always shown too.
 */
export function YzxAvatar({
  seed,
  label,
  size = 40,
}: {
  seed: string;
  label?: string;
  size?: number;
}) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const hue2 = (hue + 48) % 360;
  const initial = (label ?? seed).replace(/^yzx1/, "").charAt(0).toUpperCase();

  return (
    <span
      role="img"
      aria-label={label ? `${label} avatar` : "Account avatar"}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "var(--yzx-radius-full)",
        display: "grid",
        placeItems: "center",
        background: `linear-gradient(135deg,
          hsl(${hue} 62% 52%), hsl(${hue2} 66% 44%))`,
        color: "var(--yzx-on-vivid)",
        fontSize: size * 0.4,
        fontWeight: "var(--yzx-weight-semibold)",
        border: "1px solid var(--yzx-border)",
      }}
    >
      {initial}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   YZXAlert
   ══════════════════════════════════════════════════════════════════════ */

/**
 * A message about state.
 *
 * Colour is never the only signal: each tone carries an icon and its own
 * wording, so the meaning survives greyscale, colour blindness and a screen
 * reader.
 */
export function YzxAlert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: { color: "var(--yzx-text-secondary)", bg: "var(--yzx-neutral-wash)", border: "var(--yzx-border)", glyph: "i", role: "status" },
    warning: { color: "var(--yzx-warning)", bg: "var(--yzx-warning-wash)", border: "var(--yzx-warning)", glyph: "!", role: "status" },
    danger: { color: "var(--yzx-negative)", bg: "var(--yzx-negative-wash)", border: "var(--yzx-negative)", glyph: "!", role: "alert" },
    success: { color: "var(--yzx-positive)", bg: "var(--yzx-positive-wash)", border: "var(--yzx-positive)", glyph: "✓", role: "status" },
  } as const;
  const t = tones[tone];

  return (
    <div
      role={t.role}
      style={{
        display: "flex",
        gap: "var(--yzx-space-3)",
        padding: "var(--yzx-space-3) var(--yzx-space-4)",
        borderRadius: "var(--yzx-radius-md)",
        background: t.bg,
        border: `1px solid ${t.border}`,
        marginBottom: "var(--yzx-space-4)",
        fontSize: "var(--yzx-text-sm)",
        lineHeight: "var(--yzx-leading-snug)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: "18px",
          height: "18px",
          marginTop: "1px",
          borderRadius: "var(--yzx-radius-full)",
          display: "grid",
          placeItems: "center",
          background: t.color,
          color: "var(--yzx-bg)",
          fontSize: "11px",
          fontWeight: "var(--yzx-weight-bold)",
        }}
      >
        {t.glyph}
      </span>
      <div style={{ minWidth: 0 }}>
        {title ? (
          <strong style={{ display: "block", color: t.color, marginBottom: children ? "2px" : 0 }}>
            {title}
          </strong>
        ) : null}
        {children ? <div style={{ color: "var(--yzx-text-secondary)" }}>{children}</div> : null}
        {action ? <div style={{ marginTop: "var(--yzx-space-2)" }}>{action}</div> : null}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   YZXSkeleton
   ══════════════════════════════════════════════════════════════════════ */

/** A placeholder with the shape of what is coming, not a spinner. */
export function YzxSkeleton({
  width = "100%",
  height = 16,
  radius = "var(--yzx-radius-sm)",
  style,
}: {
  width?: string | number;
  height?: string | number;
  radius?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height,
        borderRadius: radius,
        background: `linear-gradient(90deg,
          var(--yzx-surface-raised) 0%, var(--yzx-border) 50%, var(--yzx-surface-raised) 100%)`,
        backgroundSize: "320px 100%",
        animation: "yzx-shimmer 1.4s linear infinite",
        ...style,
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   YZXSheet
   ══════════════════════════════════════════════════════════════════════ */

/** A bottom sheet. Dismissible by backdrop, Escape and an explicit control. */
export function YzxSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "var(--yzx-surface-overlay)",
        backdropFilter: "blur(8px)",
        animation: "yzx-fade var(--yzx-duration-fast) var(--yzx-ease) both",
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "var(--yzx-app-width)",
          background: "var(--yzx-surface)",
          borderTopLeftRadius: "var(--yzx-radius-2xl)",
          borderTopRightRadius: "var(--yzx-radius-2xl)",
          border: "1px solid var(--yzx-border)",
          borderBottom: "none",
          padding: `var(--yzx-space-3) var(--yzx-space-5)
                    calc(var(--yzx-space-6) + env(safe-area-inset-bottom))`,
          maxHeight: "86dvh",
          overflowY: "auto",
          animation: "yzx-rise var(--yzx-duration-normal) var(--yzx-ease-out) both",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "36px",
            height: "4px",
            borderRadius: "var(--yzx-radius-full)",
            background: "var(--yzx-border-strong)",
            margin: "0 auto var(--yzx-space-4)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--yzx-space-4)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--yzx-text-lg)", letterSpacing: "var(--yzx-tracking-tight)" }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "var(--yzx-surface-raised)",
              border: "1px solid var(--yzx-border)",
              borderRadius: "var(--yzx-radius-full)",
              width: "32px",
              height: "32px",
              cursor: "pointer",
              color: "var(--yzx-text-secondary)",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   YZXSecurityBadge
   ══════════════════════════════════════════════════════════════════════ */

/**
 * A security state.
 *
 * The word carries the meaning; the colour reinforces it. Never a bare
 * coloured dot, which tells a colour-blind or greyscale user nothing.
 */
export function YzxSecurityBadge({
  state,
  children,
}: {
  state: "on" | "off" | "optional" | "warning";
  children: ReactNode;
}) {
  const map = {
    on: { color: "var(--yzx-positive)", bg: "var(--yzx-positive-wash)", glyph: "✓" },
    off: { color: "var(--yzx-negative)", bg: "var(--yzx-negative-wash)", glyph: "✕" },
    optional: { color: "var(--yzx-text-tertiary)", bg: "var(--yzx-neutral-wash)", glyph: "–" },
    warning: { color: "var(--yzx-warning)", bg: "var(--yzx-warning-wash)", glyph: "!" },
  } as const;
  const t = map[state];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--yzx-space-1)",
        padding: "2px var(--yzx-space-2)",
        borderRadius: "var(--yzx-radius-full)",
        background: t.bg,
        color: t.color,
        fontSize: "var(--yzx-text-2xs)",
        fontWeight: "var(--yzx-weight-semibold)",
      }}
    >
      <span aria-hidden="true">{t.glyph}</span>
      {children}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   YZXNavigationBar
   ══════════════════════════════════════════════════════════════════════ */

/** The screen header: back, title, optional trailing control. */
export function YzxNavigationBar({
  title,
  back,
  trailing,
}: {
  title?: string;
  back?: string | (() => void);
  trailing?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--yzx-space-3)",
        minHeight: "56px",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {back ? (
        typeof back === "string" ? (
          <Link href={back} aria-label="Back" style={navButtonStyle}>
            <BackGlyph />
          </Link>
        ) : (
          <button type="button" onClick={back} aria-label="Back" style={navButtonStyle}>
            <BackGlyph />
          </button>
        )
      ) : (
        <span style={{ width: "36px" }} />
      )}

      <h1
        style={{
          flex: 1,
          margin: 0,
          textAlign: "center",
          fontSize: "var(--yzx-text-md)",
          fontWeight: "var(--yzx-weight-semibold)",
          letterSpacing: "var(--yzx-tracking-tight)",
        }}
      >
        {title}
      </h1>

      <span style={{ width: "36px", display: "flex", justifyContent: "flex-end" }}>{trailing}</span>
    </header>
  );
}

const navButtonStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  display: "grid",
  placeItems: "center",
  borderRadius: "var(--yzx-radius-full)",
  background: "var(--yzx-surface-raised)",
  border: "1px solid var(--yzx-border)",
  color: "var(--yzx-text)",
  cursor: "pointer",
  textDecoration: "none",
};

function BackGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Copy control
   ══════════════════════════════════════════════════════════════════════ */

/** Copy to clipboard with a confirmed state, announced to screen readers. */
export function YzxCopyButton({
  value,
  label = "Copy",
  children,
}: {
  value: string;
  label?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1_800);
        } catch {
          setCopied(false);
        }
      }}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--yzx-space-1)",
        background: "none",
        border: "none",
        padding: "var(--yzx-space-1)",
        cursor: "pointer",
        color: copied ? "var(--yzx-positive)" : "var(--yzx-text-tertiary)",
        fontSize: "var(--yzx-text-xs)",
        fontWeight: "var(--yzx-weight-medium)",
      }}
    >
      {children ?? (copied ? "Copied" : label)}
      <span role="status" className="yzx-sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
