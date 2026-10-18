"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMaintenance } from "./MaintenanceProvider";
import {
  action,
  Heading,
  Photo,
  primaryLink,
  secondaryLink,
  Status,
  control,
} from "./Common";
import { statusLabels } from "@/lib/maintenance/types";
import TaskHistory from './TaskHistory';
export type TaskView =
  "details" | "update" | "evidence" | "blocker" | "rework" | "submitted";
export default function TaskScreen({
  id,
  view = "details",
}: {
  id: string;
  view?: TaskView;
}) {
  const { tasks, loading, error: loadError, gateway } = useMaintenance();
  const task = tasks.find((t) => t.id === id);
  const router = useRouter();
  const [draftNotes, setNotes] = useState<string | null>(null);
  const notes = draftNotes ?? (view === "update" ? task?.workNotes || "" : task?.completionNotes || "");
  const [checked, setChecked] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const previewUrl = useRef("");
  const [type, setType] = useState("parts");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );
  if (loading) return <p role="status">Loading task…</p>;
  if (loadError) return <p role="alert">{loadError} <Link className="underline" href="/maintenance">Back to my tasks</Link></p>;
  if (!task)
    return (
      <section className="flex flex-col gap-7">
        <Heading
          title="Task not found."
          subtitle="This task is unavailable or no longer assigned to you."
        />
        <Link href="/maintenance" className={primaryLink}>
          Back to my tasks
        </Link>
      </section>
    );
  const base = `/maintenance/tasks/${task.id}`;
  const canEdit = ["in-progress", "changes-requested"].includes(
    task.status,
  );
  async function run(
    fn: () => Promise<unknown>,
    success?: string,
    next?: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (success) setNotice(success);
      if (next) router.push(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function selectPhoto(photo?: File) {
    setError("");
    if (!photo) return;
    if (
      !["image/jpeg", "image/png"].includes(photo.type) ||
      photo.size > 10 * 1024 * 1024 ||
      !photo.size
    ) {
      setError("Choose a non-empty JPG or PNG photo up to 10 MB.");
      if (input.current) input.current.value = "";
      return;
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(photo);
    setPreview(previewUrl.current);
    setFile(photo);
  }
  async function submitEvidence(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    if (!notes.trim() || !file || !checked) {
      setError(
        "Add completion notes, upload a repair photo and confirm the on-site check.",
      );
      return;
    }
    await run(
      () =>
        gateway.submitEvidence(id, {
          notes: notes.trim(),
          photo: file,
          checkedOnSite: checked,
        }),
      undefined,
      `${base}/submitted`,
    );
  }
  const upload = (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        aria-label="Upload after-repair photo"
        onChange={(e) => selectPhoto(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="secondary"
        className={`${action} w-full`}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {view === "rework"
          ? "Upload new evidence"
          : "Upload after-repair photo"}
      </Button>
    </>
  );
  if (task.status === "assigned" && !["details", "submitted"].includes(view)) {
    return <section className="flex flex-col gap-5"><Heading title="Start work first." subtitle={task.title} />
      <p>Open the task details and choose Start work before adding updates or evidence.</p>
      <Link href={base} className={primaryLink}>Task details</Link></section>;
  }
  const messages = (
    <>
      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-status-green">
          {notice}
        </p>
      )}
    </>
  );
  if (view === "submitted")
    return (
      <section className="flex flex-col gap-7">
        <Heading
          title={
            task.status === "awaiting-verification"
              ? "Repair submitted."
              : "No submitted repair yet."
          }
          subtitle={`#${task.ticketId ?? id} · ${task.title}`}
          back={base}
          backLabel="Task details"
        />
        {task.status === "awaiting-verification" ? (
          <>
            <div className="flex flex-col gap-3 rounded-3xl bg-status-orange-bg p-5">
              <h2 className="text-[22px] font-semibold text-status-orange">
                Awaiting verification
              </h2>
              <p className="text-sm">
                Management will review your repair evidence.
              </p>
              <p className="text-sm text-muted-foreground">
                If changes are requested, your task returns for further work.
                The resident receives a resolved update after approval.
              </p>
            </div>
            <Link href="/maintenance" className={primaryLink}>
              Back to my tasks
            </Link>
            <Link href={base + "/evidence"} className={secondaryLink}>
              View submitted evidence
            </Link>
          </>
        ) : (
          <Link href={base} className={primaryLink}>
            Back to task details
          </Link>
        )}
      </section>
    );
  if (view === "details")
    return (
      <section className="flex flex-col gap-7">
        <Heading
          title={task.title}
          subtitle={`#${task.ticketId ?? id} · Assigned ${task.assignedAt}`}
        />
        <Status status={task.status}>
          {statusLabels[task.status]} · {task.priority}
        </Status>
        <div className="grid gap-6 lg:grid-cols-2 lg:divide-x">
          <div className="flex flex-col gap-[18px] lg:pr-3">
            <Photo
              label="Resident photo / before repair"
              url={task.beforePhotoUrl}
            />
            <p className="font-semibold">{task.location}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {task.description}
            </p>
          </div>
          <div className="lg:pl-3">
            <div className="flex flex-col gap-[14px] rounded-3xl bg-white p-5">
              <h2 className="text-xl font-semibold">{task.team}</h2>
              <p className="text-sm">Target completion: {task.targetDate}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {task.instructions}
              </p>
            </div>
          </div>
        </div>
        {task.reviewNote && task.status === "changes-requested" && (
          <div className="rounded-3xl bg-secondary p-5">
            <h2 className="font-semibold">Management review note</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {task.reviewNote}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          {task.status === "assigned" ? (
            <Button
              disabled={busy}
              className={`${action} sm:w-[280px]`}
              onClick={() =>
                run(() => gateway.startWork(id), undefined, base + "/update")
              }
            >
              {busy ? "Starting…" : "Start work"}
            </Button>
          ) : canEdit ? (
            <Link
              href={
                base +
                (task.status === "changes-requested" ? "/rework" : "/update")
              }
              className={`${primaryLink} sm:w-[280px]`}
            >
              {task.status === "changes-requested"
                ? "Update repair evidence"
                : "Update repair"}
            </Link>
          ) : (
            <Link href={base + "/evidence"} className={primaryLink}>
              View submitted evidence
            </Link>
          )}
          {canEdit && (
            <Link
              href={base + "/blocker"}
              className={`${secondaryLink} bg-status-red-bg text-status-red sm:w-[280px]`}
            >
              Report a blocker
            </Link>
          )}
        </div>
        {messages}
        <TaskHistory id={task.id} updatedAt={task.updatedAt} />
      </section>
    );
  if (view === "blocker")
    return (
      <section className="flex flex-col gap-7">
        <Heading
          title="Report a blocker."
          subtitle={`#${id} · ${task.title}`}
          back={base}
          backLabel="Task details"
        />
        {!canEdit ? (
          <p>This task is not open for updates.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!details.trim()) {
                setError("Enter blocker details.");
                return;
              }
              void run(
                () => gateway.reportBlocker(id, type, details.trim()),
                "Blocker update sent.",
              );
            }}
            className="flex flex-col gap-7"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="blocker-type">Blocker type</Label>
              <select
                id="blocker-type"
                className={control}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {[
                  ["parts", "Waiting for replacement parts"],
                  ["access", "Access unavailable"],
                  ["safety", "Safety concern"],
                  ["other", "Other"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="blocker-details">Details</Label>
              <Textarea
                required
                id="blocker-details"
                maxLength={2000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Explain the blocker and what assistance you need."
                className="min-h-[100px] rounded-2xl bg-white p-4"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Management receives your blocker note. The task remains open until
              the repair is verified.
            </p>
            {messages}
            <Button type="submit" disabled={busy} className={action}>
              {busy ? "Saving…" : "Send blocker update"}
            </Button>
          </form>
        )}
      </section>
    );
  if (view === "update")
    return (
      <section className="flex flex-col gap-7">
        <Heading
          title="Update repair."
          subtitle={`#${id} · ${task.title}`}
          back={base}
          backLabel="Task details"
        />
        <Status status={task.status} />
        {!canEdit ? (
          <Link href={base} className={secondaryLink}>
            View task details
          </Link>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!notes.trim()) {
                setError("Enter work notes.");
                return;
              }
              void run(
                () => gateway.saveUpdate(id, notes.trim()),
                "Update saved.",
              );
            }}
            className="flex flex-col gap-7"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="work-notes">Work notes</Label>
              <Textarea
                required
                id="work-notes"
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe work completed so far."
                className="min-h-[100px] rounded-2xl bg-white p-4"
              />
            </div>
            {task.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Last update · {task.updatedAt}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Save progress notes or add completion evidence when the work is
              done.
            </p>
            {messages}
            <div className="grid gap-3 xl:grid-cols-3">
              <Button
                type="submit"
                variant="secondary"
                disabled={busy}
                className={action}
              >
                {busy ? "Saving…" : "Save update"}
              </Button>
              <Link href={base + "/evidence"} className={primaryLink}>
                Add completion evidence
              </Link>
              <Link
                href={base + "/blocker"}
                className={`${secondaryLink} bg-status-red-bg text-status-red`}
              >
                Report a blocker
              </Link>
            </div>
          </form>
        )}
      </section>
    );
  const rework = view === "rework";
  return (
    <section className="flex flex-col gap-7">
      <Heading
        title={rework ? "Changes requested." : "Completion evidence."}
        subtitle={`#${id} · ${task.title}`}
        back={rework ? "/maintenance" : base}
        backLabel={rework ? "My tasks" : "Task details"}
      />
      {rework && (
        <>
          <Status status="changes-requested">Rework required</Status>
          <div className="flex flex-col gap-3 rounded-3xl bg-secondary p-5">
            <h2 className="text-lg font-semibold">
              Please update the repair evidence.
            </h2>
            <p className="text-sm text-muted-foreground">{task.reviewNote}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Add new notes and evidence before
            resubmitting.
          </p>
        </>
      )}
      {!canEdit ? (
        <>
          <Status status={task.status} />
          <div className="grid gap-6 lg:grid-cols-2 lg:divide-x">
            <Photo label="Before / resident photo" url={task.beforePhotoUrl} />
            <Photo
              label="After / uploaded repair photo"
              url={task.afterPhotoUrl}
            />
          </div>
          <h2 className="font-semibold">Completion notes</h2>
          <p className="text-sm text-muted-foreground">
            {task.completionNotes || "No completion notes available."}
          </p>
          <Link href="/maintenance" className={primaryLink}>
            Back to my tasks
          </Link>
        </>
      ) : (
        <form
          onSubmit={submitEvidence}
          className="flex flex-col gap-7"
          aria-busy={busy}
        >
          {!rework && (
            <>
              <div className="grid gap-6 lg:grid-cols-2 lg:divide-x">
                <Photo
                  label="Before / resident photo"
                  url={task.beforePhotoUrl}
                />
                <Photo label="After / uploaded repair photo" url={preview} />
              </div>
              {upload}
            </>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="completion-notes">
              {rework ? "Updated completion notes" : "Completion notes"}
            </Label>
            <Textarea
              id="completion-notes"
              required
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                rework
                  ? "Describe the changes made after management feedback."
                  : "Describe the repair and checks completed on site."
              }
              className="min-h-[100px] rounded-2xl bg-white p-4"
            />
          </div>
          {rework && (
            <>
              <Photo label="New repair photo" url={preview} />
              {upload}
            </>
          )}
          <Label className="flex items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              required
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            Repair completed and checked on site
          </Label>
          <p className="text-xs text-muted-foreground">
            Management verifies the repair before the report becomes Resolved.
          </p>
          {messages}
          <Button disabled={busy} type="submit" className={action}>
            {busy
              ? "Submitting…"
              : rework
                ? "Resubmit for verification"
                : "Submit for verification"}
          </Button>
        </form>
      )}
    </section>
  );
}
