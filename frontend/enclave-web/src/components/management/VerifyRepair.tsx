'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ManagementReport } from '@/lib/mock-reports';

type Props = {
  report: ManagementReport;
};

export default function VerifyRepair({ report }: Props) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="flex flex-col gap-7">
      <Link
        href={`/management/reports/${report.id}`}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary"
      >
        <ChevronLeft size={18} aria-hidden="true" />
        Report details
      </Link>

      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">
        Verify repair.
      </h1>

      <p className="text-sm text-muted-foreground">
        #{report.id} · Awaiting verification
      </p>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex min-h-[180px] flex-col justify-center gap-2.5 rounded-3xl bg-enclave-lavender p-5">
          <h2 className="text-sm font-semibold text-primary">
            Before / resident photo
          </h2>

          <p className="text-xs text-muted-foreground">
            Photo preview
          </p>
        </div>

        <div className="border-t border-border pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-5">
          <div className="flex min-h-[180px] flex-col justify-center gap-2.5 rounded-3xl bg-enclave-lavender p-5">
            <h2 className="text-sm font-semibold text-primary">
              After / maintenance photo
            </h2>

            <p className="text-xs text-muted-foreground">
              Photo preview
            </p>
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold text-primary">
          Completion notes
        </h2>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Repair completed and checked by the maintenance team.
          Submitted for management verification.
        </p>

        <p className="text-xs text-muted-foreground">
          Sample completion notes · Backend evidence pending
        </p>
      </section>

      <p className="text-sm leading-relaxed text-primary">
        Review the evidence and confirm the repair has been
        checked on site.
      </p>

      <div className="flex flex-col gap-3.5 sm:flex-row">
        <Button
          type="button"
          onClick={() => setPreview(true)}
          className="min-h-[52px] rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground sm:w-[280px]"
        >
          Mark resolved &amp; notify
        </Button>

        <Link
          href={`/management/reports/${report.id}/rework`}
          className="flex min-h-[52px] items-center justify-center rounded-2xl bg-status-red-bg px-6 text-center text-sm font-semibold text-status-red hover:opacity-80 sm:w-[280px]"
        >
          Request rework
        </Link>
      </div>

      {preview && (
        <div
          role="status"
          className="rounded-2xl border border-border bg-white p-5"
        >
          <p className="text-sm font-semibold text-primary">
            Resolution preview
          </p>

          <p className="mt-3 text-sm text-muted-foreground">
            #{report.id} · {report.title}
          </p>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Demo only. The report status, live map and
            notifications have not changed. Backend integration
            must require management verification before
            publishing the repair.
          </p>
        </div>
      )}
    </div>
  );
}