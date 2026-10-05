"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import { Menu, X, LogOut } from "lucide-react";
import { NAV_GROUPS, MOBILE_NAV_ITEMS } from "@/components/nav-config";
import { useSystemStatus } from "@/hooks/use-system-status";
import { Logo } from "@/components/logo";

const STATUS_COLOR = { up: "var(--up)", warn: "var(--warn)", down: "var(--down)" } as const;

function SystemStatusLine() {
  const status = useSystemStatus();
  const color = STATUS_COLOR[status.level];
  return (
    <div
      className="flex items-center gap-2 text-[var(--text-3)] text-[11.5px]"
      title={status.detail}
      role="status"
      aria-live="polite"
      data-testid="system-status"
    >
      <span className="relative flex w-1.5 h-1.5 shrink-0">
        {status.level === "up" && (
          <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: color }} />
        )}
        <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      </span>
      <span style={status.level === "up" ? undefined : { color }}>{status.text}</span>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    signOut({ callbackUrl: "/login" });
  }, []);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  // Close sidebar when resizing to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setIsOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[var(--bg)]/90 backdrop-blur-xl border-b border-[var(--line)] px-4 py-3 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-1">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="p-2 text-[var(--text-2)] hover:text-[var(--text)] transition-colors rounded-lg hover:bg-[var(--surface-1)] disabled:opacity-50"
            aria-label="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 text-[var(--text-2)] hover:text-[var(--text)] transition-colors rounded-lg hover:bg-[var(--surface-1)]"
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg)]/90 backdrop-blur-xl border-t border-[var(--line)] px-2 py-2 safe-area-pb">
        <nav className="flex justify-around">
          {MOBILE_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 p-2 px-3 rounded-lg transition-all ${
                  isActive
                    ? "text-[var(--text)] bg-[var(--surface-2)]"
                    : "text-[var(--text-3)] hover:text-[var(--text-2)] active:scale-95"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside
        className={`
          fixed md:relative z-50 md:z-10
          w-64 md:w-[15rem] h-full
          bg-[var(--bg)] md:bg-transparent border-r border-[var(--line)]
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          top-0 left-0
        `}
      >
        {/* Logo */}
        <div className="hidden md:block px-5 pt-6 pb-8">
          <Logo />
        </div>

        {/* Spacer for mobile header */}
        <div className="h-16 md:hidden" />

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto">
          <div className="space-y-5">
            {NAV_GROUPS.map((group) => (
              <div key={group.name}>
                <h3 className="eyebrow px-3 mb-1.5 !text-[10px] !text-[var(--text-4)]">
                  {group.name}
                </h3>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive =
                      pathname === item.href || pathname.startsWith(item.href + "/");
                    const Icon = item.icon;
                    return (
                      <div key={item.href}>
                        <Link
                          href={item.href}
                          className={`group relative flex items-center gap-3 px-3 py-[7px] rounded-[var(--r-sm)] transition-all duration-150 ${
                            isActive
                              ? "bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line-strong)]"
                              : "text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-1)] border border-transparent"
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] bg-[var(--accent)] shadow-[0_0_6px_var(--accent-glow)]" />
                          )}
                          <Icon
                            className={`w-[17px] h-[17px] shrink-0 ${
                              isActive ? "text-[var(--accent)]" : "text-[var(--text-3)] group-hover:text-[var(--text-2)]"
                            }`}
                          />
                          <span className="text-[13.5px] font-mono uppercase tracking-wide">{item.label}</span>
                        </Link>
                        {"anchors" in group &&
                          isActive &&
                          (group as { anchors?: { href: string; label: string }[] }).anchors && (
                            <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-[var(--line)] pl-3">
                              {(group as { anchors: { href: string; label: string }[] }).anchors.map(
                                (a) => (
                                  <a
                                    key={a.href}
                                    href={a.href}
                                    className="block text-[12px] text-[var(--text-3)] hover:text-[var(--text-2)] py-1 transition-colors"
                                  >
                                    {a.label}
                                  </a>
                                )
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-[var(--line)] space-y-3">
          <SystemStatusLine />
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13.5px] font-medium text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-1)] transition-colors disabled:opacity-50"
          >
            <LogOut className="w-[17px] h-[17px] shrink-0" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
    </>
  );
}
