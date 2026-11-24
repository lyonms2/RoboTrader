"use client";
// Casca do site: topo enxuto, barra de baixo no celular (Inicio, Mes, +, Patrimonio, Mais) e menu lateral no computador
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Home, LayoutGrid, LogOut, Plus, Wallet } from "lucide-react";
import { Button, List, ListRow, Sheet } from "./ui";

export type NavId = "inicio" | "mes" | "patrimonio" | "mais";
export type MoreItem = { id: string; label: string; sub?: string; icon: ReactNode; active?: boolean; onClick: () => void };

const MAIN: { id: Exclude<NavId, "mais">; label: string; icon: ReactNode }[] = [
  { id: "inicio", label: "Início", icon: <Home size={22} aria-hidden="true" /> },
  { id: "mes", label: "Mês", icon: <CalendarDays size={22} aria-hidden="true" /> },
  { id: "patrimonio", label: "Patrimônio", icon: <Wallet size={22} aria-hidden="true" /> },
];

export default function Shell({ active, onNav, onLaunch, more, account, onSignOut, subtitle, banners, children }: {
  active: NavId; onNav: (id: Exclude<NavId, "mais">) => void;
  onLaunch?: () => void; // sem ele (modo suporte, so leitura) o botao + some
  more: MoreItem[]; // itens de "Mais" (no computador aparecem direto no menu lateral)
  account: { initial: string; label: string; items: { label: string; onClick: () => void }[] };
  onSignOut: () => void; subtitle?: string; banners?: ReactNode; children: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // menu da conta fecha ao clicar fora ou no Esc
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [menu]);
  const pick = (fn: () => void) => () => { setMoreOpen(false); fn(); };

  return (
    <div className="sh">
      <header className="sh-top topbar">
        <div className="sh-top-in">
          <div className="sh-brand">
            <img src="/seubitico-96.png" alt="" width={32} height={32} />
            <div>
              <div className="sh-name">Seu<span>Bitico</span></div>
              {subtitle && <div className="sh-subtitle">{subtitle}</div>}
            </div>
          </div>
          <div className="sh-acc" ref={menuRef}>
            <button type="button" className="sh-avatar" aria-label={account.label} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)}>
              {account.initial}
            </button>
            {menu && (
              <div className="sh-menu" role="menu">
                {account.items.map((it) => (
                  <button key={it.label} type="button" role="menuitem" onClick={() => { setMenu(false); it.onClick(); }}>{it.label}</button>
                ))}
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onSignOut(); }}><LogOut size={16} aria-hidden="true" /> Sair</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* computador: menu lateral */}
      <aside className="sh-side" aria-label="Menu">
        {onLaunch && <Button variant="primary" block className="sh-side-launch" icon={<Plus size={18} aria-hidden="true" />} onClick={onLaunch}>Lançar</Button>}
        <nav aria-label="Navegação principal">
          {MAIN.map((m) => (
            <button key={m.id} type="button" className={active === m.id ? "sh-side-item on" : "sh-side-item"} aria-current={active === m.id ? "page" : undefined} onClick={() => onNav(m.id)}>
              {m.icon}{m.label}
            </button>
          ))}
          <div className="sh-side-sep" />
          {more.map((m) => (
            <button key={m.id} type="button" className={m.active ? "sh-side-item on" : "sh-side-item"} aria-current={m.active ? "page" : undefined} onClick={m.onClick}>
              {m.icon}{m.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="wrap sh-main">
        {banners}
        {children}
      </main>

      {/* celular: barra de baixo */}
      <nav className="sh-bar" aria-label="Navegação principal">
        {MAIN.slice(0, 2).map((m) => <BarItem key={m.id} on={active === m.id} label={m.label} icon={m.icon} onClick={() => onNav(m.id)} />)}
        {onLaunch ? (
          <button type="button" className="sh-fab" aria-label="Lançar" onClick={onLaunch}><Plus size={26} strokeWidth={2.6} aria-hidden="true" /></button>
        ) : <span aria-hidden="true" />}
        <BarItem on={active === "patrimonio"} label={MAIN[2].label} icon={MAIN[2].icon} onClick={() => onNav("patrimonio")} />
        <BarItem on={active === "mais"} label="Mais" icon={<LayoutGrid size={22} aria-hidden="true" />} onClick={() => setMoreOpen(true)} />
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Mais">
        <List>
          {more.map((m) => <ListRow key={m.id} icon={m.icon} title={m.label} sub={m.sub} chevron onClick={pick(m.onClick)} />)}
        </List>
      </Sheet>
    </div>
  );
}

function BarItem({ on, label, icon, onClick }: { on: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={on ? "sh-bar-item on" : "sh-bar-item"} aria-current={on ? "page" : undefined} onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}
