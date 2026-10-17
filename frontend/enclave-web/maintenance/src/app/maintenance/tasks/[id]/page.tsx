
"use client";

import { use, useEffect, useState } from "react";
import { Shell, Heading, Pill, ButtonLink } from "../../_components";

type EvidenceRecord = {
  photoName: string;
  notes: string;
  submittedAt: string;
  status: string;
};

export default function TaskDetails({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const isRework = id === "1025";

  const [status, setStatus] = useState(
    isRework ? "Changes requested" : "Assigned · High"
  );
  const [evidence, setEvidence] = useState<EvidenceRecord | null>(null);

  const statusKey = `maintenance-task-${id}-status`;
  const evidenceKey = `maintenance-task-${id}-evidence`;

  useEffect(() => {
    function loadTaskData() {
      try {
        const storedStatus = localStorage.getItem(statusKey);
        const storedEvidence = localStorage.getItem(evidenceKey);

        if (storedStatus) {
          setStatus(storedStatus);
        } else {
          setStatus(
            isRework ? "Changes requested" : "Assigned · High"
          );
        }

        if (storedEvidence) {
          const parsed = JSON.parse(storedEvidence) as EvidenceRecord;
          setEvidence(parsed);
        } else {
          setEvidence(null);
        }
      } catch {
        // Keep the existing status if browser storage is unavailable.
      }
    }

    loadTaskData();

    window.addEventListener("storage", loadTaskData);
    window.addEventListener("maintenance-task-updated", loadTaskData);

    return () => {
      window.removeEventListener("storage", loadTaskData);
      window.removeEventListener(
        "maintenance-task-updated",
        loadTaskData
      );
    };
  }, [id, isRework, statusKey, evidenceKey]);

  const taskTitle = isRework
    ? "Broken kerb ramp"
    : "Streetlight malfunction";

  return (
    <Shell active="tasks">
      <div className="m-breadcrumb" style={{ marginBottom: 18 }}>
        <a href="/maintenance">‹ My tasks</a>
      </div>

      <Heading
        title={taskTitle}
        subtitle={`#${id} · Assigned 14 Oct 2026`}
      />

      <div className="m-row" style={{ marginBottom: 20 }}>
        <Pill>{status}</Pill>
      </div>

      <div className="m-two-col">
        <div className="m-photo">
          <strong>Resident photo / before repair</strong>
          <p>Original report photo</p>
        </div>

        <div className="m-card">
          <h3 className="m-card-title">Electrical team</h3>
          <p className="m-muted">Target completion: 19 Oct 2026</p>
          <p className="m-muted">
            Inspect fitting and power supply. Test operation after repair.
          </p>
        </div>
      </div>

      <div className="m-card" style={{ marginTop: 14 }}>
        <h3 className="m-card-title">
          Park Entrance · Streetlight A
        </h3>
        <p className="m-muted">
          The streetlight near the park entrance does not turn on at night.
        </p>
      </div>

      {isRework && status === "Changes requested" && (
        <div className="m-notice">
          <strong>Changes requested</strong>
          <p>
            Please upload a clearer photo of the repaired ramp and confirm
            the walking surface is level.
          </p>
        </div>
      )}

      {evidence && (
        <div className="m-card" style={{ marginTop: 14 }}>
          <h3 className="m-card-title">Submitted completion evidence</h3>
          <p className="m-muted">
            Photo: {evidence.photoName}
          </p>
          <p className="m-muted">
            Notes: {evidence.notes}
          </p>
          <p className="m-muted">
            Submitted:{" "}
            {new Date(evidence.submittedAt).toLocaleString("en-GB")}
          </p>
        </div>
      )}

      <div className="m-button-row" style={{ marginTop: 18 }}>
        <ButtonLink href={`/maintenance/tasks/${id}/update`}>
          Update repair
        </ButtonLink>

        <ButtonLink href={`/maintenance/tasks/${id}/evidence`}>
          {evidence ? "Update evidence" : "Add completion evidence"}
        </ButtonLink>

        <ButtonLink
          href={`/maintenance/tasks/${id}/blocker`}
          tone="danger"
        >
          Report a blocker
        </ButtonLink>
      </div>
    </Shell>
  );
}
