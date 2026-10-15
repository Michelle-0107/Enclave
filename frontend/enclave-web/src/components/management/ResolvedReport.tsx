import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import type { ManagementReport } from '@/lib/mock-reports';

type Props = {
  report: ManagementReport;
  preview?: boolean;
};

export default function ResolvedReport({
  report,
  preview = true,
}: Props) {
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
        {preview ? 'Repair verified — preview.' : 'Repair verified.'}
      </h1>

      <p className="text-sm leading-relaxed text-muted-foreground">
        #{report.id} · {report.title}
      </p>

      <section className="flex flex-col gap-3.5 rounded-3xl bg-status-green-bg p-5">
        <h2 className="text-2xl font-semibold text-status-green">
          {preview ? 'Resolved · Demo preview' : 'Resolved'}
        </h2>

        <p className="text-sm leading-relaxed text-primary">
          {preview
            ? 'This previews the confirmation shown after management verifies a repair.'
            : 'The repair was verified by management.'}
        </p>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {preview
            ? 'No report status, map data or notifications have been updated.'
            : 'The report is marked as resolved.'}
        </p>
      </section>

      <Link
        href="/management/reports"
        className="flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Back to reports
      </Link>
    </div>
  );
}