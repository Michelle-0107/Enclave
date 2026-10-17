'use client';

import { useState } from 'react';
import { createNotification, type NotificationResult } from '@/lib/api';

export default function ManagementNotificationsPage() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<NotificationResult | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError('');
    setSent(null);
    try {
      const result = await createNotification({
        title: title.trim(),
        message: message.trim(),
        ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
      });
      setSent(result);
      setTitle('');
      setMessage('');
      setExpiresAt('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to publish notification.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">Notifications.</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Publish a broadcast to resident notification feeds. The backend does not provide a management notification history endpoint.
      </p>
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5 rounded-3xl bg-enclave-lavender p-5 sm:p-7">
        <label className="flex flex-col gap-2 text-sm font-semibold text-primary">
          Title
          <input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold text-primary">
          Message
          <textarea required maxLength={2000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} className="rounded-xl border border-border bg-white p-4 font-normal" />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold text-primary">
          Optional expiry
          <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" />
        </label>
        <button disabled={sending} className="min-h-12 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {sending ? 'Publishing…' : 'Publish to residents'}
        </button>
        {error && <p role="alert" className="text-sm text-status-red">{error}</p>}
        {sent && <div role="status" className="rounded-xl bg-white p-4 text-sm text-primary">
          <p className="font-semibold">Broadcast published.</p>
          <p className="mt-1">Notification #{sent.id} · {new Date(sent.created_at).toLocaleString()}</p>
          <p className="mt-1 text-muted-foreground">Residents see this in their app notification feed. This endpoint does not send email or push notifications.</p>
        </div>}
      </form>
    </div>
  );
}
