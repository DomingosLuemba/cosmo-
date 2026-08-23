import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** YZXCard — the standard raised surface. */
export function YzxCard({
  children,
  padded = true,
  tone = "surface",
  style,
  as: Tag = "div",
}: {
  children: ReactNode;
  padded?: boolean;
  tone?: "surface" | "sunken" | "brand" | "warning" | "danger";
  style?: CSSProperties;
  as?: "div" | "section" | "article";
}) {
  const tones: Record<string, CSSProperties> = {
    surface: { background: "var(--yzx-surface)", borderColor: "var(--yzx-border)" },
    sunken: { background: "var(--yzx-surface-sunken)", borderColor: "var(--yzx-border)" },
    brand: { background: "var(--yzx-brand-wash)", borderColor: "var(--yzx-brand-edge)" },
    warning: { background: "var(--yzx-warning-wash)", borderColor: "var(--yzx-warning)" },
    danger: { background: "var(--yzx-negative-wash)", borderColor: "var(--yzx-negative)" },
  };

  return (
    <Tag
      style={{
        border: "1px solid",
        borderRadius: "var(--yzx-radius-lg)",
        padding: padded ? "var(--yzx-space-4)" : 0,
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/** A label above a section of the screen. */
export function YzxSectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; href: string };
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        margin: "var(--yzx-space-6) 0 var(--yzx-space-3)",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "var(--yzx-text-base)",
          fontWeight: "var(--yzx-weight-semibold)",
          letterSpacing: "var(--yzx-tracking-tight)",
        }}
      >
        {title}
      </h2>
      {action ? (
        <Link
          href={action.href}
          style={{ fontSize: "var(--yzx-text-sm)", fontWeight: "var(--yzx-weight-medium)" }}
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** A key/value row, used on review and detail screens. */
export function YzxDetailRow({
  label,
  value,
  sub,
  emphasis = false,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  emphasis?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "var(--yzx-space-4)",
        padding: "var(--yzx-space-3) 0",
        borderBottom: "1px solid var(--yzx-border)",
      }}
    >
      <span
        style={{
          fontSize: "var(--yzx-text-sm)",
          color: "var(--yzx-text-secondary)",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ textAlign: "right", minWidth: 0 }}>
        <span
          className={mono ? "yzx-mono" : "yzx-num"}
          style={{
            display: "block",
            fontSize: emphasis ? "var(--yzx-text-lg)" : "var(--yzx-text-base)",
            fontWeight: emphasis ? "var(--yzx-weight-semibold)" : "var(--yzx-weight-medium)",
            wordBreak: mono ? "break-all" : "normal",
          }}
        >
          {value}
        </span>
        {sub ? (
          <span
            className="yzx-num"
            style={{
              display: "block",
              fontSize: "var(--yzx-text-xs)",
              color: "var(--yzx-text-tertiary)",
              marginTop: "2px",
            }}
          >
            {sub}
          </span>
        ) : null}
      </span>
    </div>
  );
}
