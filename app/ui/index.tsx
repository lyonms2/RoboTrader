"use client";
// Pecas do visual novo (redesign de 24/11/2026). Toda tela nova se monta com elas; o CSS fica em ./ui.css
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { fmt } from "./format";

export { brl, fmt } from "./format";

type Tone = "pos" | "neg" | "warn" | "info" | "brand" | "neutral";
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- cartao e secao ----------
export function Card({ children, tone, flush, className, as: Tag = "div" }: {
  children: ReactNode; tone?: "brand"; flush?: boolean; className?: string; as?: "div" | "section" | "article";
}) {
  return <Tag className={cx("ui-card", tone, flush && "flush", className)}>{children}</Tag>;
}

// Secao: titulo, contagem, explicacao no "i" e acao a direita
export function Section({ title, count, info, action, children, id }: {
  title: ReactNode; count?: number; info?: ReactNode; action?: ReactNode; children: ReactNode; id?: string;
}) {
  return (
    <section className="ui-section" id={id}>
      <div className="ui-section-head">
        <h2>{title}</h2>
        {count !== undefined && count > 0 && <Badge tone="brand">{count}</Badge>}
        {info && <InfoTip>{info}</InfoTip>}
        {action && <span className="ui-section-act">{action}</span>}
      </div>
      {children}
    </section>
  );
}

// ---------- numeros ----------
// Valor em reais. signed: mostra + e -; tone "auto" pinta pelo sinal
export function Money({ value, size = "sm", tone, signed, cents = true, prefix = "R$ " }: {
  value: number; size?: "sm" | "md" | "lg" | "xl"; tone?: Tone | "auto"; signed?: boolean; cents?: boolean; prefix?: string;
}) {
  const t = tone === "auto" ? (value > 0.004 ? "pos" : value < -0.004 ? "neg" : undefined) : tone;
  const sign = signed ? (value > 0.004 ? "+" : value < -0.004 ? "−" : "") : value < -0.004 ? "−" : "";
  const s = fmt(Math.abs(value), cents ? 2 : 0);
  const int = cents ? s.slice(0, -3) : s;
  const dec = cents ? s.slice(-3) : "";
  const big = size === "lg" || size === "xl";
  return (
    <span className={cx("ui-money", `size-${size}`, t)}>
      {sign}{prefix}{int}{cents && (big ? <span className="cents">{dec}</span> : dec)}
    </span>
  );
}

export function Stat({ label, value, hint, compact }: { label: ReactNode; value: ReactNode; hint?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("ui-stat", compact && "compact")}>
      <div className="ui-stat-label">{label}</div>
      <div className="ui-stat-value">{value}</div>
      {hint && <div className="ui-stat-hint">{hint}</div>}
    </div>
  );
}
// Fileira de Stat: grade com N colunas, ou carrossel no celular (scroll)
export function Stats({ children, cols = 3, scroll }: { children: ReactNode; cols?: number; scroll?: boolean }) {
  return <div className={cx("ui-stats", scroll && "scroll")} style={{ "--cols": cols } as CSSProperties}>{children}</div>;
}

// ---------- botoes ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link" | "icon"; size?: "sm" | "md"; block?: boolean; icon?: ReactNode;
};
export function Button({ variant = "secondary", size = "md", block, icon, className, children, type = "button", ...rest }: BtnProps) {
  return (
    <button type={type} className={cx("ui-btn", variant, size === "sm" && "sm", block && "block", className)} {...rest}>
      {icon}{children}
    </button>
  );
}

// ---------- selecao em pilulas (substitui pills e sub-abas) ----------
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="ui-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}{o.badge !== undefined && <span className="ui-seg-badge">{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- etiqueta ----------
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("ui-badge", tone !== "neutral" && tone)}>{children}</span>;
}

// ---------- barra de progresso ----------
// value = fracao usada (0..1, pode passar de 1). tone "auto": aos 80% amarelo, acima de 100% vermelho
export function Progress({ value, tone = "auto", label }: { value: number; tone?: Tone | "auto" | "accent"; label?: string }) {
  const t = tone === "auto" ? (value > 1 ? "neg" : value >= 0.8 ? "warn" : undefined) : tone;
  const p = Math.max(0, Math.min(1, value));
  return (
    <div className={cx("ui-progress", t)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
      style={{ "--p": p } as CSSProperties}><span /></div>
  );
}

// ---------- linha de lista ----------
export function List({ children }: { children: ReactNode }) {
  return <div className="ui-list">{children}</div>;
}
export function ListRow({ icon, iconTone, title, sub, value, trailing, onClick, href, chevron, muted }: {
  icon?: ReactNode; iconTone?: Tone; title: ReactNode; sub?: ReactNode; value?: ReactNode; trailing?: ReactNode;
  onClick?: () => void; href?: string; chevron?: boolean; muted?: boolean;
}) {
  const inner = (
    <>
      {icon && <span className={cx("ui-row-icon", iconTone !== "neutral" && iconTone)} aria-hidden="true">{icon}</span>}
      <span className="ui-row-main"><span className="ui-row-title">{title}</span>{sub && <span className="ui-row-sub">{sub}</span>}</span>
      {value !== undefined && <span className="ui-row-value">{value}</span>}
      {trailing}
      {(chevron ?? !!(onClick || href)) && <ChevronRight className="ui-row-chev" size={16} aria-hidden="true" />}
    </>
  );
  const cls = cx("ui-row", muted && "muted");
  if (href) return <a className={cls} href={href}>{inner}</a>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

// ---------- "i" com explicacao: balao no computador, folha no celular ----------
export function InfoTip({ children, label = "Como funciona", more }: { children: ReactNode; label?: string; more?: { href: string; text?: string } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);
  return (
    <span className="ui-tip" ref={ref}>
      <button type="button" className="ui-tip-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>i</button>
      {open && <>
        <span className="ui-tip-backdrop" onClick={() => setOpen(false)} />
        <span className="ui-tip-pop" id={id} role="note">
          {children}
          {more && <a className="ui-tip-more" href={more.href} onClick={() => setOpen(false)}>{more.text ?? "ver na Ajuda"} ›</a>}
        </span>
      </>}
    </span>
  );
}

// ---------- folha (celular) / janela (computador) ----------
// Fecha no X, no Esc e tocando fora; trava a rolagem da pagina enquanto aberta
export function Sheet({ open, onClose, title, children, width }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ui-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ui-sheet" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} tabIndex={-1} ref={panel}
        style={width ? ({ "--sheet-w": `${width}px` } as CSSProperties) : undefined}>
        <div className="ui-sheet-grip" aria-hidden="true" />
        <div className="ui-sheet-head">
          {title && <h2>{title}</h2>}
          <Button variant="icon" aria-label="Fechar" onClick={onClose} icon={<X size={18} aria-hidden="true" />} />
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- vazio e carregando ----------
export function EmptyState({ title, text, action }: { title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <img src="/seubitico-96.png" alt="" width={72} height={72} />
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
export function Skeleton({ w, h = 14 }: { w?: number | string; h?: number }) {
  return <span className="ui-skel" aria-hidden="true" style={{ "--w": typeof w === "number" ? `${w}px` : w, "--h": `${h}px` } as CSSProperties} />;
}
