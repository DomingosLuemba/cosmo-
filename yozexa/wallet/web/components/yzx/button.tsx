"use client";

import Link from "next/link";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

/**
 * YZXButton.
 *
 * Every variant meets the 44px minimum touch target, keeps a visible focus
 * ring, and states its disabled reason through `title` rather than leaving a
 * dead control the user has to guess about.
 */
export function YzxButton({
  children,
  variant = "primary",
  size = "lg",
  full = true,
  busy = false,
  icon,
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  busy?: boolean;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--yzx-space-2)",
    width: full ? "100%" : "auto",
    minHeight: size === "lg" ? "52px" : "var(--yzx-touch-target)",
    padding:
      size === "lg"
        ? "var(--yzx-space-4) var(--yzx-space-6)"
        : "var(--yzx-space-3) var(--yzx-space-5)",
    borderRadius: "var(--yzx-radius-lg)",
    fontSize: size === "lg" ? "var(--yzx-text-md)" : "var(--yzx-text-base)",
    fontWeight: "var(--yzx-weight-semibold)",
    letterSpacing: "var(--yzx-tracking-tight)",
    cursor: rest.disabled ? "not-allowed" : "pointer",
    opacity: rest.disabled ? 0.42 : 1,
    transition: `background var(--yzx-duration-fast) var(--yzx-ease),
                 border-color var(--yzx-duration-fast) var(--yzx-ease),
                 transform var(--yzx-duration-instant) var(--yzx-ease)`,
    border: "1px solid transparent",
  };

  const variants: Record<Variant, React.CSSProperties> = {
    primary: {
      background: "var(--yzx-brand)",
      color: "var(--yzx-brand-ink)",
      boxShadow: rest.disabled ? "none" : "var(--yzx-shadow-brand)",
    },
    secondary: {
      background: "var(--yzx-surface-raised)",
      color: "var(--yzx-text)",
      borderColor: "var(--yzx-border)",
    },
    ghost: {
      background: "transparent",
      color: "var(--yzx-brand-soft)",
      boxShadow: "none",
    },
    danger: {
      background: "transparent",
      color: "var(--yzx-negative)",
      borderColor: "var(--yzx-negative)",
    },
  };

  return (
    <button {...rest} style={{ ...base, ...variants[variant], ...rest.style }} aria-busy={busy}>
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" fill="none" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 8 8"
          to="360 8 8"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

/**
 * A large circular action — Send, Receive, Pay, Swap.
 *
 * When `unavailable` is set the control is not merely greyed out: it carries
 * the reason, so a user is never left tapping something that silently does
 * nothing. That matters most for Buy and Sell, which need a licensed partner
 * that does not exist yet.
 */
export function YzxActionButton({
  label,
  glyph,
  href,
  onClick,
  unavailable,
  emphasis = false,
}: {
  label: string;
  glyph: ReactNode;
  href?: string;
  onClick?: () => void;
  unavailable?: string;
  emphasis?: boolean;
}) {
  const disabled = Boolean(unavailable);

  const circle: React.CSSProperties = {
    width: "52px",
    height: "52px",
    borderRadius: "var(--yzx-radius-full)",
    display: "grid",
    placeItems: "center",
    background: emphasis ? "var(--yzx-brand)" : "var(--yzx-surface-raised)",
    color: emphasis ? "var(--yzx-brand-ink)" : "var(--yzx-brand-soft)",
    border: `1px solid ${emphasis ? "transparent" : "var(--yzx-border)"}`,
    boxShadow: emphasis ? "var(--yzx-shadow-brand)" : "none",
    transition: `transform var(--yzx-duration-instant) var(--yzx-ease),
                 border-color var(--yzx-duration-fast) var(--yzx-ease)`,
  };

  const wrapper: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--yzx-space-2)",
    background: "none",
    border: "none",
    padding: "var(--yzx-space-1)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.38 : 1,
    textDecoration: "none",
    color: "var(--yzx-text)",
    minWidth: "64px",
  };

  const content = (
    <>
      <span style={circle} aria-hidden="true">
        {glyph}
      </span>
      <span
        style={{
          fontSize: "var(--yzx-text-xs)",
          fontWeight: "var(--yzx-weight-medium)",
          color: disabled ? "var(--yzx-text-tertiary)" : "var(--yzx-text-secondary)",
        }}
      >
        {label}
      </span>
    </>
  );

  if (disabled) {
    return (
      <button type="button" style={wrapper} disabled aria-disabled="true" title={unavailable}>
        {content}
        <span className="yzx-sr-only">{label}: {unavailable}</span>
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} style={wrapper} aria-label={label}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" style={wrapper} onClick={onClick} aria-label={label}>
      {content}
    </button>
  );
}
