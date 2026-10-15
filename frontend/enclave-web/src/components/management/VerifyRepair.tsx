import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import type { ManagementReport } from '@/lib/mock-reports';

type Props = {
  report: ManagementReport;
};

export default function VerifyRepair({ report }: Props) {
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
        <Link
          href={`/management/reports/${report.id}/resolved`}
          className="flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 text-center text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-[280px]"
        >
          Mark resolved &amp; notify
        </Link>

        <Link
          href={`/management/reports/${report.id}/rework`}
          className="flex min-h-[52px] items-center justify-center rounded-2xl bg-status-red-bg px-6 text-center text-sm font-semibold text-status-red hover:opacity-80 sm:w-[280px]"
        >
          Request rework
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Demo navigation only. Resolving a report and sending
        notifications require backend integration.
      </p>
    </div>
  );
}