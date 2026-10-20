'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Plus } from 'lucide-react';

import { useAuth } from '@/components/auth/AuthProvider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getReceivedMessages,
  getSentAnnouncements,
  publishAnnouncement,
  readMessage,
  type ReceivedMessage,
} from '@/lib/message-centre';
import type { NotificationResult } from '@/lib/api';

function dateLabel(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleString();
}

export default function Notifications() {
  const { user } = useAuth();

  return user ? (
    <MessageCentreSession
      key={user.user_id}
      userId={user.user_id}
    />
  ) : null;
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

    setLoading(true);
    setError('');

    try {
      const [result, history] = await Promise.allSettled([
        getReceivedMessages(),
        getSentAnnouncements(userId),
      ]);

      if (!alive.current || request !== sequence.current) return;

      if (history.status === 'fulfilled') {
        setSent(history.value);
      }

      if (result.status === 'fulfilled') {
        setReceived(result.value.items);
        setWarnings(result.value.warnings);
      } else {
        setWarnings([]);
        setError(
          result.reason instanceof Error
            ? result.reason.message
            : 'Unable to load messages.',
        );
      }
    } catch (reason) {
      if (alive.current && request === sequence.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to load messages.',
        );
      }
    } finally {
      if (alive.current && request === sequence.current) {
        setLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });

    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [refresh]);

  async function openMessage(item: ReceivedMessage) {
    if (openLock.current) return;

    openLock.current = true;
    setOpening(item.id);
    setError('');

    try {
      await readMessage(item);

      if (!alive.current) return;

      sequence.current++;
      setLoading(false);

      setReceived((items) =>
        items.map((current) =>
          current.id === item.id
            ? { ...current, unread: false }
            : current,
        ),
      );

      if (item.href) {
        router.push(item.href);
      }
    } catch (reason) {
      if (alive.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to open this message.',
        );
      }
    } finally {
      openLock.current = false;

      if (alive.current) {
        setOpening(null);
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (publishLock.current) return;

    setSendError('');

    if (!title.trim() || !message.trim()) {
      setSendError('Enter a title and message.');
      return;
    }

    const expiry = expiresAt ? new Date(expiresAt) : null;

    if (
      expiry &&
      (!Number.isFinite(expiry.getTime()) ||
        expiry.getTime() <= Date.now())
    ) {
      setSendError('Choose an expiry time in the future.');
      return;
    }

    publishLock.current = true;
    setSending(true);

    try {
      const { items } = await publishAnnouncement(userId, {
        title: title.trim(),
        message: message.trim(),
        ...(expiry ? { expires_at: expiry.toISOString() } : {}),
      });

      if (!alive.current) return;

      sequence.current++;
      setLoading(false);
      setSent(items);
      setTab('sent');
      setCompose(false);

      setTitle('');
      setMessage('');
      setExpiresAt('');

      setConfirmation(
        'Announcement published to resident app notifications.',
      );
    } catch (reason) {
      if (alive.current) {
        setSendError(
          reason instanceof Error
            ? reason.message
            : 'Unable to send. Please try again.',
        );
      }
    } finally {
      publishLock.current = false;

      if (alive.current) {
        setSending(false);
      }
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold">Message Centre.</h1>

        <button
          type="button"
          onClick={() => {
            setSendError('');
            setCompose(true);
          }}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-brand px-4 text-sm font-semibold text-primary-foreground"
        >
          <Plus size={17} aria-hidden="true" />
          <span className="hidden sm:inline">
            Send notification
          </span>
          <span className="sm:hidden">Send</span>
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Community reports, repair updates and announcements.
      </p>

      {confirmation && (
        <p
          role="status"
          className="rounded-xl bg-status-green-bg p-4 text-sm text-status-green"
        >
          {confirmation}
        </p>
      )}

      <div
        className="flex items-center justify-between gap-3 pb-4"
        style={{ borderBottom: '1px solid #B8C2CE' }}
      >
        <div
          className="flex gap-2"
          aria-label="Message folders"
        >
          {(['received', 'sent'] as const).map((folder) => (
            <button
              key={folder}
              type="button"
              aria-pressed={tab === folder}
              onClick={() => setTab(folder)}
              className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${
                tab === folder
                  ? 'bg-brand text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {folder === 'received' ? 'Received' : 'Sent'}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="min-h-11 text-sm font-semibold underline disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}

      {tab === 'received' ? (
        <div aria-label="Received messages">
          {warnings.map((warning) => (
            <p
              key={warning}
              role="status"
              className="mb-3 text-sm text-status-orange"
            >
              {warning}
            </p>
          ))}

          {loading ? (
            <p
              role="status"
              className="py-6 text-sm text-muted-foreground"
            >
              Loading messages…
            </p>
          ) : received.length === 0 && !error ? (
            <div className="flex items-start gap-3 py-8">
              <Mail
                size={22}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />

              <div>
                <h2 className="font-semibold">
                  You’re all caught up
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  New reports and repair updates will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div>
              {received.map((item, index) => (
                <article
                  key={item.id}
                  className="flex min-w-0 gap-3 py-6"
                  style={{
                    borderTop:
                      index > 0
                        ? '1px solid #B8C2CE'
                        : undefined,
                  }}
                >
                  <span
                    className="mt-2 size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: item.unread
                        ? '#526B8A'
                        : 'transparent',
                    }}
                    aria-label={
                      item.unread ? 'Unread' : undefined
                    }
                  />

                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">
                      {item.title}
                    </h2>

                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                      {item.message}
                    </p>

                    <p className="mt-3 text-xs text-muted-foreground">
                      {item.source} · {dateLabel(item.createdAt)}
                    </p>

                    {(item.href || item.unread) && (
                      <button
                        type="button"
                        disabled={opening !== null}
                        onClick={() => void openMessage(item)}
                        className="mt-2 min-h-11 text-sm font-semibold underline underline-offset-4 disabled:opacity-50"
                      >
                        {opening === item.id
                          ? 'Opening…'
                          : item.href
                            ? 'Open report'
                            : 'Mark as read'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div aria-label="Sent announcements">
          <p className="mb-3 text-xs text-muted-foreground">
            Announcements sent from this browser session.
          </p>

          {sent.length === 0 ? (
            <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Mail size={20} aria-hidden="true" />
              No announcements sent in this session yet.
            </div>
          ) : (
            <div>
              {sent.map((item, index) => (
                <article
                  key={item.id}
                  className="py-6"
                  style={{
                    borderTop:
                      index > 0
                        ? '1px solid #B8C2CE'
                        : undefined,
                  }}
                >
                  <h2 className="font-semibold">
                    {item.title}
                  </h2>

                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                    {item.message}
                  </p>

                  <p className="mt-3 text-xs text-muted-foreground">
                    Sent to all residents ·{' '}
                    {dateLabel(item.created_at)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={compose}
        onOpenChange={(open) => {
          if (!publishLock.current) {
            setCompose(open);
          }
        }}
      >
        <DialogContent
          className="message-composer"
          showCloseButton={!sending}
          style={{
            position: 'fixed',
            top: '50%',
            right: 'auto',
            bottom: 'auto',
            left: '50%',
            margin: 0,
            transform: 'translate(-50%, -50%)',
            translate: 'none',
            animation: 'none',
            width: 'min(560px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            height: 'auto',
            maxHeight: 'calc(100dvh - 32px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            borderRadius: 24,
            alignContent: 'start',
            boxSizing: 'border-box',
            padding: 24,
            backgroundColor: 'var(--background)',
          }}
        >
          <DialogHeader>
            <DialogTitle className="pr-8 text-2xl font-semibold">
              Send notification.
            </DialogTitle>

            <DialogDescription>
              To all residents · In-app announcement
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={submit}
            aria-busy={sending}
            className="mt-3 flex min-w-0 flex-col gap-5"
          >
            <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">
              Title
              <input
                required
                maxLength={200}
                disabled={sending}
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value)
                }
                className="min-h-12 w-full min-w-0 rounded-xl border bg-white px-4 font-normal"
              />
            </label>

            <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">
              Message
              <textarea
                required
                maxLength={2000}
                rows={5}
                disabled={sending}
                value={message}
                onChange={(event) =>
                  setMessage(event.target.value)
                }
                className="w-full min-w-0 resize-y rounded-xl border bg-white p-4 font-normal"
              />
            </label>

            <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">
              Expiry · optional
              <input
                type="datetime-local"
                disabled={sending}
                value={expiresAt}
                onChange={(event) =>
                  setExpiresAt(event.target.value)
                }
                className="min-h-12 w-full min-w-0 rounded-xl border bg-white px-4 font-normal"
              />
            </label>

            {sendError && (
              <p
                role="alert"
                className="text-sm text-status-red"
              >
                {sendError}
              </p>
            )}

            <button
              type="submit"
              disabled={sending}
              className="min-h-12 rounded-2xl bg-brand px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {sending
                ? 'Sending…'
                : 'Publish to residents'}
            </button>

            <button
              type="button"
              disabled={sending}
              onClick={() => setCompose(false)}
              className="min-h-11 rounded-2xl border px-5 text-sm font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}