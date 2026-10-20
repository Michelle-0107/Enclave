'use client';

import Link from 'next/link';
import { Mail, ClipboardList, Route, UserPlus, ArrowUpRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getManagementReports, type ManagementReport } from '@/lib/api';
import { reportStatusLabels } from '@/lib/mock-reports';
import { reportStatuses, reportTones, tones } from '@/lib/report-presentation';
import { ReportStatusBadge, PriorityBadge } from '@/components/ui/ReportBadges';
import ReportThumbnail from '@/components/management/ReportThumbnail';

export default function ManagementDashboard() {
  const [reports, setReports] = useState<ManagementReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setReports(await getManagementReports()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load reports.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    getManagementReports().then(items => { if (active) setReports(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load reports.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const updates = [...reports].sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0)).slice(0, 5);
  function nextStep(item: ManagementReport) {
    return item.status === 'pending' ? 'Review report' : item.status === 'approved' ? 'Check task assignment' : item.status === 'in_progress' ? 'Check repair progress' : 'View report';
  }
  function reportRows(items: ManagementReport[], empty: string) {
    return <div className="report-list">
      {loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading reports…</p> : !items.length ? <p className="py-6 text-sm text-muted-foreground">{empty}</p> : items.map(item => <Link key={item.id} href={`/management/reports/${encodeURIComponent(item.id)}`} className="report-list-row">
        <ReportThumbnail imageUrl={item.imageUrl} title={item.title} />
        <span className="report-row-main">
          <span className="report-row-status"><ReportStatusBadge status={item.status} variant="text" /></span>
          <span className="report-row-copy">
            <span className="line-clamp-2 text-sm font-semibold">{item.title}</span>
            <span className="line-clamp-1 text-xs text-muted-foreground">{item.location}</span>
            <span className="text-xs font-semibold">{nextStep(item)} →</span>
          </span>
        </span>
        <span className="report-row-trailing"><PriorityBadge priority={item.priority} prominent /><ArrowUpRight size={18} className="report-row-arrow shrink-0 text-muted-foreground" aria-hidden="true" /></span>
      </Link>)}
    </div>;
  }
  return <div className="flex flex-col gap-7">
    <div><h1 className="font-semibold">Your community.</h1><p className="mt-3 text-sm text-muted-foreground">KL East · Reports and repairs at a glance.</p></div>
    {error && <div role="alert" className="rounded-2xl bg-status-red-bg p-4 text-sm text-status-red"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-3 min-h-11 font-semibold underline">Try again</button></div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">{reportStatuses.map(status => <Link key={status} href={`/management/reports?status=${status}`} style={tones[reportTones[status]]} className="dashboard-status-card min-h-[124px] rounded-3xl p-5 focus-visible:outline-2 focus-visible:outline-ring"><p className="relative z-10 text-[28px] font-semibold">{loading || error ? '—' : reports.filter(report => report.status === status).length}</p><p className="relative z-10 mt-3 text-sm font-semibold">{reportStatusLabels[status]}</p></Link>)}</div>
    <section aria-labelledby="quick-heading"><h2 id="quick-heading" className="mb-4 text-lg font-semibold">Quick access</h2><div className="quick-access">
      <Link href="/management/reports"><ClipboardList size={23} aria-hidden="true" /><span className="font-semibold">View reports</span><span className="hidden text-xs text-muted-foreground sm:block">Review incoming issues</span></Link>
      <Link href="/management/what-if"><Route size={23} aria-hidden="true" /><span className="font-semibold">Repair what-if</span><span className="hidden text-xs text-muted-foreground sm:block">Compare repair plans</span></Link>
      <Link href="/management/residents/new"><UserPlus size={23} aria-hidden="true" /><span className="font-semibold">Add resident</span><span className="hidden text-xs text-muted-foreground sm:block">Register a verified resident</span></Link>
    </div></section>
    <section aria-labelledby="updates-heading"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="updates-heading" className="text-lg font-semibold">Recent reports</h2><Link href="/management/reports" className="text-xs font-semibold hover:underline">View all</Link></div>{reportRows(updates, 'No reports yet.')}</section>
    <Link href="/management/notifications" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold"><Mail size={18} aria-hidden="true" /> Open Message Centre</Link>
  </div>;
}
