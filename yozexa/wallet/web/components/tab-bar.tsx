"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";

/**
 * The five places the wallet is organised around.
 *
 * Pay carries a subtle emphasis because it is the thing this wallet is for.
 * The emphasis is a filled circle, not a colour alone, so it survives
 * greyscale and high contrast.
 */
const TABS = [
  { href: "/", label: "Home", glyph: HomeGlyph },
  { href: "/pay", label: "Pay", glyph: PayGlyph, emphasis: true },
  { href: "/explore", label: "Explore", glyph: ExploreGlyph },
  { href: "/activity", label: "Activity", glyph: ActivityGlyph },
  { href: "/profile", label: "Profile", glyph: ProfileGlyph },
] as const;

export function TabBar() {
  const pathname = usePathname();

  // Hidden during onboarding: there is nothing to navigate to yet, and a live
  // tab bar behind a setup flow invites people to skip steps that matter.
  if (
    pathname === "/welcome" ||
    pathname.startsWith("/create") ||
    pathname.startsWith("/import")
  ) {
    return null;
  }

  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        background: "var(--yzx-surface-overlay)",
        backdropFilter: "blur(18px)",
        borderTop: "1px solid var(--yzx-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <ul
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          maxWidth: "var(--yzx-app-width)",
          margin: "0 auto",
          padding: "var(--yzx-space-2) var(--yzx-space-2)",
          listStyle: "none",
        }}
      >
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Glyph = tab.glyph;
          const emphasis = "emphasis" in tab && tab.emphasis;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "3px",
                  padding: "var(--yzx-space-1) var(--yzx-space-3)",
                  minWidth: "56px",
                  minHeight: "var(--yzx-touch-target)",
                  justifyContent: "center",
                  color: active ? "var(--yzx-brand-soft)" : "var(--yzx-text-tertiary)",
                  textDecoration: "none",
                  fontSize: "var(--yzx-text-2xs)",
                  fontWeight: active ? "var(--yzx-weight-semibold)" : "var(--yzx-weight-medium)",
                  transition: "color var(--yzx-duration-fast) var(--yzx-ease)",
                }}
              >
                <span
                  style={
                    emphasis
                      ? {
                          display: "grid",
                          placeItems: "center",
                          width: "30px",
                          height: "30px",
                          marginTop: "-2px",
                          borderRadius: "var(--yzx-radius-full)",
                          background: active ? "var(--yzx-brand)" : "var(--yzx-brand-wash)",
                          color: active ? "var(--yzx-brand-ink)" : "var(--yzx-brand-soft)",
                          border: `1px solid ${active ? "transparent" : "var(--yzx-brand-edge)"}`,
                        }
                      : { lineHeight: 0 }
                  }
                >
                  <Glyph />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function HomeGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 8.4 10 3l7 5.4V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1V8.4Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function PayGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M11.5 11.5h2.5v2.5M17.5 14v3.5H14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function ExploreGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 7l-1.8 4.2L7 13l1.8-4.2L13 7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function ActivityGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.5 11.5h3l2-5.5 3 9 2.2-5h4.8" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ProfileGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.8 17c.6-3.2 3.1-5 6.2-5s5.6 1.8 6.2 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
