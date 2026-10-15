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

export default function RequestRework({ report }: Props) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!message.trim()) {
      setError('Please enter instructions for the maintenance team.');
      return;
    }

    setError('');
    setPreview(true);

    // Backend integration:
    // create rework request, return task to In progress,
    // and notify the assigned maintenance team.
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
        Request rework.
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
            htmlFor="rework-request-type"
            className="text-sm font-semibold"
          >
            Request type
          </Label>

          <Input
            id="rework-request-type"
            value="Maintenance team"
            readOnly
            className="h-[54px] rounded-2xl bg-white px-4 text-sm text-muted-foreground shadow-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="rework-message"
            className="text-sm font-semibold"
          >
            Your message
          </Label>

          <Textarea
            id="rework-message"
            required
            maxLength={2000}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setError('');
              setPreview(false);
            }}
            placeholder="Please upload a clear photo showing the issue after repair."
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? 'rework-message-error' : undefined
            }
            className="min-h-[100px] rounded-2xl bg-white p-4 text-sm leading-relaxed shadow-none"
          />

          {error && (
            <p
              id="rework-message-error"
              role="alert"
              className="text-sm text-status-red"
            >
              {error}
            </p>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          The maintenance team receives your note and the task
          returns to In progress.
        </p>

        <Button
          type="submit"
          className="min-h-[52px] w-full rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground"
        >
          Send request &amp; notify
        </Button>

        {preview && (
          <div
            role="status"
            className="rounded-2xl border border-border bg-white p-5"
          >
            <p className="text-sm font-semibold text-primary">
              Rework request preview
            </p>

            <p className="mt-2 text-xs text-muted-foreground">
              #{report.id} · {report.title}
            </p>

            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-primary">
              {message.trim()}
            </p>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Demo only. No request or notification has been
              sent, and the task status has not changed.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}