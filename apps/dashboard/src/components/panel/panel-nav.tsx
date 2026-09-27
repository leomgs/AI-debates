"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DEFAULT_SHOWCASE_LOCALE } from "@/lib/locales";
import { LogoutButton } from "./logout-button";
import { NotificationsInbox } from "./notifications-inbox";

const LINKS = [
  { href: "/studio", label: "Episodios" },
  { href: "/studio/new", label: "Crear episodio" },
] as const;

function isActive(pathname: string, href: string): boolean {
  // "/studio" solo está activo en la lista, no en todas las rutas del panel.
  return href === "/studio" ? pathname === "/studio" : pathname === href || pathname.startsWith(`${href}/`);
}

// Navegación del panel (AC 3.15): lista, crear, showcase público y cerrar
// sesión, más el inbox de notificaciones (AC 3.10-3.14).
export function PanelNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Panel" className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
      <Link href="/studio" className="font-semibold">
        AI Trend Debates
      </Link>
      <ul className="flex flex-1 items-center gap-4 text-sm">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
        <li>
          {/* <a> y no <Link>: el showcase tiene otro layout raíz, así que la
              navegación es una recarga completa de todos modos. */}
          <a
            href={`/${DEFAULT_SHOWCASE_LOCALE}`}
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Ver showcase
          </a>
        </li>
      </ul>
      <NotificationsInbox />
      <LogoutButton />
    </nav>
  );
}
