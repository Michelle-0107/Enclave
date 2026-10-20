'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createResident, issueResidentInvitation } from '@/lib/api';

type CreatedResident = { id: string; fullName: string; email: string };
type ResidentCreateProps = { modal?: boolean; onClose?: () => void; onCreated?: () => void };

export default function ResidentCreate({ modal = false, onClose, onCreated }: ResidentCreateProps = {}) {
  const [reference, setReference] = useState('');
  const [fullName, setFullName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [email, setEmail] = useState('');
  const [resident, setResident] = useState<CreatedResident | null>(null);
  const [invitationReady, setInvitationReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

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
      await issueResidentInvitation(result.resident_id);
      setInvitationReady(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to complete resident setup.');
    } finally {
      setWorking(false);
    }
  }

  async function issueInvitation() {
    if (!resident) return;
    setWorking(true);
    setError('');
    try {
      await issueResidentInvitation(resident.id);
      setInvitationReady(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to activate resident registration.');
    } finally {
      setWorking(false);
    }
  }

  const content = (
    <div className={`flex flex-col ${modal ? 'gap-4' : 'gap-6 max-w-3xl'}`}>
      {modal ? (
        <button type="button" onClick={onClose} disabled={working} className="w-fit text-sm font-semibold text-primary underline disabled:opacity-60">← Residents</button>
      ) : (
        <Link href="/management/residents" className="w-fit text-sm font-semibold text-primary underline">← Residents</Link>
      )}
      <h1 id="create-resident-title" className={`${modal ? 'text-2xl' : 'text-[30px] lg:text-[36px]'} font-semibold leading-[1.25] text-primary`}>Add resident.</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Add the resident using their registered email. They can then request a one-time verification code from the registration page.
      </p>

      {!resident ? (
        <form onSubmit={saveResident} className={`flex flex-col ${modal ? 'gap-3 p-4' : 'gap-5 p-5 sm:p-7'} rounded-3xl border border-border bg-card`}>
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Resident reference<input required maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Full name<input required maxLength={150} value={fullName} onChange={(event) => setFullName(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Unit number<input required maxLength={100} value={unitNumber} onChange={(event) => setUnitNumber(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-primary">Approved email<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-12 rounded-xl border border-border bg-white px-4 font-normal" /></label>
          <button disabled={working} className="min-h-12 rounded-2xl bg-brand px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{working ? 'Adding resident…' : 'Confirm and add resident'}</button>
        </form>
      ) : (
        <section className={`flex flex-col ${modal ? 'gap-3 p-4' : 'gap-4 p-5 sm:p-7'} rounded-3xl border border-border bg-card`}>
          <p className="text-sm font-semibold text-primary">Resident record created</p>
          <dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Name</dt><dd>{resident.fullName}</dd></div><div><dt className="font-semibold">Email</dt><dd>{resident.email}</dd></div><div><dt className="font-semibold">Resident ID</dt><dd className="break-all">{resident.id}</dd></div></dl>
          {!invitationReady ? (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">The resident record was added, but registration could not be activated. Retry to let this email request a verification code.</p>
              <button type="button" disabled={working} onClick={() => void issueInvitation()} className="min-h-12 rounded-2xl bg-brand px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{working ? 'Activating…' : 'Retry activation'}</button>
            </>
          ) : (
            <p role="status" className="rounded-2xl border border-border bg-white p-3 text-sm leading-relaxed text-primary">Resident added. They can register with <strong>{resident.email}</strong> and request a verification code. No invitation token needs to be copied or shared.</p>
          )}
        </section>
      )}
      {error && <p role="alert" className="rounded-xl bg-status-red-bg p-3 text-sm text-status-red">{error}</p>}
    </div>
  );

  if (!modal) return content;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/45 p-3 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose?.(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="create-resident-title" className="my-auto max-h-[84dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-border bg-card p-4 shadow-xl sm:p-6">
        {content}
      </section>
    </div>
  );
}
