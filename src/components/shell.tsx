import Link from "next/link";
import { logout } from "@/app/actions";

const NAV = [
  ["/", "Обзор"],
  ["/inbox", "Входящие"],
  ["/posts", "Публикации"],
  ["/calendar", "Календарь"],
  ["/archive", "Архив"],
  ["/ideas", "Идеи"],
  ["/settings", "Настройки"],
] as const;

export function Shell({ active, title, children, error, info }: { active: string; title: string; children: React.ReactNode; error?: string; info?: string }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="wordmark">WHYTHEWEAKEST<span>/OS</span></Link>
        <nav className="nav">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={active === href ? "active" : ""}>{label}</Link>
          ))}
        </nav>
        <form action={logout}><button className="btn btn-ghost btn-sm">Выйти</button></form>
      </header>
      <main className="page">
        <h1 className="page-title">{title}</h1>
        {error && <p className="notice notice-danger" role="alert">{error}</p>}
        {info && <p className="notice notice-info">{info}</p>}
        {children}
      </main>
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge badge-${status}`}>{label}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function fmtDate(d: Date | null | undefined) {
  return d ? d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}

/** Значение для <input type="datetime-local"> в местном времени. */
export function toLocalInput(d: Date | null | undefined) {
  if (!d) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
