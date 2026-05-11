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
    <nav className="relative z-10 overflow-visible border-b border-zinc-800 bg-zinc-900 px-4 py-3 shadow-sm sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          <h1 className="text-lg font-semibold text-zinc-100">
            Duolingo Dash
          </h1>
          <div className="flex min-w-0 gap-1 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap px-3 py-1.5 rounded text-sm transition-colors ${
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
        <div className="flex min-w-0 justify-start overflow-visible sm:flex-1 sm:justify-end">
          <SyncBar />
        </div>
      </div>
    </nav>
  );
}
