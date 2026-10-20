import Image from 'next/image';
import Link from 'next/link';

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-primary">
      <section className="w-full max-w-xl rounded-[28px] bg-white p-8 shadow-sm sm:p-12">
        <Link href="/" className="mb-12 flex items-center gap-3" aria-label="Back to Enclave home">
          <Image
            src="/images/enclave-logo.png"
            alt=""
            width={28}
            height={34}
            className="object-contain"
          />
          <span className="text-[23px] font-bold tracking-[5px]">ENCLAVE</span>
        </Link>

        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Management portal
        </p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          Request management access.
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Management accounts are created and assigned access by an Enclave administrator.
          Self-service sign-up is not available for this portal.
        </p>

        <div className="mt-8 rounded-2xl bg-secondary p-5 text-sm leading-relaxed text-primary">
          Contact your workspace administrator to request an account. Once your account is
          provisioned, sign in with your assigned work email and password.
        </div>

        <Link
          href="/sign-in"
          className="mt-8 flex min-h-14 items-center justify-center rounded-2xl bg-brand px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Go to sign in
        </Link>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link href="/" className="font-semibold text-primary underline-offset-4 hover:underline">
            Back to Enclave home
          </Link>
        </p>
      </section>
    </main>
  );
}
