'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Clock3, Mail, MapPin, Plus, RefreshCw, Search } from 'lucide-react';
import { DataSkeleton } from '@/components/ui/DataSkeleton';
import { useAuth } from '@/components/auth/AuthProvider';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PriorityBadge, ReportStatusBadge } from '@/components/ui/ReportBadges';
import { reportStatusLabels } from '@/lib/mock-reports';
import { getReceivedMessages, getSentAnnouncements, publishAnnouncement, readMessage, type ReceivedMessage } from '@/lib/message-centre';
import type { ApiReportStatus, NotificationResult } from '@/lib/api';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

export default function Notifications() {
  const { user } = useAuth();
  return user ? <MessageCentreSession key={user.user_id} userId={user.user_id} /> : null;
}

function MessageCentreSession({ userId }: { userId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  const [received, setReceived] = useState<ReceivedMessage[]>([]);
  const [sent, setSent] = useState<NotificationResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ApiReportStatus>('all');
  const [priority, setPriority] = useState('all');
  const [compose, setCompose] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const sequence = useRef(0);
  const alive = useRef(true);
  const publishLock = useRef(false);
  const openLock = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError('');
    try {
      const [result, history] = await Promise.allSettled([getReceivedMessages(), getSentAnnouncements(userId)]);
      if (!alive.current || request !== sequence.current) return;
      if (history.status === 'fulfilled') setSent(history.value);
      if (result.status === 'fulfilled') { setReceived(result.value.items); setWarnings(result.value.warnings); }
      else { setWarnings([]); setError(result.reason instanceof Error ? result.reason.message : 'Unable to load messages.'); }
    } catch (reason) {
      if (alive.current && request === sequence.current) setError(reason instanceof Error ? reason.message : 'Unable to load messages.');
    } finally { if (alive.current && request === sequence.current) setLoading(false); }
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void refresh(); });
    return () => { cancelled = true; alive.current = false; };
  }, [refresh]);

  const filteredReceived = useMemo(() => {
    const query = search.trim().toLowerCase();
    return received.filter(item => {
      const matchesQuery = !query || [item.title, item.message, item.category, item.location, item.source].some(value => value?.toLowerCase().includes(query));
      const matchesStatus = status === 'all' || item.status === status;
      const matchesPriority = priority === 'all' || item.priority === priority;
      return matchesQuery && matchesStatus && matchesPriority;
    });
  }, [received, search, status, priority]);
  const filteredSent = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sent.filter(item => !query || `${item.title} ${item.message}`.toLowerCase().includes(query));
  }, [sent, search]);

  async function openMessage(item: ReceivedMessage) {
    if (openLock.current) return;
    openLock.current = true; setOpening(item.id); setError('');
    try {
      await readMessage(item);
      if (!alive.current) return;
      sequence.current++;
      setReceived(items => items.map(current => current.id === item.id ? { ...current, unread: false } : current));
      if (item.href) router.push(item.href);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Unable to open this item.'); }
    finally { openLock.current = false; if (alive.current) setOpening(null); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publishLock.current) return;
    setSendError('');
    if (!title.trim() || !message.trim()) { setSendError('Enter a title and message.'); return; }
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) { setSendError('Choose an expiry time in the future.'); return; }
    publishLock.current = true; setSending(true);
    try {
      const { items } = await publishAnnouncement(userId, { title: title.trim(), message: message.trim(), ...(expiry ? { expires_at: expiry.toISOString() } : {}) });
      if (!alive.current) return;
      sequence.current++; setSent(items); setTab('sent'); setCompose(false);
      setTitle(''); setMessage(''); setExpiresAt(''); setConfirmation('Announcement published to resident app notifications.');
    } catch (reason) { if (alive.current) setSendError(reason instanceof Error ? reason.message : 'Unable to send. Please try again.'); }
    finally { publishLock.current = false; if (alive.current) setSending(false); }
  }

  return <section className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-[30px] font-semibold leading-tight lg:text-[36px]">Message Centre</h1>
        <p className="mt-2 text-sm text-muted-foreground">Review resident reports, follow maintenance updates, and share community announcements.</p></div>
      <button type="button" onClick={() => { setSendError(''); setCompose(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
        <Plus size={17} aria-hidden="true" /> Send notification
      </button>
    </div>

    {confirmation && <p role="status" className="rounded-xl bg-status-green-bg p-3 text-sm text-status-green">{confirmation}</p>}
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
        <div className="flex gap-6" aria-label="Message folders">
          {(['received', 'sent'] as const).map(folder => <button key={folder} type="button" aria-pressed={tab === folder} onClick={() => setTab(folder)} className={`min-h-14 border-b-2 px-1 text-sm font-semibold ${tab === folder ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {folder === 'received' ? 'Received reports & updates' : 'Sent announcements'} <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs">{folder === 'received' ? received.length : sent.length}</span>
          </button>)}
        </div>
        <button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 sm:px-6">
        <label className="relative min-w-[220px] flex-1 sm:max-w-md"><span className="sr-only">Search messages</span><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reports, locations or messages" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
        {tab === 'received' && <>
          <label className="sr-only" htmlFor="message-status">Filter by status</label><select id="message-status" value={status} onChange={event => setStatus(event.target.value as 'all' | ApiReportStatus)} className="h-10 min-w-36 rounded-lg border border-input bg-background px-3 text-sm"><option value="all">Status: All</option>{(Object.keys(reportStatusLabels) as ApiReportStatus[]).map(value => <option key={value} value={value}>{reportStatusLabels[value]}</option>)}</select>
          <label className="sr-only" htmlFor="message-priority">Filter by priority</label><select id="message-priority" value={priority} onChange={event => setPriority(event.target.value)} className="h-10 min-w-36 rounded-lg border border-input bg-background px-3 text-sm"><option value="all">Priority: All</option><option value="High">High priority</option><option value="Medium">Medium priority</option><option value="Low">Low priority</option><option value="Unassigned">Unassigned</option></select>
        </>}
        <span className="ml-auto text-xs text-muted-foreground">{tab === 'received' ? `Showing ${filteredReceived.length} items` : `Showing ${filteredSent.length} announcements`}</span>
      </div>

      {error && <p role="alert" className="m-5 rounded-xl bg-status-red-bg p-3 text-sm text-status-red">{error}</p>}
      {warnings.map(warning => <p key={warning} role="status" className="mx-5 mt-4 rounded-xl bg-status-orange-bg p-3 text-sm text-status-orange">{warning}</p>)}
      {loading ? <div className="p-5"><DataSkeleton rows={3} variant="card" /></div> : tab === 'received' ? (
        filteredReceived.length ? <div className="grid gap-3 p-4 sm:p-5">{filteredReceived.map(item => <article key={item.id} className="flex flex-col justify-between gap-5 rounded-xl border border-border bg-background p-4 sm:flex-row sm:p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${item.source === 'Resident report' ? 'bg-blue-100 text-blue-800' : 'bg-secondary text-foreground'}`}>{item.source}</span>
              {item.status && <ReportStatusBadge status={item.status} />}
              {item.priority && <PriorityBadge priority={item.priority} />}
              {item.category && <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium">{item.category}</span>}
              {item.unread && <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand"><Bell size={13} aria-hidden="true" /> New</span>}
            </div>
            <h2 className="mt-3 text-base font-semibold">{item.title}</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.message}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {item.location && <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden="true" />{item.location}</span>}
              <span className="inline-flex items-center gap-1"><Clock3 size={14} aria-hidden="true" />{dateLabel(item.createdAt)}</span>
            </div>
          </div>
          {item.href && <button type="button" disabled={opening !== null} onClick={() => void openMessage(item)} className="min-h-10 shrink-0 self-start rounded-lg border border-border bg-secondary/50 px-4 text-sm font-semibold text-brand hover:bg-secondary disabled:opacity-50">{opening === item.id ? 'Opening…' : item.source === 'Resident report' ? 'Review report →' : 'Open update →'}</button>}
        </article>)}</div> : <div className="flex flex-col items-center px-5 py-14 text-center"><Mail size={28} className="text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 font-semibold">No matching reports or updates</h2><p className="mt-1 text-sm text-muted-foreground">Try changing your search or filters.</p></div>
      ) : filteredSent.length ? <div className="grid gap-3 p-4 sm:p-5">{filteredSent.map(item => <article key={item.id} className="rounded-xl border border-border bg-background p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><span className="rounded-md bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">In-app announcement</span><span className="rounded-md bg-secondary px-2.5 py-1 text-xs">To all residents</span></div><span className="text-xs text-muted-foreground">Sent {dateLabel(item.published_at ?? item.created_at)}</span></div>
        <h2 className="mt-3 text-base font-semibold">{item.title}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.message}</p>
        {item.expires_at && <p className="mt-3 text-xs text-muted-foreground">Expires {dateLabel(item.expires_at)}</p>}
      </article>)}</div> : <div className="flex flex-col items-center px-5 py-14 text-center"><Mail size={28} className="text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 font-semibold">No announcements found</h2><p className="mt-1 text-sm text-muted-foreground">Published announcements from this browser session will appear here.</p></div>}
    </div>

    <Dialog open={compose} onOpenChange={open => { if (!publishLock.current) setCompose(open); }}>
      <DialogContent className="max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-2xl p-6 sm:max-w-[560px]">
        <DialogHeader><DialogTitle className="pr-8 text-2xl font-semibold">Send announcement</DialogTitle><DialogDescription>Publish an in-app notification to all residents.</DialogDescription></DialogHeader>
        <form onSubmit={submit} aria-busy={sending} className="mt-3 flex min-w-0 flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-semibold">Title<input required maxLength={200} disabled={sending} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Scheduled water service interruption" className="min-h-11 w-full rounded-lg border border-input bg-background px-3 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold">Message <span className="text-right text-xs font-normal text-muted-foreground">{message.length}/2000</span><textarea required maxLength={2000} rows={5} disabled={sending} value={message} onChange={event => setMessage(event.target.value)} placeholder="Provide details, dates and instructions for residents…" className="w-full resize-y rounded-lg border border-input bg-background p-3 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold">Expiry date <span className="text-xs font-normal text-muted-foreground">Optional</span><input type="datetime-local" disabled={sending} value={expiresAt} onChange={event => setExpiresAt(event.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 font-normal" /></label>
          {sendError && <p role="alert" className="text-sm text-status-red">{sendError}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end"><button type="button" disabled={sending} onClick={() => setCompose(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold">Cancel</button><button type="submit" disabled={sending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{sending ? 'Publishing…' : <><Check size={16} aria-hidden="true" /> Publish announcement</>}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
