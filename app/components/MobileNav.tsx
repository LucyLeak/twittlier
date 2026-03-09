"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import homeIcon from "@/app/icons/home.png";
import liveIcon from "@/app/icons/live.png";
import settingsIcon from "@/app/icons/settings.png";
import profileIcon from "@/app/icons/profile.png";
import notificationsIcon from "@/app/icons/for-you.png";

const navItems = [
  { href: "/", label: "Home", icon: homeIcon },
  { href: "/live", label: "Live", icon: liveIcon },
  { href: "/notificacoes", label: "Notificacoes", icon: notificationsIcon },
  { href: "/configuracoes", label: "Config", icon: settingsIcon }
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="tw-mobile-nav">
      {navItems.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={`tw-mobile-nav-item ${active ? "active" : ""}`}>
            <Image src={item.icon} alt={item.label} width={22} height={22} className="tw-icon" />
            <span className="tw-mobile-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
