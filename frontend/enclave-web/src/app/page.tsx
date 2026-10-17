import Image from 'next/image';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-background px-6 py-12 text-primary">
      <section className="w-full max-w-2xl rounded-[28px] bg-white p-8 shadow-sm sm:p-12">
        <div className="mb-12 flex items-center gap-3">
          <Image
            src="/images/enclave-logo.png"
            alt=""
            width={28}
            height={34}
            className="object-contain"
          />
          <span className="text-[23px] font-bold tracking-[5px]">ENCLAVE</span>
        </div>
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Management portal
        </p>
        <h1 className="max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">
          Your community, connected.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
          Review resident reports, manage invitations, publish community notices, and compare repair plans.
        </p>
        <Link
          href="/sign-in"
          className="mt-9 flex min-h-14 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Sign in to Enclave
        </Link>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Need a management account?{' '}
          <Link href="/sign-up" className="font-semibold text-primary underline-offset-4 hover:underline">
            Request access
          </Link>
        </p>
      </section>
    </main>
  );
}
