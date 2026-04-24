"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SyncBar } from "./SyncBar";

const links = [
  { href: "/", label: "Overview" },
  { href: "/history", label: "History" },
  { href: "/vocab", label: "Vocabulary" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="relative z-10 overflow-visible border-b border-zinc-800 bg-zinc-950 px-6 py-3">
      <div className="mx-auto flex min-w-0 max-w-7xl items-center gap-4">
        <div className="flex shrink-0 items-center gap-6">
          <h1 className="text-lg font-semibold text-zinc-100">
            Duolingo Dash
          </h1>
          <div className="flex gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  pathname === link.href
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 justify-end overflow-visible">
          <SyncBar />
        </div>
      </div>
    </nav>
  );
}
