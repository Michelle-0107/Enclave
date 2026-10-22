"use client";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  busy = false,
  destructive = false,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-xl font-semibold text-primary">{title}</h2>
        <p id="confirm-dialog-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-border px-5 text-sm font-semibold text-primary disabled:opacity-60">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className={`min-h-11 rounded-xl px-5 text-sm font-semibold disabled:opacity-60 ${destructive ? 'bg-status-red text-white hover:bg-status-red/90' : 'bg-brand text-primary-foreground'}`}>
            {busy ? "Signing out…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
