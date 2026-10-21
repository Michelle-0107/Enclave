"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMaintenance } from "@/components/maintenance/MaintenanceProvider";
import EnclaveLogo from '@/components/ui/EnclaveLogo';
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ClipboardList, History, LogOut, UserRound } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import StaffProfile from './StaffProfile';
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PortalSessionSkeleton from "./PortalSessionSkeleton";

const navigation = [
  { label: "My tasks", href: "/maintenance", icon: ClipboardList },
  { label: "Notifications", href: "/maintenance/notifications", icon: Bell },
  { label: "Activity logs", href: "/maintenance/activity-logs", icon: History },
  { label: "Account", href: "/maintenance/account", icon: UserRound },
];

type Props = {
  children: ReactNode;
};

export default function MaintenanceLayout({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { onSignOut, displayName } = useMaintenance();
  const auth = useAuth();
  const [logoutError, setLogoutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useEffect(() => {
    if (auth.ready && !auth.user && !auth.error) router.replace("/sign-in");
    if (auth.ready && auth.user && auth.role === "management") router.replace("/management");
  }, [auth.ready, auth.user, auth.role, auth.error, router]);

  if (auth.error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p role="alert" className="max-w-xl text-sm text-status-red">{auth.error}</p>
        <button
          type="button"
          onClick={() => router.replace("/sign-in")}
          className="min-h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-primary-foreground"
        >
          Return to sign in
        </button>
      </main>
    );
  }

  if (!auth.ready || !auth.user || auth.role !== "maintenance") {
    return <PortalSessionSkeleton role="maintenance" pathname={pathname} />;
  }

  async function logout() {
    setSigningOut(true);
    try {
      if (onSignOut) await onSignOut();
      else auth.signOut();
      router.replace("/sign-in");
    } catch {
      setLogoutError("Unable to sign out. Please try again.");
      setSigningOut(false);
    }
  }

  function isSelected(href: string) {
    if (href === "/maintenance") {
      return pathname === href || pathname.startsWith("/maintenance/tasks/");
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="portal-shell min-h-dvh bg-background text-foreground" data-role="maintenance">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] bg-card p-4 lg:flex lg:flex-col">
        <div className="shrink-0">
          <Link
            href="/maintenance"
            className="flex min-h-11 items-center gap-3"
            aria-label="Enclave maintenance dashboard"
          >
            <EnclaveLogo className="h-[29px] w-6" />

            <span className="text-[23px] font-bold tracking-[5px] text-[#526B8A]">ENCLAVE</span>
          </Link>

          <Link href="/maintenance/account" className="mt-8 block rounded-xl focus-visible:outline-2 focus-visible:outline-ring"><StaffProfile role="maintenance" name={displayName} /></Link>
        </div>

        <nav
          aria-label="Maintenance navigation"
          className="mt-9 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
        >
          {navigation.filter(item => item.href !== '/maintenance/account').map((item) => {
            const selected = isSelected(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={selected ? "page" : undefined}
                className={[
                  "flex min-h-[52px] items-center gap-[14px]",
                  "rounded-2xl px-4 text-sm font-semibold",
                  "transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2",
                  "focus-visible:outline-ring",
                  selected
                    ? "bg-brand text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                ].join(" ")}
              >
                <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto shrink-0 space-y-2 border-t border-border pt-3">
          <Link
            href="/maintenance/account"
            aria-current={isSelected('/maintenance/account') ? 'page' : undefined}
            className={[
              'flex min-h-[52px] items-center gap-[14px] rounded-2xl px-4 text-sm font-semibold transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              isSelected('/maintenance/account') ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            ].join(' ')}
          >
            <UserRound size={24} strokeWidth={1.7} aria-hidden="true" />
            Account
          </Link>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => setConfirmSignOut(true)}
            title="Log out"
            className="flex min-h-[52px] w-full items-center gap-[14px] rounded-2xl px-4 text-sm font-semibold text-status-red transition-colors hover:bg-status-red-bg hover:text-status-red focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            <LogOut size={24} strokeWidth={1.7} aria-hidden="true" />
            Log out
          </button>
          {logoutError && (
            <p role="alert" className="px-4 text-xs text-status-red">
              {logoutError}
            </p>
          )}
        </div>
      </aside>

      {/* Workspace */}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex min-h-[90px] items-center justify-between gap-3 bg-background/95 px-6 py-5 backdrop-blur lg:px-10 lg:py-6">
          <p className="portal-title text-[24px] leading-tight font-semibold lg:text-[32px]">Maintenance Portal</p>
          <Link href="/maintenance/account" aria-label="Open maintenance account" className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-ring"><StaffProfile role="maintenance" name={displayName} compact /></Link>
        </header>

        <main className="portal-workspace min-w-0 px-6 pt-6 pb-[calc(112px+env(safe-area-inset-bottom))] lg:px-10 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile navigation */}
      <nav
        aria-label="Maintenance mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t bg-card px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-2">
          {navigation.map((item) => {
            const selected = isSelected(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={selected ? "page" : undefined}
                title={item.label}
                className={[
                  "flex min-h-12 items-center justify-center",
                  "rounded-2xl transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2",
                  "focus-visible:outline-ring",
                  selected
                    ? "bg-brand text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary",
                ].join(" ")}
              >
                <Icon size={24} strokeWidth={1.7} aria-hidden="true" />

                <span className="sr-only">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <ConfirmDialog
        open={confirmSignOut}
        title="Confirm log out"
        description="Are you sure you want to log out of your maintenance account?"
        confirmLabel="Log out"
        destructive
        busy={signingOut}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => void logout()}
      />
    </div>
  );
}
