'use client';

import AccountSettings from '@/components/account/AccountSettings';
import Link from 'next/link';
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
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">
        My account.
      </h1>

      <p className="text-sm leading-relaxed text-muted-foreground">
        Your management workspace.
      </p>

      <section
        aria-label="Staff profile"
        className="flex flex-col gap-3.5 rounded-3xl bg-enclave-lavender p-5"
      >
        <h2 className="text-[22px] font-semibold text-primary">
          Enclave management account
        </h2>

        <p className="text-sm text-muted-foreground">
          Management access is verified by the backend for each protected action.
        </p>
      </section>

      <AccountSettings />
      <dl className="flex flex-col gap-7 border-b border-border pb-7">
        <dt className="text-sm font-semibold text-primary">
          Work email
        </dt>

        <dd className="break-words text-sm text-muted-foreground">
          {user?.email ?? 'Email unavailable'}
        </dd>
      </dl>

      <Link href="/management/activity-logs" className="flex min-h-12 items-center justify-between rounded-2xl border bg-white px-5 font-semibold">Activity logs <span aria-hidden="true">→</span></Link>
      <section className="flex flex-col gap-7">
        <h2 className="text-base font-semibold text-primary">
          Help &amp; support
        </h2>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Contact your workspace administrator for access or
          account changes.
        </p>
      </section>

      <Button
        type="button"
        onClick={() => setConfirmSignOut(true)}
        className="min-h-[52px] w-full rounded-2xl bg-enclave-lavender px-6 text-sm font-semibold text-primary hover:bg-enclave-lavender hover:opacity-80"
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
