'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import ResidentCreate from '@/components/management/ResidentCreate';
import {
  deleteResident,
  getManagementResidents,
  updateResident,
  type ManagementResident,
  type UpdateResidentInput,
} from '@/lib/api';

const blankForm: UpdateResidentInput = {
  resident_reference: '',
  full_name: '',
  unit_number: '',
  registered_email: '',
  status: 'active',
};

function validateResident(form: UpdateResidentInput) {
  if (!form.resident_reference.trim() || form.resident_reference.trim().length > 100) {
    return 'Resident reference is required and must be 100 characters or fewer.';
  }
  if (!form.full_name.trim() || form.full_name.trim().length > 150) {
    return 'Full name is required and must be 150 characters or fewer.';
  }
  if (!form.unit_number.trim() || form.unit_number.trim().length > 100) {
    return 'Unit number is required and must be 100 characters or fewer.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.registered_email.trim()) || form.registered_email.trim().length > 254) {
    return 'Enter a valid email address of 254 characters or fewer.';
  }
  if (form.status !== 'active' && form.status !== 'inactive') {
    return 'Choose a valid resident status.';
  }
  return '';
}

export default function Residents() {
  const [residents, setResidents] = useState<ManagementResident[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ManagementResident | null>(null);
  const [form, setForm] = useState<UpdateResidentInput>(blankForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const loadResidents = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await getManagementResidents();
      setResidents(response.residents);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'Unable to load resident records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  useEffect(() => {
    if (!selected) return;
    setForm({
      resident_reference: selected.resident_reference,
      full_name: selected.full_name,
      unit_number: selected.unit_number,
      registered_email: selected.registered_email,
      status: selected.status,
    });
    setFormError('');
    setConfirmDelete(false);
  }, [selected]);

  const filteredResidents = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return residents;
    return residents.filter((resident) => [
      resident.resident_reference,
      resident.full_name,
      resident.unit_number,
      resident.registered_email,
      resident.status,
    ].some((field) => field.toLowerCase().includes(value)));
  }, [query, residents]);

  async function saveResident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const validationError = validateResident(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await updateResident(selected.resident_id, {
        resident_reference: form.resident_reference.trim(),
        full_name: form.full_name.trim().replace(/\s+/g, ' '),
        unit_number: form.unit_number.trim(),
        registered_email: form.registered_email.trim().toLowerCase(),
        status: form.status,
      });
      setSelected(null);
      setNotice('Resident record updated.');
      await loadResidents();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to update this resident record.');
    } finally {
      setSaving(false);
    }
  }

  async function removeResident() {
    if (!selected) return;
    setDeleting(true);
    setFormError('');
    try {
      await deleteResident(selected.resident_id);
      setSelected(null);
      setConfirmDelete(false);
      setNotice('Resident account, reports, and resident record permanently deleted.');
      await loadResidents();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to delete this resident.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">Resident records.</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Manage approved resident records and their account-link status.
      </p>
      <button type="button" onClick={() => setCreateOpen(true)} className="flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-[240px]">
        Add resident
      </button>

      <section aria-labelledby="resident-directory-title" className="flex flex-col gap-4 rounded-3xl bg-enclave-lavender p-5 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="resident-directory-title" className="text-lg font-semibold text-primary">Resident directory</h2>
            <p className="mt-1 text-sm text-muted-foreground">{residents.length} resident record{residents.length === 1 ? '' : 's'}</p>
          </div>
          <label className="flex w-full flex-col gap-1 text-xs font-semibold text-primary sm:max-w-xs">
            Search residents
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, unit, email, or reference" className="min-h-11 rounded-xl border border-border bg-white px-3 text-sm font-normal" />
          </label>
        </div>

        {notice && <p role="status" className="rounded-xl bg-status-green-bg p-3 text-sm text-status-green">{notice}</p>}
        {loading ? (
          <p role="status" className="rounded-2xl bg-white p-5 text-sm text-muted-foreground">Loading resident records…</p>
        ) : loadError ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-white p-5">
            <p role="alert" className="text-sm text-status-red">{loadError}</p>
            <button type="button" onClick={() => void loadResidents()} className="min-h-10 w-fit rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Retry</button>
          </div>
        ) : residents.length === 0 ? (
          <p className="rounded-2xl bg-white p-5 text-sm leading-relaxed text-muted-foreground">No resident records have been added yet. Use “Add resident” to create the first approved record.</p>
        ) : filteredResidents.length === 0 ? (
          <p className="rounded-2xl bg-white p-5 text-sm text-muted-foreground">No residents match that search.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Resident</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Reference</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Unit</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Registered email</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Account</th>
                  <th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredResidents.map((resident) => (
                  <tr key={resident.resident_id}>
                    <td className="px-4 py-4 font-semibold text-primary">{resident.full_name}</td>
                    <td className="px-4 py-4 text-muted-foreground">{resident.resident_reference}</td>
                    <td className="px-4 py-4 text-muted-foreground">{resident.unit_number}</td>
                    <td className="px-4 py-4 text-muted-foreground">{resident.registered_email}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${resident.status === 'active' ? 'bg-status-green-bg text-status-green' : 'bg-status-red-bg text-status-red'}`}>
                        {resident.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{resident.account_linked ? `Linked · ${resident.verified_at ? new Date(resident.verified_at).toLocaleDateString() : 'verified'}` : 'Not registered'}</td>
                    <td className="px-4 py-4 text-right">
                      <button type="button" onClick={() => { setNotice(''); setSelected(resident); }} className="min-h-10 rounded-xl border border-border px-3 text-sm font-semibold text-primary hover:bg-secondary">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {createOpen && (
        <ResidentCreate
          modal
          onClose={() => setCreateOpen(false)}
          onCreated={() => void loadResidents()}
        />
      )}

      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !deleting) setSelected(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="edit-resident-title" className="my-auto w-full max-w-xl rounded-3xl border border-border bg-card p-5 shadow-xl sm:p-7">
            <h2 id="edit-resident-title" className="text-xl font-semibold text-primary">Edit resident record</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Resident values are validated before saving. Email cannot be changed after the resident links an account.</p>
            <form onSubmit={(event) => void saveResident(event)} className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-primary">Resident reference
                <input required maxLength={100} value={form.resident_reference} onChange={(event) => setForm({ ...form, resident_reference: event.target.value })} className="min-h-11 rounded-xl border border-border bg-white px-3 font-normal" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-primary">Full name
                <input required maxLength={150} value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} className="min-h-11 rounded-xl border border-border bg-white px-3 font-normal" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-primary">Unit number
                <input required maxLength={100} value={form.unit_number} onChange={(event) => setForm({ ...form, unit_number: event.target.value })} className="min-h-11 rounded-xl border border-border bg-white px-3 font-normal" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-primary">Registered email
                <input required type="email" maxLength={254} disabled={selected.account_linked} value={form.registered_email} onChange={(event) => setForm({ ...form, registered_email: event.target.value })} className="min-h-11 rounded-xl border border-border bg-white px-3 font-normal disabled:bg-secondary disabled:text-muted-foreground" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-primary">Resident status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as UpdateResidentInput['status'] })} className="min-h-11 rounded-xl border border-border bg-white px-3 font-normal">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              {formError && <p role="alert" className="rounded-xl bg-status-red-bg p-3 text-sm text-status-red">{formError}</p>}
              {form.status === 'inactive' && selected.status !== 'inactive' && <p className="rounded-xl bg-status-orange-bg p-3 text-sm text-status-orange">Setting this resident inactive revokes unused invitations and pending verification codes.</p>}
              {confirmDelete && (
                <div role="alert" className="rounded-2xl border border-status-red/30 bg-status-red-bg p-4">
                  <p className="font-semibold text-status-red">Permanently delete {selected.full_name}?</p>
                  <p className="mt-2 text-sm leading-relaxed text-status-red">This removes the resident record, Supabase login account, their submitted reports and status history, and associated report photos. This cannot be undone. Public facilities and management-wide notifications will remain.</p>
                  <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-primary disabled:opacity-60">Keep resident</button>
                    <button type="button" disabled={deleting} onClick={() => void removeResident()} className="min-h-10 rounded-xl bg-status-red px-4 text-sm font-semibold text-white disabled:opacity-60">{deleting ? 'Deleting…' : 'Delete permanently'}</button>
                  </div>
                </div>
              )}
              <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" disabled={saving || deleting} onClick={() => setSelected(null)} className="min-h-11 rounded-xl border border-border px-5 text-sm font-semibold text-primary disabled:opacity-60">Cancel</button>
                <button type="button" disabled={saving || deleting} onClick={() => setConfirmDelete(true)} className="min-h-11 rounded-xl bg-status-red-bg px-5 text-sm font-semibold text-status-red disabled:opacity-60">Delete resident</button>
                <button type="submit" disabled={saving || deleting} className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
