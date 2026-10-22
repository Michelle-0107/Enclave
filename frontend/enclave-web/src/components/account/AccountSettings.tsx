'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Camera, KeyRound } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { changeAccountPassword } from '@/lib/auth-session';
import { getAccountProfile, uploadAccountPhoto } from '@/lib/account-api';
import PasswordInput from '@/components/ui/PasswordInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function AccountSettings() {
  const { user, displayName } = useAuth();
  const [panel, setPanel] = useState<'password' | 'photo' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [avatar, setAvatar] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    let live = true;
    void getAccountProfile().then(p => { if (live && p.avatar_url?.startsWith('https://')) setAvatar(p.avatar_url); }).catch(() => { /* Profile photos are optional until the backend supports them. */ });
    return () => { live = false; };
  }, [user?.user_id]);
  useEffect(() => { return () => { if (preview) URL.revokeObjectURL(preview); }; }, [preview]);
  function close() {
    if (busy) return;
    setPanel(null); setCurrent(''); setNext(''); setConfirm(''); setPhoto(null); setPreview(''); setError('');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try {
      if (panel === 'password') {
        if (!user?.email) throw new Error('Please sign in again.');
        if (next !== confirm) throw new Error('The new passwords do not match.');
        await changeAccountPassword(user.email, current, next);
        setSuccess('Your password has been changed.');
      } else {
        if (!photo) throw new Error('Choose a JPG or PNG photo first.');
        const result = await uploadAccountPhoto(photo); setAvatar(result.avatar_url!);
        window.dispatchEvent(new CustomEvent('enclave-avatar-updated', { detail: { userId: user?.user_id, url: result.avatar_url } }));
        setSuccess('Your profile photo has been updated.');
      }
      setPanel(null); setCurrent(''); setNext(''); setConfirm(''); setPhoto(null); setPreview('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="flex flex-col gap-4" aria-label="Profile settings">
    <div className="flex items-center gap-4">
      <span className="staff-avatar flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-xl font-semibold">
        {/* Uploaded photos can use private signed URLs from the account service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {avatar ? <img src={avatar} alt="Your profile" className="size-full object-cover" /> : (displayName.trim().charAt(0) || 'E')}
      </span><div><h2 className="font-semibold">{displayName || 'My profile'}</h2><p className="text-sm text-muted-foreground">Manage your photo and password.</p></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Button variant="outline" className="min-h-12 rounded-2xl" onClick={() => { setSuccess(''); setPanel('photo'); }}><Camera size={18} />Change photo</Button>
      <Button variant="outline" className="min-h-12 rounded-2xl" onClick={() => { setSuccess(''); setPanel('password'); }}><KeyRound size={18} />Change password</Button>
    </div>
    {success && <p role="status" className="rounded-xl bg-[#DFF3F2] p-3 text-sm text-[#216E71]">{success}</p>}
    <Dialog open={panel !== null} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl p-6 sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="text-xl font-semibold">{panel === 'password' ? 'Change password' : 'Change profile photo'}</DialogTitle>
        <DialogDescription>{panel === 'password' ? 'Confirm your current password, then choose a new one.' : 'Choose a JPG or PNG photo, up to 5 MB.'}</DialogDescription>
        <form onSubmit={save} className="flex flex-col gap-4" aria-busy={busy}>
          {panel === 'password' ? <>
            <label htmlFor="account-current">Current password</label><PasswordInput id="account-current" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required disabled={busy} />
            <label htmlFor="account-new">New password</label><PasswordInput id="account-new" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={8} required disabled={busy} />
            <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
            <label htmlFor="account-confirm">Confirm new password</label><PasswordInput id="account-confirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required disabled={busy} />
          </> : <>
            <label htmlFor="account-photo">Profile photo</label><input id="account-photo" type="file" accept="image/jpeg,image/png" disabled={busy} className="w-full rounded-xl border p-3" onChange={event => {
              setError(''); const file = event.target.files?.[0]; setPhoto(null); setPreview('');
              if (!file) return;
              if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Choose a JPG or PNG photo smaller than 5 MB.'); event.target.value = ''; return; }
              setPhoto(file); setPreview(URL.createObjectURL(file));
            }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {(preview || avatar) && <img src={preview || avatar} alt="Profile photo preview" className="mx-auto size-28 rounded-full object-cover" />}
          </>}
          {error && <p role="alert" className="text-sm text-[#A13832]">{error}</p>}
          <div className="flex gap-3 pt-2"><Button type="button" variant="outline" onClick={close} disabled={busy} className="min-h-12 flex-1 rounded-2xl">Cancel</Button><Button type="submit" disabled={busy || (panel === 'photo' && !photo)} className="min-h-12 flex-1 rounded-2xl bg-brand text-white">{busy ? 'Saving…' : 'Save changes'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
