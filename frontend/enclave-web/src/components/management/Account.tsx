'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

export default function Account() {
  const [showNotice, setShowNotice] = useState(false);

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
          Community Manager
        </h2>

        <p className="text-sm text-muted-foreground">
          Setia Eco Park · Management
        </p>
      </section>

      <dl className="flex flex-col gap-7 border-b border-border pb-7">
        <dt className="text-sm font-semibold text-primary">
          Work email
        </dt>

        <dd className="break-words text-sm text-muted-foreground">
          manager@enclave.example
        </dd>
      </dl>

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
        onClick={() => setShowNotice(true)}
        className="min-h-[52px] w-full rounded-2xl bg-enclave-lavender px-6 text-sm font-semibold text-primary hover:bg-enclave-lavender hover:opacity-80"
      >
        Log out
      </Button>

      {showNotice && (
        <p
          role="status"
          className="text-sm leading-relaxed text-muted-foreground"
        >
          Demo only. Authentication is not connected, so
          there is no active session to sign out of.
        </p>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Sample staff profile. Account details will come from
        the authenticated user after backend integration.
      </p>
    </div>
  );
}