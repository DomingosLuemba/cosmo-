/**
 * The YOZEXA mark.
 *
 * An X built from four blades radiating from a hollow centre. The blades read
 * as movement outward; their convergence reads as connection; the geometry is
 * exact rather than organic, which is the "precision" half of the brief. The
 * open centre is what keeps it legible at 32px — a solid X turns into a blob,
 * while a hollow one keeps its shape.
 *
 * Deliberately not: a coin, a B, a diamond, a rocket, a currency sign.
 */

export function YzxMark({
  size = 32,
  gradient = true,
  title,
}: {
  size?: number;
  /** Flat single-colour for very small sizes and monochrome contexts. */
  gradient?: boolean;
  /** Accessible name. Omit inside a labelled parent to avoid repetition. */
  title?: string;
}) {
  // Unique per instance so several marks on one page cannot share a gradient id.
  const id = `yzx-mark-${Math.round(size)}-${gradient ? "g" : "f"}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {gradient ? (
        <defs>
          <linearGradient id={id} x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--yzx-brand-soft)" />
            <stop offset="0.55" stopColor="var(--yzx-brand)" />
            <stop offset="1" stopColor="var(--yzx-brand-blue)" />
          </linearGradient>
        </defs>
      ) : null}
      <g
        stroke={gradient ? `url(#${id})` : "currentColor"}
        strokeWidth="7"
        strokeLinecap="round"
      >
        <path d="M11.3 11.3 L19.8 19.8" />
        <path d="M36.7 11.3 L28.2 19.8" />
        <path d="M19.8 28.2 L11.3 36.7" />
        <path d="M28.2 28.2 L36.7 36.7" />
      </g>
    </svg>
  );
}

/** The mark with the wordmark beside it. */
export function YzxLogo({ size = 28 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--yzx-space-2)",
      }}
    >
      <YzxMark size={size} />
      <span
        style={{
          fontSize: "var(--yzx-text-lg)",
          fontWeight: "var(--yzx-weight-bold)",
          letterSpacing: "var(--yzx-tracking-wide)",
          color: "var(--yzx-text)",
        }}
      >
        YOZEXA
      </span>
    </span>
  );
}

/**
 * The app icon, as SVG.
 *
 * Same mark on a deep field with a soft brand glow. No text: at 60px and
 * below, a word inside an icon is noise.
 *
 * This is the one component that writes colours out rather than referencing
 * tokens, and deliberately so: it is exported as a standalone asset — a
 * favicon, a home-screen icon, a store listing — and rendered by software that
 * never loads the app's stylesheet. It also does not follow the theme: an app
 * icon that changed colour with the OS setting would be unrecognisable on a
 * home screen. The values mirror --yzx-bg, --yzx-brand and --yzx-brand-blue.
 */
export function YzxAppIcon({ size = 180 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 180 180" role="img" aria-label="YOZEXA">
      <defs>
        <linearGradient id="yzx-icon-bg" x1="0" y1="0" x2="180" y2="180" gradientUnits="userSpaceOnUse">
          <stop stopColor="#12142090" />
          <stop offset="1" stopColor="#07080d" />
        </linearGradient>
        <radialGradient id="yzx-icon-glow" cx="0.5" cy="0.42" r="0.62">
          <stop stopColor="#6b4eff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#6b4eff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="yzx-icon-mark" x1="46" y1="46" x2="134" y2="134" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a48fff" />
          <stop offset="0.55" stopColor="#6b4eff" />
          <stop offset="1" stopColor="#4da6ff" />
        </linearGradient>
      </defs>
      <rect width="180" height="180" rx="40" fill="#07080d" />
      <rect width="180" height="180" rx="40" fill="url(#yzx-icon-bg)" />
      <rect width="180" height="180" rx="40" fill="url(#yzx-icon-glow)" />
      <g stroke="url(#yzx-icon-mark)" strokeWidth="15" strokeLinecap="round">
        <path d="M56 56 L79 79" />
        <path d="M124 56 L101 79" />
        <path d="M79 101 L56 124" />
        <path d="M101 101 L124 124" />
      </g>
    </svg>
  );
}
