'use client';

import { useEffect, useState, type FormEvent } from 'react';
import PasswordInput from '@/components/ui/PasswordInput';
import EnclaveLogo from '@/components/ui/EnclaveLogo';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/auth/AuthProvider';

export default function SignIn() {
  const router = useRouter();
  const { signIn, ready, user, role } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready || !user || !role) return;
    router.replace(role === 'management' ? '/management' : '/maintenance');
  }, [ready, user, role, router]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (loading) return;

    setError('');

    if (!email.trim() || !password) {
      setError('Please enter your work email and password.');
      return;
    }

    setLoading(true);

    try {
      const role = await signIn(email.trim(), password);
      router.replace(role === 'management' ? '/management' : '/maintenance');
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : 'Unable to sign in. Please check your details and try again.');
    } finally {
      setLoading(false);
    }
  }

  function clearMessages() {
    setError('');
  }

  return (
    <div className="min-h-dvh bg-background text-primary lg:flex">
      <aside className="flex flex-col gap-9 bg-white p-4 lg:min-h-dvh lg:w-[248px] lg:shrink-0">
        <div className="flex items-center gap-3">
          <EnclaveLogo className="h-[29px] w-6" />

          <span className="text-[23px] font-bold tracking-[5px] text-[#526B8A]">
            ENCLAVE
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Staff portal
        </p>

        <div className="hidden flex-col gap-6 rounded-3xl bg-[#526B8A] px-5 py-8 text-white lg:flex">
          <EnclaveLogo white className="h-[76px] w-16" />

          <p className="text-[22px] font-semibold leading-[1.45]">
            Better care.
            <br />
            Better living.
          </p>

          <p className="text-[13px] leading-[1.45] text-[#E6EDF5]">
            Your community.
            <br />
            One shared workspace.
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-6 py-10 lg:px-10 lg:pt-[72px]">
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          <h1 className="text-[30px] font-semibold leading-[1.45] lg:text-[36px]">
            Welcome back.
          </h1>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Sign in with your assigned staff account.
          </p>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6"
            aria-busy={loading}
          >
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="staff-email"
                className="text-sm font-semibold"
              >
                Work email
              </Label>

              <Input
                id="staff-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={loading}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearMessages();
                }}
                placeholder="Enter your work email"
                className="h-[54px] rounded-2xl bg-white px-4 text-sm shadow-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="staff-password"
                className="text-sm font-semibold"
              >
                Password
              </Label>

              <PasswordInput
                id="staff-password"
                name="password"
                autoComplete="current-password"
                required
                disabled={loading}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearMessages();
                }}
                placeholder="Enter your password"
                className="h-[54px] rounded-2xl bg-white px-4 text-sm shadow-none"
              />
            </div>

            <p className="text-right text-[13px] text-muted-foreground">
              For password resets, contact your workspace administrator.
            </p>

            {error && (
              <p
                role="alert"
                className="text-sm leading-relaxed text-status-red"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="min-h-[52px] w-full rounded-2xl bg-brand px-6 text-sm font-semibold text-primary-foreground"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

          </form>

          <p className="text-xs text-muted-foreground">
            Need a management account?{' '}
            <Link href="/sign-up" className="font-semibold text-primary underline-offset-4 hover:underline">
              Request access
            </Link>
          </p>


        </div>
      </main>
    </div>
  );
}
