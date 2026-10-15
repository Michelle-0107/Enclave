'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ManagementReport } from '@/lib/mock-reports';

type Props = {
  report: ManagementReport;
};

export default function RejectReport({ report }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!reason.trim()) {
      setError('Please enter a reason for rejection.');
      return;
    }

    setError('');
    setPreview(true);

    // Backend integration will update the report
    // and notify the resident.
  }

  return (
    <div className="flex flex-col gap-7">
      <Link
        href={`/management/reports/${report.id}`}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary"
      >
        <ChevronLeft size={18} aria-hidden="true" />
        Report details
      </Link>

      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">
        Reject report.
      </h1>

      <p className="text-sm leading-relaxed text-muted-foreground">
        Add a clear note before returning the report.
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-7"
      >
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="rejection-decision"
            className="text-sm font-semibold"
          >
            Decision
          </Label>

          <Input
            id="rejection-decision"
            value="Rejected"
            readOnly
            className="h-[54px] rounded-2xl bg-white px-4 text-sm text-muted-foreground shadow-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="rejection-reason"
            className="text-sm font-semibold"
          >
            Reason for rejection
          </Label>

          <Textarea
            id="rejection-reason"
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError('');
              setPreview(false);
            }}
            placeholder="This is a duplicate of an existing maintenance ticket."
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? 'rejection-error' : undefined
            }
            className="min-h-[100px] rounded-2xl bg-white p-4 text-sm leading-relaxed shadow-none"
          />

          {error && (
            <p
              id="rejection-error"
              role="alert"
              className="text-sm text-status-red"
            >
              {error}
            </p>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          The reporter receives the reason. Rejected reports
          stay off the public map.
        </p>

        <Button
          type="submit"
          className="min-h-[52px] w-full rounded-2xl bg-status-red-bg px-6 text-sm font-semibold text-status-red hover:bg-status-red-bg hover:opacity-80"
        >
          Reject &amp; notify
        </Button>

        {preview && (
          <div
            role="status"
            className="rounded-2xl border border-border bg-white p-5"
          >
            <p className="text-sm font-semibold text-primary">
              Rejection preview
            </p>

            <p className="mt-2 text-xs text-muted-foreground">
              #{report.id} · {report.title}
            </p>

            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-primary">
              {reason.trim()}
            </p>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Demo only. The report has not been rejected
              and no notification has been sent.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}