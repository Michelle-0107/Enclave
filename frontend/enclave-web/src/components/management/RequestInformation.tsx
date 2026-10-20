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

export default function RequestInformation({ report }: Props) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!message.trim()) {
      setError('Please enter a message for the resident.');
      return;
    }

    setError('');
    setPreview(true);

    // Backend integration will send the request,
    // update report status and create the notification.
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
        Request an update.
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
            htmlFor="request-type"
            className="text-sm font-semibold"
          >
            Request type
          </Label>

          <Input
            id="request-type"
            value="Resident information"
            readOnly
            className="h-[54px] rounded-2xl bg-white px-4 text-sm text-muted-foreground shadow-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="request-message"
            className="text-sm font-semibold"
          >
            Your message
          </Label>

          <Textarea
            id="request-message"
            required
            maxLength={2000}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setError('');
              setPreview(false);
            }}
            placeholder="Please add the exact location and a clearer photo of the reported issue."
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? 'request-error' : undefined
            }
            className="min-h-[100px] rounded-2xl bg-white p-4 text-sm leading-relaxed shadow-none"
          />

          {error && (
            <p
              id="request-error"
              role="alert"
              className="text-sm text-status-red"
            >
              {error}
            </p>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          The resident receives your request with a link to
          their report.
        </p>

        <Button
          type="submit"
          className="min-h-[52px] w-full rounded-2xl bg-brand px-6 text-sm font-semibold text-primary-foreground"
        >
          Send request &amp; notify
        </Button>

        {preview && (
          <div
            role="status"
            className="rounded-2xl border border-border bg-white p-5"
          >
            <p className="text-sm font-semibold text-primary">
              Request preview
            </p>

            <p className="mt-2 text-xs text-muted-foreground">
              #{report.id} · {report.title}
            </p>

            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-primary">
              {message.trim()}
            </p>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Demo only. No request or notification has been
              sent, and the report status has not changed.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}