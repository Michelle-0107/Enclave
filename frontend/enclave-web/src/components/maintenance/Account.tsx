"use client";
import AccountSettings from '@/components/account/AccountSettings';
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useMaintenance } from "./MaintenanceProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { action, Heading } from "./Common";
export default function Account() {
  const { onSignOut, displayName } = useMaintenance();
  const { user } = useAuth();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const router = useRouter();
  async function logout() {
    setBusy(true);
    try {
      await onSignOut();
      router.replace("/sign-in");
    } catch {
      setNotice("Unable to sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-7">
      <Heading
        title="My account."
        subtitle="Your maintenance workspace."
        back={null}
      />
      <div className="flex flex-col gap-[14px] rounded-3xl bg-secondary p-5">
        <h2 className="text-[22px] font-semibold">{displayName}</h2>
        <p className="text-sm text-muted-foreground">Maintenance staff account</p>
      </div>
      <AccountSettings />
      <h2 className="text-sm font-semibold">Work email</h2>
      <p className="text-sm text-muted-foreground">
        {user?.email ?? "Email unavailable"}
      </p>
      <hr />
      <h2 className="font-semibold">Help &amp; support</h2>
      <p className="text-sm text-muted-foreground">
        Contact management for task reassignment or account support.
      </p>
      <Button
        variant="secondary"
        className={action}
        disabled={busy}
        onClick={() => setConfirmSignOut(true)}
      >
        {busy ? "Signing out…" : "Log out"}
      </Button>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <ConfirmDialog
        open={confirmSignOut}
        title="Confirm log out"
        description="Are you sure you want to log out of your maintenance account?"
        confirmLabel="Log out"
        busy={busy}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => void logout()}
      />
    </section>
  );
}
