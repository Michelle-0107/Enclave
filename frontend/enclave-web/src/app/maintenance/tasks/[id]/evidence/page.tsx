
"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Shell, Heading } from "../../../../../../maintenance/src/app/maintenance/_components";

export default function CompletionEvidence() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [photo, setPhoto] = useState<File | null>(null);
  const [notes, setNotes] = useState(
    "Replaced lamp and tested operation on site."
  );
  const [checked, setChecked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!photo) {
      setError("Please upload an after-repair photo.");
      return;
    }

    if (!notes.trim()) {
      setError("Please enter completion notes.");
      return;
    }

    if (!checked) {
      setError("Please confirm the repair has been completed and checked.");
      return;
    }

    setSaving(true);

    try {
      // Read the selected image so it can be previewed and retained
      // in this browser for this prototype.
      const photoData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("Unable to read the selected photo."));
          }
        };

        reader.onerror = () =>
          reject(new Error("Unable to read the selected photo."));

        reader.readAsDataURL(photo);
      });

      const submittedAt = new Date().toISOString();
      const status = "Pending verification";

      const evidence = {
        taskId: id,
        photoName: photo.name,
        photoData,
        notes: notes.trim(),
        checked,
        submittedAt,
        status,
      };

      // Save evidence and status before navigating away.
      localStorage.setItem(
        `maintenance-task-${id}-evidence`,
        JSON.stringify(evidence)
      );

      localStorage.setItem(
        `maintenance-task-${id}-status`,
        status
      );

      localStorage.setItem(
        `maintenance-task-${id}-last-update`,
        new Date(submittedAt).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      );

      // Notify other components in this browser tab.
      window.dispatchEvent(new Event("maintenance-task-updated"));

      router.push(`/maintenance/tasks/${id}/submitted`);
    } catch {
      setError(
        "Unable to save the evidence. The photo may be too large for browser storage. Try a smaller image."
      );
    } finally {
      setSaving(false);
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
        title="Completion evidence."
        subtitle={`#${id} · ${taskTitle}`}
      />

      <form onSubmit={handleSubmit}>
        <div className="m-two-col">
          <div className="m-photo">
            <strong>Before / resident photo</strong>
            <p>Original report photo</p>
          </div>

          <div className="m-photo">
            <strong>After / uploaded repair photo</strong>

            {photo ? (
              <img
                src={URL.createObjectURL(photo)}
                alt="Selected after-repair evidence"
                style={{
                  display: "block",
                  width: "100%",
                  maxHeight: 240,
                  objectFit: "contain",
                  marginTop: 10,
                }}
              />
            ) : (
              <p>Photo preview</p>
            )}
          </div>
        </div>

        <label
          className="m-button secondary full"
          style={{
            marginTop: 14,
            cursor: "pointer",
            display: "block",
            textAlign: "center",
          }}
        >
          {photo ? "Choose a different photo" : "Upload after-repair photo"}

          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(event) => {
              setPhoto(event.target.files?.[0] ?? null);
              setError("");
            }}
          />
        </label>

        {photo && (
          <p className="m-help">
            Selected file: {photo.name}
          </p>
        )}

        <label
          className="m-field-label"
          htmlFor="completion-notes"
        >
          Completion notes
        </label>

        <textarea
          id="completion-notes"
          className="m-textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Describe the repair and checks performed..."
          rows={5}
          required
        />

        <label className="m-checkbox">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          Repair completed and checked on site
        </label>

        <p className="m-help">
          Management verifies the repair before the report becomes Resolved.
        </p>

        {error && (
          <p role="alert" style={{ color: "#b91c1c", marginTop: 12 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          className="m-button full"
          disabled={saving}
          style={{ marginTop: 16 }}
        >
          {saving ? "Submitting..." : "Submit for verification"}
        </button>
      </form>
    </Shell>
  );
}
