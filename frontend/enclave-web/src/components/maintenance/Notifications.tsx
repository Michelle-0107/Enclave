'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Clock3, RefreshCw, Search, Wrench } from 'lucide-react';
import { DataSkeleton } from '@/components/ui/DataSkeleton';
import { getStaffNotifications, markStaffNotificationRead, type StaffNotice } from '@/lib/maintenance/api';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

export default function Notifications() {
  const [items, setItems] = useState<StaffNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const router = useRouter();
  const alive = useRef(true);
  const openLock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const notices = await getStaffNotifications(); if (alive.current) setItems(notices); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Unable to load task updates.'); }
    finally { if (alive.current) setLoading(false); }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    return () => { alive.current = false; window.removeEventListener('focus', refresh); };
  }, [load]);

  const unreadCount = items.filter(item => !item.is_read).length;
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(item => (filter === 'all' || !item.is_read) && (!query || `${item.title} ${item.message} ${item.task_id}`.toLowerCase().includes(query)));
  }, [items, search, filter]);

  async function open(notice: StaffNotice) {
    if (openLock.current) return;
    openLock.current = true; setOpening(notice.id); setError('');
    try {
      if (!notice.is_read) await markStaffNotificationRead(notice.id);
      if (!alive.current) return;
      setItems(current => current.map(item => item.id === notice.id ? { ...item, is_read: true } : item));
      router.push(`/maintenance/tasks/${encodeURIComponent(notice.task_id)}`);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Unable to open this task update.'); }
    finally { openLock.current = false; if (alive.current) setOpening(null); }
  }

  return <section className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-[30px] font-semibold leading-tight lg:text-[36px]">Task updates</h1>
        <p className="mt-2 text-sm text-muted-foreground">Reports assigned to you and updates from management.</p></div>
      <button type="button" disabled={loading} onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-secondary disabled:opacity-50"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
    </div>

    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex gap-5" aria-label="Task update filters">
          {(['all', 'unread'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-10 border-b-2 px-1 text-sm font-semibold ${filter === value ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {value === 'all' ? `All updates (${items.length})` : `Unread (${unreadCount})`}
          </button>)}
        </div>
        <label className="relative w-full sm:max-w-sm"><span className="sr-only">Search task updates</span><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search task updates" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
      </div>

      {error && <p role="alert" className="m-5 rounded-xl bg-status-red-bg p-3 text-sm text-status-red">{error}</p>}
      {loading ? <div className="p-5"><DataSkeleton rows={3} variant="card" /></div> : visibleItems.length ? <div className="grid gap-3 p-4 sm:p-5">
        {visibleItems.map(notice => <article key={notice.id} className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-background p-4 sm:flex-row sm:p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-md bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800"><Wrench size={13} aria-hidden="true" /> Maintenance task</span>{!notice.is_read && <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand"><Bell size={13} aria-hidden="true" /> New</span>}</div>
            <h2 className="mt-3 text-base font-semibold">{notice.title}</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{notice.message}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>Task {notice.task_id}</span><time className="inline-flex items-center gap-1" dateTime={notice.created_at}><Clock3 size={14} aria-hidden="true" />{dateLabel(notice.created_at)}</time>{notice.is_read && <span className="inline-flex items-center gap-1"><CheckCheck size={14} aria-hidden="true" /> Read</span>}</div>
          </div>
          <button type="button" disabled={opening !== null} onClick={() => void open(notice)} className="min-h-10 shrink-0 self-start rounded-lg border border-border bg-secondary/50 px-4 text-sm font-semibold text-brand hover:bg-secondary disabled:opacity-50">{opening === notice.id ? 'Opening…' : 'Open task →'}</button>
        </article>)}
      </div> : <div className="flex flex-col items-center px-5 py-14 text-center"><Bell size={28} className="text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 font-semibold">{filter === 'unread' ? 'You’re all caught up' : 'No task updates yet'}</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">{filter === 'unread' ? 'There are no unread updates assigned to you.' : 'New assignments and management feedback will appear here.'}</p></div>}
    </div>
  </section>;
}
