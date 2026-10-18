'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStaffNotifications, markStaffNotificationRead, type StaffNotice } from '@/lib/maintenance/api';
import { Heading } from './Common';

export default function Notifications() {
  const [items, setItems] = useState<StaffNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<number | null>(null);
  const router = useRouter();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems(await getStaffNotifications()); }
    catch (reason) { setItems([]); setError(reason instanceof Error ? reason.message : 'Unable to load notifications.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => getStaffNotifications()
      .then(items => { if (active) { setItems(items); setError(''); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load notifications.'); })
      .finally(() => { if (active) setLoading(false); });
    void refresh(); window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, []);
  async function open(notice: StaffNotice) {
    if (opening !== null) return;
    setOpening(notice.id); setError('');
    try {
      if (!notice.is_read) await markStaffNotificationRead(notice.id);
      setItems(items => items.map(item => item.id === notice.id ? { ...item, is_read: true } : item));
      router.push(`/maintenance/tasks/${encodeURIComponent(notice.task_id)}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open notification.'); }
    finally { setOpening(null); }
  }
  return <section className="flex flex-col gap-7">
    <Heading title="Notifications." subtitle="Assignments and management feedback." back={null} />
    <button type="button" disabled={loading} onClick={() => void load()} className="w-fit text-sm font-semibold underline">Refresh notifications</button>
    {loading && <p role="status">Loading notifications…</p>}
    {error && <p role="alert" className="text-status-red">{error}</p>}
    {!loading && !error && !items.length && <p>No notifications yet.</p>}
    <div className="divide-y">{items.map(notice => <button type="button" key={notice.id} disabled={opening !== null}
      onClick={() => void open(notice)} className="flex w-full flex-col gap-2 py-6 text-left hover:opacity-75">
      <h2 className="font-semibold">{!notice.is_read && <span className="mr-2 inline-block size-2 rounded-full bg-primary" aria-label="Unread" />}{notice.title}</h2>
      <p className="text-sm text-muted-foreground">{notice.message}</p>
      <time className="text-xs text-muted-foreground" dateTime={notice.created_at}>{new Date(notice.created_at).toLocaleString()}</time>
    </button>)}</div>
  </section>;
}
