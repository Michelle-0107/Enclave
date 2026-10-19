import { UserRound } from 'lucide-react';

type Props = { role: 'management' | 'maintenance'; name?: string; compact?: boolean };
export default function StaffProfile({ role, name, compact = false }: Props) {
  const label = name?.trim() || (role === 'management' ? 'Management staff' : 'Maintenance staff');
  return <span className="flex min-w-0 items-center gap-2.5">
    <span className="staff-avatar flex size-9 shrink-0 items-center justify-center rounded-full" aria-hidden="true">
      {role === 'management' ? <span className="size-5 bg-current" style={{ mask: 'url(/images/enclave-logo.png) center / contain no-repeat', WebkitMask: 'url(/images/enclave-logo.png) center / contain no-repeat' }} /> : <UserRound size={21} strokeWidth={1.7} />}
    </span>
    {!compact && <span className="truncate text-sm font-semibold" title={label}>{label}</span>}
  </span>;
}
