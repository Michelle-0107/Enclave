'use client';
import { useEffect, useState } from 'react';
import { getTaskHistory, type TaskEvent } from '@/lib/maintenance/api';

export default function TaskHistory({ id, updatedAt, manager = false }: { id: string; updatedAt?: string; manager?: boolean }) {
  const [items, setItems] = useState<TaskEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    getTaskHistory(id, manager).then(items => { if (live) { setItems(items); setError(''); } })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'Unable to load task history.'); });
    return () => { live = false; };
  }, [id, updatedAt, manager]);
  return <section className="flex flex-col gap-3" aria-label="Maintenance history">
    <h2 className="text-lg font-semibold">Task history</h2>
    {error && <p role="alert" className="text-sm text-status-red">{error}</p>}
    {items.map(event => <article key={event.id} className="rounded-2xl border p-4">
      <p className="text-sm font-semibold capitalize">{event.action.replaceAll('_', ' ')} · {event.actor_role}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{event.note}</p>
      <time className="mt-2 block text-xs text-muted-foreground" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
    </article>)}
  </section>;
}
