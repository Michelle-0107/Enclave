'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type StaffSignInInput = {
  email: string;
  password: string;
};

type Props = {
  /**
   * Backend team connects authentication here.
   * After successful login, redirect according to
   * the user's verified role.
   */
  onSignIn?: (input: StaffSignInInput) => Promise<void>;
};

export default function SignIn({ onSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (loading) return;

    setError('');
    setNotice('');

    if (!email.trim() || !password) {
      setError('Please enter your work email and password.');
      return;
    }

    if (!onSignIn) {
      setNotice(
        'Sign in is not connected yet. Please contact the development team for authentication testing.',
      );
      return;
    }

    setLoading(true);

    try {
      await onSignIn({
        email: email.trim(),
        password,
      });
    } catch {
      setError(
        'Unable to sign in. Please check your details and try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  function clearMessages() {
    setError('');
    setNotice('');
  }

  return (
    <div className="min-h-dvh bg-background text-primary lg:flex">
      <aside className="flex flex-col gap-9 bg-white p-4 lg:min-h-dvh lg:w-[248px] lg:shrink-0">
        <div className="flex items-center gap-3">
          <Image
            src="/images/enclave-logo.png"
            alt=""
            width={24}
            height={29}
            className="object-contain"
          />

          <span className="text-[23px] font-bold tracking-[5px]">
            ENCLAVE
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Staff portal
        </p>

        <div className="hidden flex-col gap-6 rounded-3xl bg-enclave-lavender px-5 py-8 lg:flex">
          <Image
            src="/images/enclave-logo.png"
            alt=""
            width={64}
            height={76}
            className="object-contain"
          />

          <p className="text-[22px] font-semibold leading-[1.45]">
            Better care.
            <br />
            Better living.
          </p>

          <p className="text-[13px] leading-[1.45] text-muted-foreground">
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

              <Input
                id="staff-password"
                name="password"
                type="password"
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

            <Link
              href="/forgot-password"
              className="flex min-h-11 items-center justify-end text-[13px] font-semibold hover:underline"
            >
              Forgot password?
            </Link>

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
              className="min-h-[52px] w-full rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

            {notice && (
              <p
                role="status"
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {notice}
              </p>
            )}
          </form>

          <p className="text-xs text-muted-foreground">
            Need access? Contact your administrator.
          </p>
        </div>
      </main>
    </div>
  );
}