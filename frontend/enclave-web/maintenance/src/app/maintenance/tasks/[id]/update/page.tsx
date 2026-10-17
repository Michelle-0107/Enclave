
"use client";

import { use, useEffect, useState } from "react";
import { Shell, Heading, Pill, ButtonLink } from "../../../_components";

type TaskStatus =
  | "In progress"
  | "Pending verification"
  | "Completed"
  | "Blocked";

export default function UpdateRepair({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [workNotes, setWorkNotes] = useState(
    "Inspected fitting. Replacement lamp installed."
  );
  const [lastUpdate, setLastUpdate] = useState("16 Oct 2026");
  const [status, setStatus] = useState<TaskStatus>("In progress");
  const [saved, setSaved] = useState(false);
  const [mounted, setMounted] = useState(false);

  const storageKey = `maintenance-task-${id}-work-notes`;
  const dateKey = `maintenance-task-${id}-last-update`;
  const statusKey = `maintenance-task-${id}-status`;

  useEffect(() => {
    function loadTaskData() {
      try {
        const storedNotes = localStorage.getItem(storageKey);
        const storedDate = localStorage.getItem(dateKey);
        const storedStatus = localStorage.getItem(statusKey);

        if (storedNotes !== null) setWorkNotes(storedNotes);
        if (storedDate) setLastUpdate(storedDate);

        if (
          storedStatus === "In progress" ||
          storedStatus === "Pending verification" ||
          storedStatus === "Completed" ||
          storedStatus === "Blocked"
        ) {
          setStatus(storedStatus);
        }
      } catch {
        // Keep default values if browser storage is unavailable.
      }

      setMounted(true);
    }

    loadTaskData();

    // Listen for updates from other browser tabs.
    window.addEventListener("storage", loadTaskData);

    // Listen for updates from other pages in this tab.
    window.addEventListener("maintenance-task-updated", loadTaskData);

    return () => {
      window.removeEventListener("storage", loadTaskData);
      window.removeEventListener(
        "maintenance-task-updated",
        loadTaskData
      );
    };
  }, [storageKey, dateKey, statusKey]);

  function handleSave() {
    if (!workNotes.trim()) {
      window.alert("Please enter your work notes before saving.");
      return;
    }

    try {
      const today = new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

      localStorage.setItem(storageKey, workNotes.trim());
      localStorage.setItem(dateKey, today);

      setWorkNotes(workNotes.trim());
      setLastUpdate(today);
      setSaved(true);
    } catch {
      window.alert("Unable to save your update.");
    }
  }

  const taskTitle =
    id === "1025" ? "Broken kerb ramp" : "Streetlight malfunction";

  return (
    <Shell active="tasks">
      <div className="m-breadcrumb" style={{ marginBottom: 18 }}>
        <a href={`/maintenance/tasks/${id}`}>‹ Task details</a>
      </div>

      <Heading
        title="Update repair."
        subtitle={`#${id} · ${taskTitle}`}
      />

      <div className="m-row">
        <Pill>{mounted ? status : "In progress"}</Pill>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        <label className="m-field-label" htmlFor="work-notes">
          Work notes
        </label>

        <textarea
          id="work-notes"
          name="workNotes"
          className="m-textarea"
          value={workNotes}
          onChange={(event) => {
            setWorkNotes(event.target.value);
            setSaved(false);
          }}
          placeholder="Describe the repair work completed so far..."
          rows={6}
          required
        />

        <p className="m-help">Last update · {lastUpdate}</p>

        <p className="m-muted" style={{ marginTop: 18 }}>
          Save progress notes or add completion evidence when the work is done.
        </p>

        {saved && (
          <p role="status" style={{ marginTop: 12 }}>
            ✓ Work notes saved successfully.
          </p>
        )}

        <div
          className="m-button-row"
          style={{ marginTop: 20, flexWrap: "wrap" }}
        >
          <button
            type="submit"
            disabled={!mounted}
            className="m-button"
          >
            Save update
          </button>

          <ButtonLink href={`/maintenance/tasks/${id}/evidence`}>
            Add completion evidence
          </ButtonLink>

          <ButtonLink
            href={`/maintenance/tasks/${id}/blocker`}
            tone="danger"
          >
            Report a blocker
          </ButtonLink>
        </div>
      </form>
    </Shell>
  );
}
