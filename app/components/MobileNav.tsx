"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function LiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8.5a5 5 0 0 0 0 7" />
      <path d="M16 8.5a5 5 0 0 1 0 7" />
      <path d="M5 5.5a9 9 0 0 0 0 13" />
      <path d="M19 5.5a9 9 0 0 1 0 13" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 17h12" />
      <path d="M8 17V11a4 4 0 1 1 8 0v6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4" />
      <path d="M12 18.8v2.4" />
      <path d="m4.9 4.9 1.7 1.7" />
      <path d="m17.4 17.4 1.7 1.7" />
      <path d="M2.8 12h2.4" />
      <path d="M18.8 12h2.4" />
      <path d="m4.9 19.1 1.7-1.7" />
      <path d="m17.4 6.6 1.7-1.7" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/live", label: "Live", icon: LiveIcon },
  { href: "/notificacoes", label: "Notificacoes", icon: BellIcon },
  { href: "/configuracoes", label: "Config", icon: SettingsIcon }
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="tw-mobile-nav">
      {navItems.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={`tw-mobile-nav-item ${active ? "active" : ""}`}>
            <span className="tw-nav-icon">
              <Icon />
            </span>
            <span className="tw-mobile-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
