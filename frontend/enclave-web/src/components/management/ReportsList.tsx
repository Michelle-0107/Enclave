'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  reportStatusLabels,
  type ManagementReport,
  type ManagementReportStatus,
} from '@/lib/mock-reports';

type Props = {
  reports: ManagementReport[];
  initialStatus?: string;
};

const statusOptions: ManagementReportStatus[] = [
  'pending',
  'approved',
  'in-progress',
  'awaiting-verification',
  'resolved',
  'needs-information',
];

function getStatusColor(status: ManagementReportStatus) {
  if (status === 'approved' || status === 'resolved') {
    return 'text-status-green';
  }

  if (status === 'needs-information') {
    return 'text-status-red';
  }

  return 'text-status-orange';
}

export default function ReportsList({
  reports,
  initialStatus = 'all',
}: Props) {
  const [search, setSearch] = useState('');

  const [status, setStatus] = useState(
    statusOptions.includes(
      initialStatus as ManagementReportStatus,
    )
      ? initialStatus
      : 'all',
  );

  const [priority, setPriority] = useState('all');

  const query = search.trim().toLowerCase();

  const filteredReports = reports.filter((report) => {
    const matchesSearch =
      !query ||
      [
        report.id,
        report.title,
        report.location,
      ].some((value) =>
        value.toLowerCase().includes(query),
      );

    const matchesStatus =
      status === 'all' || report.status === status;

    const matchesPriority =
      priority === 'all' || report.priority === priority;

    return (
      matchesSearch &&
      matchesStatus &&
      matchesPriority
    );
  });

  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] leading-[1.45] font-semibold lg:text-[36px]">
        Community reports.
      </h1>

      <p className="text-sm text-muted-foreground">
        Review, assign and follow each repair.
      </p>

      <div className="flex flex-col gap-2">
        <Label
          htmlFor="report-search"
          className="text-sm font-semibold"
        >
          Search reports
        </Label>

        <Input
          id="report-search"
          type="search"
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Search ID, issue or location"
          className="h-[54px] rounded-2xl bg-card px-4 text-sm shadow-none"
        />
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="flex w-full flex-col gap-[6px] sm:w-[180px]">
          <Label
            htmlFor="report-status"
            className="text-xs font-semibold text-muted-foreground"
          >
            Status
          </Label>

          <select
            id="report-status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value)
            }
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All statuses</option>

            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {reportStatusLabels[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex w-full flex-col gap-[6px] sm:w-[180px]">
          <Label
            htmlFor="report-priority"
            className="text-xs font-semibold text-muted-foreground"
          >
            Priority
          </Label>

          <select
            id="report-priority"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value)
            }
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All priorities</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      <div>
        {filteredReports.length === 0 ? (
          <div
            role="status"
            className="border-b py-8"
          >
            <p className="text-lg font-semibold">
              No matching reports.
            </p>

            <p className="mt-2 text-sm text-muted-foreground">
              Try another search or change the filters.
            </p>
          </div>
        ) : (
          filteredReports.map((report) => (
            <Link
              key={report.id}
              href={`/management/reports/${report.id}`}
              className="flex flex-col gap-2 border-b py-7 first:pt-0 transition-colors hover:bg-secondary/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                <h2 className="text-lg font-semibold">
                  {report.title}
                </h2>

                <p
                  className={[
                    'text-xs sm:w-[218px] sm:shrink-0',
                    getStatusColor(report.status),
                  ].join(' ')}
                >
                  {reportStatusLabels[report.status]}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                #{report.id} · {report.location}
              </p>
            </Link>
          ))
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Sample reports for design preview.
      </p>
    </div>
  );
}