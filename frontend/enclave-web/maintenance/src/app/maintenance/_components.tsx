import Link from "next/link";

export function Shell({ children, active = "tasks" }: { children: React.ReactNode; active?: string }) {
  const nav = [
    { id: "tasks", label: "My tasks", icon: "▣", href: "/maintenance" },
    { id: "notifications", label: "Notifications", icon: "♧", href: "/maintenance/notifications" },
    { id: "account", label: "Account", icon: "♙", href: "/maintenance/account" },
  ];
  return <div className="m-shell">
    <aside className="m-sidebar">
      <Link href="/maintenance" className="m-brand"><span className="m-brand-mark">E</span> ENCLAVE</Link>
      <div className="m-subbrand">Maintenance</div>
      <nav className="m-nav">{nav.map(n => <Link key={n.id} href={n.href} className={active === n.id ? "active" : ""}><span className="nav-icon">{n.icon}</span>{n.label}</Link>)}</nav>
      <Link className="m-nav m-logout" href="/maintenance"><span className="nav-icon">⇥</span>Log out</Link>
    </aside>
    <main className="m-main">
      <div className="m-top"><div className="m-breadcrumb">Maintenance workspace</div><div className="m-avatar">A</div></div>
      <div className="m-content">{children}</div>
    </main>
    <nav className="m-mobile-bottom">{nav.map(n => <Link key={n.id} href={n.href} className={active === n.id ? "active" : ""}><span>{n.icon}</span>{n.label}</Link>)}</nav>
  </div>;
}
export function Pill({ children, tone = "" }: { children: React.ReactNode; tone?: string }) { return <span className={`m-pill ${tone}`}>{children}</span>; }
export function ButtonLink({ href, children, tone = "" }: { href: string; children: React.ReactNode; tone?: string }) { return <Link href={href} className={`m-button ${tone}`}>{children}</Link>; }
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) { return <><h1 className="m-title">{title}</h1>{subtitle && <p className="m-subtitle">{subtitle}</p>}</>; }
