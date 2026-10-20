'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiError,
  getReportHistory,
  updateReportStatus,
  type ManagementReport,
  type StatusEvent,
  type ApiReportStatus,
} from '@/lib/api';
import { reportStatusLabels } from '@/lib/mock-reports';
import ReportLocationMap from '@/components/management/ReportLocationMap';
import WorkflowGuide from '@/components/ui/WorkflowGuide';
import MaintenanceTaskPanel from '@/components/management/MaintenanceTaskPanel';
import type { BackendTask } from '@/lib/maintenance/api';

type Props = { report: ManagementReport };

export default function ReportDetails({ report: initialReport }: Props) {
  const [report, setReport] = useState(initialReport);
  const [history, setHistory] = useState<StatusEvent[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const historyRevision = useRef(0);
  const [error, setError] = useState('');
  const [photoExpanded, setPhotoExpanded] = useState(false);

  useEffect(() => {
    if (!photoExpanded) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPhotoExpanded(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [photoExpanded]);

  const loadHistory = useCallback(async () => {
    const revision = ++historyRevision.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await getReportHistory(report.id);
      if (revision === historyRevision.current) setHistory(response.items);
    } catch (reason) {
      if (revision === historyRevision.current) setHistoryError(reason instanceof Error ? reason.message : 'Unable to load report history.');
    } finally {
      if (revision === historyRevision.current) setHistoryLoading(false);
    }
  }, [report.id]);

  const maintenanceChanged = useCallback((task: BackendTask) => {
    setReport(current => ({ ...current, status: task.report_status as ApiReportStatus }));
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    let active = true;
    const revision = ++historyRevision.current;
    getReportHistory(report.id)
      .then((response) => { if (active && revision === historyRevision.current) setHistory(response.items); })
      .catch((reason: unknown) => { if (active && revision === historyRevision.current) setHistoryError(reason instanceof Error ? reason.message : 'Unable to load report history.'); })
      .finally(() => { if (active && revision === historyRevision.current) setHistoryLoading(false); });
    return () => { active = false; };
  }, [report.id]);

  async function transition(status: ApiReportStatus) {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setError('Add a resident-visible note before changing the report status.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await updateReportStatus(report.id, {
        expected_status: report.status,
        status,
        note: trimmedNote,
        ...(status === 'resolved' ? { repair_verified: true } : {}),
      });
      setReport(result.report);
      setNote('');
      // Ignore history requests started before this saved decision.
      historyRevision.current++;
      setHistoryLoading(false);
      setHistoryError('');
      setHistory((items) => [...items, result.event]);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setError('Another manager changed this report. Refresh the page and try again.');
      } else {
        setError(reason instanceof Error ? reason.message : 'The status update failed.');
      }
    } finally {
      setSaving(false);
    }
  }

  const reviews = history.filter(event => event.actor_role === 'management' && event.from_status === 'pending' && ['approved', 'rejected'].includes(event.to_status));

  const statusColor = report.status === 'resolved'
    ? 'bg-status-green-bg text-status-green'
    : report.status === 'rejected'
      ? 'bg-status-red-bg text-status-red'
      : 'bg-status-orange-bg text-status-orange';

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[30px] font-semibold leading-[1.35] text-primary lg:text-[36px]">{report.title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">#{report.id} · Submitted {report.submittedAt}</p>
      <div className={`inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs ${statusColor}`}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {reportStatusLabels[report.status]}
      </div>

      {report.status === 'pending' && <WorkflowGuide steps={['Review', 'Assign', 'Repair', 'Verify', 'Resolved']} active={0} next="Next: review the evidence, then approve or reject the report." />}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <section aria-label="Report evidence" className="flex min-w-0 flex-col">
          {report.imageUrl ? (
            <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-3xl border border-border bg-card p-3">
              <Image src={report.imageUrl} alt={`Resident evidence for ${report.title}`} fill unoptimized sizes="(max-width: 1024px) 100vw, 50vw" className="object-contain p-3" />
              <button type="button" onClick={() => setPhotoExpanded(true)} className="absolute right-4 bottom-4 z-10 min-h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow" aria-label="Expand report photo">Expand photo</button>
            </div>
          ) : (
            <div className="flex min-h-[180px] items-center justify-center rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
              No photo was attached to this report.
            </div>
          )}
        </section>

        <section aria-label="Report details" className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-primary">Report details</h2>
          <dl className="grid gap-4 text-sm">
            <div><dt className="font-semibold text-primary">Category</dt><dd className="mt-1 text-muted-foreground">{report.category}</dd></div>
            <div><dt className="font-semibold text-primary">Priority</dt><dd className="mt-1 text-muted-foreground">{report.priority}</dd></div>
            <div>
              <dt className="font-semibold text-primary">Description</dt>
              <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {report.description || 'No description provided.'}
              </dd>
            </div>
          </dl>
          {report.status !== 'pending' && (
            <section aria-labelledby="saved-review-heading" className="min-w-0 border-t border-border pt-4">
              <h3 id="saved-review-heading" className="text-sm font-semibold text-primary">Management review</h3>
              {historyLoading ? (
                <p role="status" className="mt-2 text-sm text-muted-foreground">Loading saved review…</p>
              ) : historyError ? (
                <div className="mt-2 text-sm text-status-red">
                  <p role="alert">Unable to load the saved review. {historyError}</p>
                  <button type="button" onClick={() => void loadHistory()} className="mt-2 min-h-11 font-semibold underline">Retry review</button>
                </div>
              ) : reviews.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No approval or rejection review is recorded for this report.</p>
              ) : reviews.map(review => (
                <article key={review.id} className="mt-3 rounded-2xl bg-secondary/50 p-4">
                  <p className="text-sm font-semibold text-primary">{reportStatusLabels[review.to_status]}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{review.note}</p>
                  <time className="mt-2 block text-xs text-muted-foreground" dateTime={review.created_at}>{new Date(review.created_at).toLocaleString()}</time>
                </article>
              ))}
            </section>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Review the issue details and location, then follow the next step below.
          </p>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <section aria-label="Issue location" className="flex min-w-0 flex-col gap-5 rounded-3xl border border-border bg-white p-5">
          <h2 className="text-lg font-semibold text-primary">Issue Location</h2>
          <ReportLocationMap latitude={report.latitude} longitude={report.longitude} />
        </section>

        {report.status === 'pending' && (
        <section aria-labelledby="status-action-heading" className="flex min-w-0 flex-col gap-4 rounded-3xl border border-border bg-white p-5">
          <h2 id="status-action-heading" className="text-lg font-semibold text-primary">
            Review report
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The note is visible to the resident. Keep private staff details out of it.
          </p>
          <Textarea
            value={note}
            onChange={(event) => { setNote(event.target.value); setError(''); }}
            maxLength={1000}
            placeholder="Write a short status note for the resident"
            className="min-h-[100px] rounded-2xl bg-white p-4 text-sm leading-relaxed shadow-none"
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            {report.status === 'pending' && (
              <>
                <Button type="button" disabled={saving} onClick={() => void transition('approved')} className="min-h-[50px] rounded-2xl bg-primary px-5 text-primary-foreground">{saving ? 'Saving…' : 'Approve report'}</Button>
                <Button type="button" disabled={saving} onClick={() => void transition('rejected')} className="min-h-[50px] rounded-2xl bg-status-red-bg px-5 text-status-red hover:bg-status-red-bg">Reject report</Button>
              </>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-status-red">{error}</p>}
          {report.status === 'pending' && (
            <p className="text-xs leading-relaxed text-muted-foreground">Approve the report first, then assign a maintenance task.</p>
          )}
        </section>
        )}

        {['approved', 'in_progress', 'resolved'].includes(report.status) && (
          <div className="flex min-w-0 flex-col">
            <MaintenanceTaskPanel key={report.id} report={report} onChange={maintenanceChanged} />
            {report.status === 'resolved' && <p className="mt-4 rounded-2xl bg-status-green-bg p-4 text-sm text-status-green">This report is resolved and has been marked as checked by management.</p>}
          </div>
        )}
        {report.status === 'rejected' && <p className="self-start rounded-2xl bg-status-red-bg p-4 text-sm text-status-red">This report is rejected. The backend does not allow further status changes.</p>}
      </div>

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-lg font-semibold text-primary">Status history</h2>
        {historyLoading ? (
          <p className="text-sm text-muted-foreground">Loading status history…</p>
        ) : historyError ? (
          <p role="alert" className="text-sm text-status-red">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status history is recorded for this report yet.</p>
        ) : history.map((event) => (
          <article key={event.id} className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-primary">{reportStatusLabels[event.from_status]} → {reportStatusLabels[event.to_status]}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{event.note}</p>
            <time className="mt-2 block text-xs text-muted-foreground" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
          </article>
        ))}
        {!historyLoading && historyError && <button type="button" onClick={() => void loadHistory()} className="w-fit text-xs font-semibold text-primary underline">Refresh history</button>}
      </section>

      {photoExpanded && report.imageUrl && (
        <div role="dialog" aria-modal="true" aria-label="Expanded report photo" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-5" onClick={() => setPhotoExpanded(false)}>
          <button type="button" onClick={() => setPhotoExpanded(false)} className="absolute top-5 right-5 z-10 min-h-11 rounded-full bg-white/15 px-4 text-sm font-semibold text-white" aria-label="Close expanded photo">Close</button>
          <div className="relative h-[90vh] w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
            <Image src={report.imageUrl} alt={`Expanded resident evidence for ${report.title}`} fill unoptimized sizes="100vw" className="object-contain" />
          </div>
        </div>
      )}

      <Link href="/management/what-if" className="flex min-h-[52px] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-sm font-semibold text-primary transition-opacity hover:opacity-80 sm:w-[320px]">
        Compare repair plans
      </Link>
    </div>
  );
}
