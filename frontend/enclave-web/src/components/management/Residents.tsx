import Link from 'next/link';

export default function Residents() {
  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">Resident records.</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Add an approved resident record and issue its single-use invitation.
      </p>
      <Link href="/management/residents/new" className="flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-[240px]">
        Add resident
      </Link>
      <section className="rounded-3xl bg-enclave-lavender p-5">
        <h2 className="text-base font-semibold text-primary">Resident directory</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The current backend does not provide a GET residents endpoint, so this page cannot show live resident rows or account-link status. No sample records are shown as if they were real.
        </p>
      </section>
    </div>
  );
}
