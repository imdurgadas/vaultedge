"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/keys",    label: "Keys",    icon: KeyIcon },
  { href: "/routing", label: "Routing", icon: RouteIcon },
  { href: "/logs",    label: "Logs",    icon: LogIcon },
  { href: "/export",  label: "Export",  icon: ExportIcon },
];

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const key = params.get("key") || params.get("token");
      const host = params.get("host") || params.get("proxy_host");

      let updated = false;
      if (key) {
        localStorage.setItem("ve_proxy_key", key);
        updated = true;
      }
      if (host) {
        localStorage.setItem("ve_proxy_host", host);
        updated = true;
      }

      if (updated) {
        // Clean up URL search params without triggering full reload
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        // Dispatch custom storage event so other components reload
        window.dispatchEvent(new Event("storage"));
      }
    }
  }, []);

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">🔐</div>
          <span className="sidebar-logo-text">VaultEdge</span>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ href, label, icon: Icon }) => (
            <button
              key={href}
              className={`nav-item${pathname.startsWith(href) ? " active" : ""}`}
              onClick={() => router.push(href)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="text-xs text-muted" style={{ padding: "0.4rem 0.5rem" }}>
            v1.0.1 · MIT License
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">{children}</main>
    </div>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 8.5l-5.4 5.4M15.4 7.1l1.5 1.5M19.5 4.5l1.5 1.5" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="18" cy="5" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M8 12h7a3 3 0 000-6h-1M8 12h7a3 3 0 010 6h-1" />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 2v13M9 12l3 3 3-3" />
      <path d="M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
