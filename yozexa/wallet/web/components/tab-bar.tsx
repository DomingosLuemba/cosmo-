"use client";

import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", glyph: "◎" },
  { href: "/activity", label: "Activity", glyph: "≡" },
  { href: "/stake", label: "Earn", glyph: "▲" },
  { href: "/permissions", label: "Access", glyph: "⚿" },
  { href: "/settings", label: "Settings", glyph: "⚙" },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
        >
          <span className="glyph" aria-hidden="true">{tab.glyph}</span>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
