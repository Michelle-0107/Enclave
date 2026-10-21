'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { ReportStatusBadge, PriorityBadge } from '@/components/ui/ReportBadges';
import ReportThumbnail from '@/components/management/ReportThumbnail';
import { Label } from '@/components/ui/label';
import { DataSkeleton } from '@/components/ui/DataSkeleton';
import { getManagementReports, type ManagementReport } from '@/lib/api';

import {
  reportStatusLabels,
  type ManagementReportStatus,
} from '@/lib/mock-reports';

type Props = {
  initialStatus?: string;
};

const statusOptions: ManagementReportStatus[] = [
  'pending',
  'approved',
  'rejected',
  'in_progress',
  'resolved',
];

export default function ReportsList({
  initialStatus = 'all',
}: Props) {
  const [reports, setReports] = useState<ManagementReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [status, setStatus] = useState(
    statusOptions.includes(
      initialStatus.replace('-', '_') as ManagementReportStatus,
    )
      ? initialStatus.replace('-', '_')
      : 'all',
  );

  const [priority, setPriority] = useState('all');

  const query = search.trim().toLowerCase();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReports(await getManagementReports());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getManagementReports()
      .then((items) => { if (active) setReports(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load reports.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

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
        Review incoming issues and follow their repair progress.
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

      <div className="report-list">
        {error ? (
          <div role="alert" className="border-b py-8 text-sm text-status-red">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-3 font-semibold underline">Try again</button>
          </div>
        ) : loading ? (
          <DataSkeleton rows={4} variant="report" />
        ) : filteredReports.length === 0 ? (
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
              href={`/management/reports/${encodeURIComponent(report.id)}`}
              className="report-list-row"
            >
              <ReportThumbnail imageUrl={report.imageUrl} title={report.title} />
              <div className="report-row-main">
                <div className="report-row-status"><ReportStatusBadge status={report.status} variant="text" /></div>
                <div className="report-row-copy">
                  <h2 className="line-clamp-2 text-sm font-semibold sm:text-lg">{report.title}</h2>
                  <p className="text-xs text-muted-foreground">#{report.id} · {report.location} · {report.category}</p>
                </div>
              </div>
              <div className="report-row-trailing"><PriorityBadge priority={report.priority} prominent /></div>
            </Link>
          ))
        )}
      </div>

      {!loading && !error && <p className="text-xs text-muted-foreground">Showing {filteredReports.length} of {reports.length} live reports.</p>}
    </div>
  );
}
