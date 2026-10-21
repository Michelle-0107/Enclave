'use client';
import { useState } from 'react';
import type { BackendTask } from '@/lib/maintenance/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function BlockerFeedbackForm({ task, busy, onSubmit }: {
  task: BackendTask; busy: boolean; onSubmit: (notes: string, newDate?: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState('');
  const [choice, setChoice] = useState<'keep' | 'change' | ''>('');
  const [date, setDate] = useState(task.target_date);
  const [error, setError] = useState('');
  if (!task.pending_blocker) return null;
  const id = `blocker-${task.id}-${task.pending_blocker.id}`;
  return <form aria-label="Respond to maintenance blocker" className="flex flex-col gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4"
    onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      if (!feedback.trim() || !choice || (choice === 'change' && (!date || date === task.target_date))) {
        setError('Write feedback and choose whether to keep or change the due date. A changed date must be different.'); return;
      }
      setError(''); void onSubmit(feedback.trim(), choice === 'change' ? date : undefined);
    }}>
    <h3 className="font-semibold">Maintenance blocker needs your feedback</h3>
    <p className="whitespace-pre-wrap text-sm">{task.pending_blocker.note}</p>
    <p className="text-sm">Current due date: {task.target_date}</p>
    {(task.pending_blocker_count ?? 0) > 1 && <p className="text-sm">{task.pending_blocker_count} blockers await feedback. Reply to each one below.</p>}
    <label className="flex flex-col gap-2 text-sm">Feedback to maintenance
      <Textarea required maxLength={2000} disabled={busy} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="Explain what to do next and how management will help." />
    </label>
    <fieldset disabled={busy} className="flex flex-col gap-2 text-sm">
      <legend className="mb-2 font-semibold">Change the due date?</legend>
      <label className="flex items-center gap-2"><input type="radio" required name={id} value="keep" checked={choice === 'keep'} onChange={() => setChoice('keep')} />No, keep {task.target_date}</label>
      <label className="flex items-center gap-2"><input type="radio" required name={id} value="change" checked={choice === 'change'} onChange={() => setChoice('change')} />Yes, set a new due date</label>
    </fieldset>
    {choice === 'change' && <label className="flex flex-col gap-2 text-sm">New due date<Input type="date" required disabled={busy} value={date} onChange={event => setDate(event.target.value)} /></label>}
    {error && <p role="alert" className="text-sm text-status-red">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send feedback & notify maintenance'}</Button>
  </form>;
}
