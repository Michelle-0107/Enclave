'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createResident, issueResidentInvitation, type InvitationResult } from '@/lib/api';

type CreatedResident = { id: string; fullName: string; email: string };
type ResidentCreateProps = { modal?: boolean; onClose?: () => void; onCreated?: () => void };

export default function ResidentCreate({ modal = false, onClose, onCreated }: ResidentCreateProps = {}) {
  const [reference, setReference] = useState('');
  const [fullName, setFullName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [email, setEmail] = useState('');
  const [resident, setResident] = useState<CreatedResident | null>(null);
  const [invitation, setInvitation] = useState<InvitationResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function saveResident(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      const result = await createResident({
        resident_reference: reference.trim(),
        full_name: fullName.trim(),
        unit_number: unitNumber.trim(),
        registered_email: email.trim().toLowerCase(),
      });
      setResident({ id: result.resident_id, fullName: fullName.trim(), email: email.trim().toLowerCase() });
      onCreated?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create resident record.');
    } finally {
      setWorking(false);
    }
  }

  async function issueInvitation() {
    if (!resident) return;
    setWorking(true);
    setError('');
    try {
      setInvitation(await issueResidentInvitation(resident.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to issue invitation.');
    } finally {
      setWorking(false);
    }
  }

  async function copyInvitation() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.invitation_token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the invitation token manually.');
    }
  }

  const content = (
    <div className={`flex flex-col gap-6 ${modal ? '' : 'max-w-3xl'}`}>
      {modal ? (
        <button type="button" onClick={onClose} disabled={working} className="w-fit text-sm font-semibold text-primary underline disabled:opacity-60">← Residents</button>
      ) : (
        <Link href="/management/residents" className="w-fit text-sm font-semibold text-primary underline">← Residents</Link>
      )}
      <h1 id="create-resident-title" className="text-[30px] font-semibold leading-[1.35] text-primary lg:text-[36px]">Add resident.</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Create an approved resident record, then issue a one-time invitation token. The invitation endpoint does not send email; share the token with the resident through your approved private channel.
      </p>

      {!resident ? (
        <form onSubmit={saveResident} className="flex flex-col gap-5 rounded-3xl bg-enclave-lavender p-5 sm:p-7">
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Resident reference<input required maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Full name<input required maxLength={150} value={fullName} onChange={(event) => setFullName(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Unit number<input required maxLength={100} value={unitNumber} onChange={(event) => setUnitNumber(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Approved email<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <button disabled={working} className="min-h-12 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{working ? 'Saving…' : 'Create resident record'}</button>
        </form>
      ) : (
        <section className="flex flex-col gap-4 rounded-3xl bg-enclave-lavender p-5 sm:p-7">
          <p className="text-sm font-semibold text-primary">Resident record created</p>
          <dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Name</dt><dd>{resident.fullName}</dd></div><div><dt className="font-semibold">Email</dt><dd>{resident.email}</dd></div><div><dt className="font-semibold">Resident ID</dt><dd className="break-all">{resident.id}</dd></div></dl>
          {!invitation ? (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">Issue a single-use invitation for this resident. If you leave after issuing it, the token cannot be retrieved again; you would need to issue a replacement.</p>
              <button type="button" disabled={working} onClick={() => void issueInvitation()} className="min-h-12 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{working ? 'Issuing…' : 'Issue invitation token'}</button>
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4">
              <p className="text-sm font-semibold text-primary">Invitation issued · expires {new Date(invitation.expires_at).toLocaleString()}</p>
              <code className="block max-h-28 overflow-auto break-all rounded-xl bg-enclave-lavender p-3 text-xs">{invitation.invitation_token}</code>
              <button type="button" onClick={() => void copyInvitation()} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{copied ? 'Copied' : 'Copy token'}</button>
              <p className="text-xs leading-relaxed text-muted-foreground">This token is shown only now. Deliver it privately; do not add it to public messages or GitHub.</p>
            </div>
          )}
        </section>
      )}
      {error && <p role="alert" className="rounded-xl bg-status-red-bg p-3 text-sm text-status-red">{error}</p>}
    </div>
  );

  if (!modal) return content;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose?.(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="create-resident-title" className="my-auto w-full max-w-3xl rounded-3xl border border-border bg-card p-5 shadow-xl sm:p-7">
        {content}
      </section>
    </div>
  );
}
