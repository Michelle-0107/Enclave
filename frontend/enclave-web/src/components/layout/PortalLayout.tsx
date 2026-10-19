'use client';

import type { ReactNode } from 'react';
import EnclaveLogo from '@/components/ui/EnclaveLogo';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Mail,
  ClipboardList,
  ChevronLeft,
  House,
  LogOut,
  UserRound,
  UsersRound,
  Route,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import StaffProfile from './StaffProfile';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

const navigation = [
  {
    label: 'Dashboard',
    href: '/management',
    icon: House,
  },
  {
    label: 'Reports',
    href: '/management/reports',
    icon: ClipboardList,
  },
  {
    label: 'Repair what-if',
    href: '/management/what-if',
    icon: Route,
  },
  {
    label: 'Message Centre',
    href: '/management/notifications',
    icon: Mail,
  },
  {
    label: 'Residents',
    href: '/management/residents',
    icon: UsersRound,
  },
  {
    label: 'Account',
    href: '/management/account',
    icon: UserRound,
  },
];

type Props = {
  children: ReactNode;
};

export default function PortalLayout({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, displayName, role, ready, error, signOut } = useAuth();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (ready && !user && !error) router.replace('/sign-in');
    if (ready && user && role === 'maintenance') router.replace('/maintenance');
  }, [ready, user, role, error, router]);

  if (!ready || (!user && !error) || (user && role !== 'management')) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-sm text-muted-foreground">
        Checking your Enclave session…
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p role="alert" className="max-w-xl text-sm text-status-red">{error}</p>
        <button
          type="button"
          onClick={() => router.replace('/sign-in')}
          className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Return to sign in
        </button>
      </main>
    );
  }

  function handleSignOut() {
    signOut();
    setConfirmSignOut(false);
    router.replace('/sign-in');
  }

  function isSelected(href: string) {
    if (href === '/management') {
      return pathname === href;
    }

    return (
      pathname === href ||
      pathname.startsWith(`${href}/`)
    );
  }

  const isReportDetail = pathname.startsWith('/management/reports/') && pathname !== '/management/reports';

  return (
    <div className="portal-shell min-h-dvh bg-background text-foreground" data-role="management">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] overflow-y-auto bg-card p-4 lg:block">
        <Link
          href="/management"
          className="flex min-h-11 items-center gap-3"
          aria-label="Enclave management dashboard"
        >
          <EnclaveLogo className="h-[29px] w-6" />

          <span className="text-[23px] font-bold tracking-[5px] text-[#526B8A]">
            ENCLAVE
          </span>
        </Link>

        <Link href="/management/account" className="mt-8 block rounded-xl focus-visible:outline-2 focus-visible:outline-ring"><StaffProfile role="management" name={displayName} /></Link>

        <nav
          aria-label="Management navigation"
          className="mt-9 flex flex-col gap-3"
        >
          {navigation.map((item) => {
            const selected = isSelected(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={selected ? 'page' : undefined}
                className={[
                  'flex min-h-[52px] items-center gap-[14px]',
                  'rounded-2xl px-4 text-sm font-semibold',
                  'transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  'focus-visible:outline-ring',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                ].join(' ')}
              >
                <Icon
                  size={24}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setConfirmSignOut(true)}
          className="mt-9 flex min-h-[52px] w-full items-center gap-[14px] rounded-2xl px-4 text-sm font-semibold text-muted-foreground hover:bg-secondary"
        >
          <LogOut size={24} strokeWidth={1.7} />
          Log out
        </button>
      </aside>

      {/* Workspace */}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex min-h-[90px] items-center justify-between gap-3 bg-background/95 px-6 py-5 backdrop-blur lg:px-10 lg:py-6">
          <p className="portal-title text-[24px] leading-tight font-semibold lg:text-[32px]">Management Portal</p>
          <Link href="/management/account" aria-label="Open management account" className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-ring"><StaffProfile role="management" name={displayName} compact /></Link>
        </header>
        {isReportDetail && <Link href="/management/reports" className="mx-6 inline-flex min-h-11 items-center gap-1 text-sm font-semibold lg:mx-10"><ChevronLeft size={18} aria-hidden="true" /> Reports</Link>}

        <main className="portal-workspace min-w-0 px-6 pt-6 pb-[calc(112px+env(safe-area-inset-bottom))] lg:px-10 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile navigation */}
      <nav
        aria-label="Management mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t bg-card px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-6 gap-2">
          {navigation.map((item) => {
            const selected = isSelected(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={selected ? 'page' : undefined}
                title={item.label}
                className={[
                  'flex min-h-12 items-center justify-center',
                  'rounded-2xl transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  'focus-visible:outline-ring',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary',
                ].join(' ')}
              >
                <Icon
                  size={24}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />

                <span className="sr-only">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
      <ConfirmDialog
        open={confirmSignOut}
        title="Confirm log out"
        description="Are you sure you want to log out of your management account?"
        confirmLabel="Log out"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={handleSignOut}
      />
    </div>
  );
}
