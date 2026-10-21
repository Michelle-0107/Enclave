'use client';

import AccountSettings from '@/components/account/AccountSettings';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export default function Account() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  function handleSignOut() {
    signOut();
    setConfirmSignOut(false);
    router.replace('/sign-in');
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold leading-tight text-primary lg:text-4xl">My account</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Manage your profile, password, and security preferences.
        </p>
      </header>

      <section aria-label="Profile settings" className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <AccountSettings />
      </section>

      <section aria-labelledby="work-email-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 id="work-email-heading" className="text-base font-semibold text-primary">Work email</h2>
        <p className="mt-2 break-words text-sm text-muted-foreground">{user?.email ?? 'Email unavailable'}</p>
      </section>

      <section aria-labelledby="support-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 id="support-heading" className="text-base font-semibold text-primary">Help &amp; support</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Contact your workspace administrator for access or account changes.
        </p>
      </section>

      <Button
        type="button"
        variant="destructive"
        onClick={() => setConfirmSignOut(true)}
        className="min-h-11 w-fit rounded-xl px-5 lg:hidden"
      >
        Log out
      </Button>
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
