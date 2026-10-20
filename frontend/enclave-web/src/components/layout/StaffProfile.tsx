'use client';
import { useEffect, useState } from 'react';
import EnclaveLogo from '@/components/ui/EnclaveLogo';
import { useAuth } from '@/components/auth/AuthProvider';
import { getAccountProfile } from '@/lib/account-api';
type Props = { role: 'management' | 'maintenance'; name?: string; compact?: boolean };
export default function StaffProfile({ role, name, compact = false }: Props) {
  const { user } = useAuth();
  const [photo, setPhoto] = useState<{ userId: string; url: string } | null>(null);
  const label = name?.trim() || (role === 'management' ? 'Management staff' : 'Maintenance staff');
  const avatar = photo?.userId === user?.user_id ? photo?.url : '';
  useEffect(() => {
    let live = true;
    const userId = user?.user_id;
    if (!userId) return;
    void getAccountProfile().then(profile => { if (live && profile.avatar_url?.startsWith('https://')) setPhoto({ userId, url: profile.avatar_url }); }).catch(() => {});
    function updated(event: Event) {
      const detail = (event as CustomEvent<{ userId: string; url: string }>).detail;
      if (detail.userId === userId && detail.url?.startsWith('https://')) setPhoto({ userId: detail.userId, url: detail.url });
    }
    window.addEventListener('enclave-avatar-updated', updated);
    return () => { live = false; window.removeEventListener('enclave-avatar-updated', updated); };
  }, [user?.user_id]);
  return <span className="flex min-w-0 items-center gap-2.5">
    <span className="staff-avatar flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {avatar ? <img src={avatar} alt="" className="size-full object-cover" onError={() => setPhoto(null)} /> : <EnclaveLogo className="h-5 w-[18px]" />}
    </span>
    {!compact && <span className="truncate text-sm font-semibold" title={label}>{label}</span>}
  </span>;
}
