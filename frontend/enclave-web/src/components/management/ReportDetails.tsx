'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { Label } from '@/components/ui/label';
import {
  type ManagementReport,
  reportStatusLabels,
} from '@/lib/mock-reports';

type Props = {
  report: ManagementReport;
};

export default function ReportDetails({ report }: Props) {
  const [category, setCategory] = useState(report.category);
  const [priority, setPriority] = useState(report.priority);

  const actionQuery = new URLSearchParams({
    category,
    priority,
  }).toString();

  const basePath = `/management/reports/${report.id}`;

  const statusColor =
    report.status === 'resolved'
      ? 'bg-status-green-bg text-status-green'
      : 'bg-status-orange-bg text-status-orange';

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/management/reports"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary"
      >
        <ChevronLeft size={18} aria-hidden="true" />
        Reports
      </Link>

      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">
        {report.title}
      </h1>

      <p className="text-sm leading-relaxed text-muted-foreground">
        #{report.id} · Submitted {report.submittedAt}
      </p>

      <div
        className={`inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs ${statusColor}`}
      >
        <span
          className="size-1.5 rounded-full bg-current"
          aria-hidden="true"
        />

        {reportStatusLabels[report.status]}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-5">
        <section
          aria-label="Issue evidence"
          className="flex min-w-0 flex-col gap-5"
        >
          <div className="flex min-h-[180px] flex-col justify-center gap-2.5 rounded-3xl bg-enclave-lavender p-5">
            <p className="text-sm font-semibold text-primary">
              Resident photo
            </p>

            <p className="text-xs text-muted-foreground">
              Photo preview
            </p>
          </div>

          <h2 className="text-base font-semibold text-primary">
            {report.location}
          </h2>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {report.description}
          </p>
        </section>

        <section
          aria-label="Review decision"
          className="flex min-w-0 flex-col gap-5 border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5"
        >
          <div className="flex flex-col gap-3.5 rounded-3xl bg-enclave-lavender p-5">
            <h2 className="text-lg font-semibold text-primary">
              AI recommendation
            </h2>

            <p className="text-sm font-semibold text-primary">
              {report.category} · {report.priority} priority
            </p>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Review and edit the suggested category and priority
              before approving.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="final-category"
              className="text-sm font-semibold"
            >
              Final category
            </Label>

            <select
              id="final-category"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value)
              }
              className="min-h-[54px] w-full rounded-2xl border border-input bg-white px-4 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="Streetlight">Streetlight</option>
              <option value="Accessibility">Accessibility</option>
              <option value="Facility">Facility</option>
              <option value="Walkway">Walkway</option>
              <option value="Drainage">Drainage</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="final-priority"
              className="text-sm font-semibold"
            >
              Final priority
            </Label>

            <select
              id="final-priority"
              value={priority}
              onChange={(event) =>
                setPriority(
                  event.target.value as ManagementReport['priority'],
                )
              }
              className="min-h-[54px] w-full rounded-2xl border border-input bg-white px-4 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            AI suggestions are sample data until backend
            integration is connected.
          </p>
        </section>
      </div>

      {report.status === 'awaiting-verification' && (
  <Link
    href={`${basePath}/verify`}
    className="flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground sm:w-[280px]"
  >
    Verify repair
  </Link>
)}

      {report.category === 'Accessibility' && (
        <Link
          href={`${basePath}/comparison`}
          className="mt-1 flex min-h-[52px] items-center justify-center rounded-2xl bg-enclave-lavender px-6 text-center text-sm font-semibold text-primary transition-opacity hover:opacity-80 sm:w-[280px]"
        >
          Compare repair options
        </Link>
      )}

      <div className="mt-1 flex flex-col gap-3.5 sm:flex-row">
        <Link
          href={`${basePath}/assign?${actionQuery}`}
          className="flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-[280px]"
        >
          Approve &amp; assign
        </Link>

        <Link
          href={`${basePath}/request-information`}
          className="flex min-h-[52px] items-center justify-center rounded-2xl bg-status-orange-bg px-6 text-center text-sm font-semibold text-status-orange transition-opacity hover:opacity-80 sm:w-[280px]"
        >
          Request information
        </Link>
      </div>

      <Link
        href={`${basePath}/reject`}
        className="flex min-h-[52px] items-center justify-center rounded-2xl bg-status-red-bg px-6 text-center text-sm font-semibold text-status-red transition-opacity hover:opacity-80 sm:w-[280px]"
      >
        Reject report
      </Link>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Demo report. Changes have not been saved to the backend.
      </p>
    </div>
  );
}