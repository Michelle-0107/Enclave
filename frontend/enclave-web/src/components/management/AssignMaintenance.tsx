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
  category: string;
  priority: ManagementReport['priority'];
  initialInstructions?: string;
};

const teams = [
  'Electrical team',
  'Facilities team',
  'Civil maintenance team',
];

export default function AssignMaintenance({
  report,
  category,
  priority,
  initialInstructions,
}: Props) {
  const [team, setTeam] = useState(
    category === 'Streetlight'
      ? 'Electrical team'
      : category === 'Accessibility' || category === 'Walkway'
        ? 'Civil maintenance team'
        : 'Facilities team',
  );

  const [targetDate, setTargetDate] = useState('');

  const [instructions, setInstructions] = useState(
    initialInstructions ??
      (category === 'Streetlight'
        ? 'Inspect fitting and power supply. Test operation after repair.'
        : ''),
  );

  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!instructions.trim()) {
      setError('Please enter repair instructions.');
      return;
    }

    // Frontend preview only.
    // Backend integration will create the task
    // and send the notification.
    setPreview(true);
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
        Assign maintenance.
      </h1>

      <p className="text-sm leading-relaxed text-muted-foreground">
        #{report.id} · {report.title}
      </p>

      <form
        onSubmit={handleSubmit}
        onChange={() => {
          setPreview(false);
          setError('');
        }}
        className="flex flex-col gap-7"
      >
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="maintenance-team"
            className="text-sm font-semibold"
          >
            Maintenance team
          </Label>

          <select
            id="maintenance-team"
            required
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            className="min-h-[54px] w-full rounded-2xl border border-input bg-white px-4 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {teams.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="target-completion"
            className="text-sm font-semibold"
          >
            Target completion
          </Label>

          <Input
            id="target-completion"
            type="date"
            required
            value={targetDate}
            onChange={(event) =>
              setTargetDate(event.target.value)
            }
            className="h-[54px] rounded-2xl bg-white px-4 text-sm shadow-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="repair-instructions"
            className="text-sm font-semibold"
          >
            Repair instructions
          </Label>

          <Textarea
            id="repair-instructions"
            required
            maxLength={2000}
            value={instructions}
            onChange={(event) =>
              setInstructions(event.target.value)
            }
            placeholder="Describe the repair work required."
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? 'assignment-error' : undefined
            }
            className="min-h-[100px] rounded-2xl bg-white p-4 text-sm leading-relaxed shadow-none"
          />

          {error && (
            <p
              id="assignment-error"
              role="alert"
              className="text-sm text-status-red"
            >
              {error}
            </p>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          The assigned task appears in the maintenance workspace.
        </p>

        <Button
          type="submit"
          className="min-h-[52px] w-full rounded-2xl bg-brand px-6 text-sm font-semibold text-primary-foreground"
        >
          Assign task &amp; notify
        </Button>

        {preview && (
          <div
            role="status"
            className="rounded-2xl border border-border bg-white p-5"
          >
            <p className="text-sm font-semibold text-primary">
              Assignment preview
            </p>

            <p className="mt-2 text-xs text-muted-foreground">
              #{report.id} · {report.title}
            </p>

            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  Maintenance team
                </dt>

                <dd className="mt-1 text-primary">
                  {team}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">
                  Target completion
                </dt>

                <dd className="mt-1 text-primary">
                  {targetDate}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">
                  Category · Priority
                </dt>

                <dd className="mt-1 text-primary">
                  {category} · {priority}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">
                  Repair instructions
                </dt>

                <dd className="mt-1 whitespace-pre-wrap break-words text-primary">
                  {instructions.trim()}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Demo only. No task has been created and no
              notification has been sent.
            </p>
          </div>
        )}
      </form>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Sample maintenance teams. Backend integration is pending.
      </p>
    </div>
  );
}