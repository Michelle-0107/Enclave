'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { getManagementReports, type ManagementReport } from '@/lib/api';
import { reportStatusLabels } from '@/lib/mock-reports';

export default function ManagementDashboard() {
  const [reports, setReports] = useState<ManagementReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const counts = {
    pending: reports.filter((item) => item.status === 'pending').length,
    approved: reports.filter((item) => item.status === 'approved').length,
    inProgress: reports.filter((item) => item.status === 'in_progress').length,
  };
  const attention = reports
    .filter((item) => ['pending', 'approved', 'in_progress'].includes(item.status))
    .slice(0, 5);
  const overview = [
    { value: counts.pending, label: 'Pending review', status: 'pending', color: 'text-status-orange' },
    { value: counts.approved, label: 'Approved', status: 'approved', color: 'text-muted-foreground' },
    { value: counts.inProgress, label: 'In progress', status: 'in_progress', color: 'text-muted-foreground' },
  ];

  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] leading-[1.45] font-semibold lg:text-[36px]">Your community.</h1>
      <p className="text-sm text-muted-foreground">Live counts from the management report API.</p>

      {error && (
        <div role="alert" className="rounded-2xl bg-status-red-bg p-4 text-sm text-status-red">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 font-semibold underline">Try again</button>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        {overview.map((item) => (
          <Link key={item.label} href={`/management/reports?status=${item.status}`} className="rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Card className="h-full rounded-3xl border-0 bg-card py-0 shadow-none transition-colors hover:bg-secondary/50">
              <CardContent className="flex flex-col gap-[14px] p-5">
                <p className={`text-[28px] leading-[1.45] font-semibold ${loading ? 'animate-pulse' : ''}`}>{loading ? '—' : item.value}</p>
                <p className={`text-sm ${item.color}`}>{item.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="mb-2 text-xl font-semibold">Needs your attention</h2>
        {loading ? (
          <p className="py-7 text-sm text-muted-foreground">Loading reports…</p>
        ) : attention.length === 0 ? (
          <p className="border-b py-7 text-sm text-muted-foreground">No reports need attention.</p>
        ) : (
          attention.map((item) => (
            <Link key={item.id} href={`/management/reports/${item.id}`} className="flex flex-col gap-2 border-b py-7 transition-colors hover:bg-secondary/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="text-xs text-status-orange sm:w-[218px] sm:shrink-0">{reportStatusLabels[item.status]}</p>
              </div>
              <p className="text-xs text-muted-foreground">#{item.id} · {item.location}</p>
            </Link>
          ))
        )}
      </section>

      <Link href="/management/reports" className="flex min-h-[52px] items-center justify-center rounded-2xl bg-secondary px-5 py-4 text-center text-sm font-semibold transition-colors hover:bg-secondary/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        View all reports
      </Link>
    </div>
  );
}
