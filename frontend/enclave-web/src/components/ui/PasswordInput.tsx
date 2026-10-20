'use client';
import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
export default function PasswordInput({ className = '', ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <Input {...props} type={visible ? 'text' : 'password'} className={`h-[54px] rounded-2xl bg-white px-4 pr-14 text-sm shadow-none ${className}`} />
    <button type="button" disabled={props.disabled} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(!visible)} className="absolute inset-y-0 right-1 flex w-12 items-center justify-center rounded-xl text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
      {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
    </button>
  </div>;
}
