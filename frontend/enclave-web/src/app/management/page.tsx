'use client';

import Link from 'next/link';
import { Bell, ClipboardList, Route, UserPlus, ArrowUpRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getManagementReports, type ManagementReport } from '@/lib/api';
import { reportStatusLabels } from '@/lib/mock-reports';

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
  const overview = [
    { label: 'Pending review', status: 'pending', bg: 'bg-[#FFF1DA]' },
    { label: 'Approved', status: 'approved', bg: 'bg-[#E9E7F1]' },
    { label: 'In progress', status: 'in_progress', bg: 'bg-[#E3F1E9]' },
  ];
  const attention = reports.filter(item => ['pending', 'approved', 'in_progress'].includes(item.status)).slice(0, 3);
  const updates = [...reports].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, 2);
  function nextStep(item: ManagementReport) {
    return item.status === 'pending' ? 'Review report' : item.status === 'approved' ? 'Check task assignment' : item.status === 'in_progress' ? 'Check repair progress' : 'View report';
  }
  function reportRows(items: ManagementReport[], empty: string) {
    return <div className="divide-y rounded-3xl border border-border bg-card px-5">
      {loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading reports…</p> : !items.length ? <p className="py-6 text-sm text-muted-foreground">{empty}</p> : items.map(item => <Link key={item.id} href={`/management/reports/${encodeURIComponent(item.id)}`} className="flex min-w-0 items-center gap-4 py-5 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={`text-[11px] font-semibold ${item.status === 'resolved' ? 'text-status-green' : item.status === 'rejected' ? 'text-status-red' : 'text-status-orange'}`}>{reportStatusLabels[item.status]}</span>
          <span className="line-clamp-2 text-sm font-semibold">{item.title}</span>
          <span className="line-clamp-1 text-xs text-muted-foreground">{item.location}</span>
          <span className="text-xs font-semibold">{nextStep(item)} →</span>
        </span><ArrowUpRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>)}
    </div>;
  }
  return <div className="flex flex-col gap-7">
    <div><h1 className="font-semibold">Your community.</h1><p className="mt-3 text-sm text-muted-foreground">KL East · Reports and repairs at a glance.</p></div>
    {error && <div role="alert" className="rounded-2xl bg-status-red-bg p-4 text-sm text-status-red"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-3 min-h-11 font-semibold underline">Try again</button></div>}
    <div className="grid grid-cols-3 gap-3 lg:gap-5">{overview.map(item => <Link key={item.status} href={`/management/reports?status=${item.status}`} className={`rounded-3xl p-4 focus-visible:outline-2 focus-visible:outline-ring lg:p-5 ${item.bg}`}><p className="text-[28px] font-semibold">{loading || error ? '—' : reports.filter(report => report.status === item.status).length}</p><p className="mt-3 text-xs text-muted-foreground">{item.label}</p></Link>)}</div>
    <section aria-labelledby="quick-heading"><h2 id="quick-heading" className="mb-4 text-lg font-semibold">Quick access</h2><div className="quick-access">
      <Link href="/management/reports"><ClipboardList size={23} aria-hidden="true" /><span className="font-semibold">View reports</span><span className="hidden text-xs text-muted-foreground sm:block">Review incoming issues</span></Link>
      <Link href="/management/what-if"><Route size={23} aria-hidden="true" /><span className="font-semibold">Repair what-if</span><span className="hidden text-xs text-muted-foreground sm:block">Compare repair plans</span></Link>
      <Link href="/management/residents/new"><UserPlus size={23} aria-hidden="true" /><span className="font-semibold">Add resident</span><span className="hidden text-xs text-muted-foreground sm:block">Register a verified resident</span></Link>
    </div></section>
    <section aria-labelledby="attention-heading"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="attention-heading" className="text-lg font-semibold">Needs your attention</h2><Link href="/management/reports" className="text-xs font-semibold underline-offset-4 hover:underline">View all</Link></div>{reportRows(attention, 'No reports need attention.')}</section>
    <section aria-labelledby="updates-heading"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="updates-heading" className="text-lg font-semibold">Recent reports</h2><Link href="/management/reports" className="text-xs font-semibold hover:underline">View all</Link></div>{reportRows(updates, 'No reports yet.')}</section>
    <Link href="/management/notifications" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold"><Bell size={18} aria-hidden="true" /> Publish a community update</Link>
  </div>;
}
