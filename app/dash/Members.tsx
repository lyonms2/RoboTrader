"use client";
import { type User } from "firebase/auth";
import { collection, deleteDoc, deleteField, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { dayBR, endOfDayBR, fmtBR, plusMonths, renew, subLabel, subStatus } from "@/lib/assinatura";
import { ask, tell } from "../Dialog";
import ExportData from "../ExportData";
import { day } from "./util";

// Administracao (so o dono): quem pode entrar e ate quando a assinatura esta paga (vencimento e so aviso, nao bloqueia)
export type MemberRow = { email: string; name?: string; at?: number; until?: number };
export const SUB_ORDER = { atrasado: 0, vence: 1, sem: 2, ok: 3 } as const;
export function MembersAdmin({ onClose, onSupport }: { onClose: () => void; onSupport: (x: { uid: string; email: string; until: number }) => void }) {
  const [grants, setGrants] = useState<{ uid: string; email: string; until: number }[]>([]);
  useEffect(() => onSnapshot(collection(db(), "support"), (s) => setGrants(s.docs.map((d) => ({ uid: d.id, ...(d.data() as { email: string; until: number }) }))), () => undefined), []);
  const [list, setList] = useState<MemberRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [due, setDue] = useState(() => plusMonths(dayBR(Date.now())));
  const [err, setErr] = useState("");
  useEffect(() => onSnapshot(collection(db(), "access"), (s) => setList(s.docs.filter((d) => (d.data() as { role?: string }).role === "member")
    .map((d) => {
      const x = d.data() as { name?: string; at?: number; until?: unknown };
      return { email: d.id, name: x.name, at: x.at, until: typeof x.until === "number" ? x.until : undefined };
    })),
    (e) => setErr(e.message.includes("permission") ? "As regras do Firestore ainda não foram atualizadas (veja firestore.rules)." : e.message)), []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return setErr("E-mail inválido.");
    if (!due) return setErr("Escolha a data de vencimento.");
    setErr("");
    try {
      await setDoc(doc(db(), "access", em), { role: "member", at: Date.now(), until: endOfDayBR(due), ...(name.trim() ? { name: name.trim() } : {}) });
      setEmail(""); setName("");
    } catch (x) { setErr(`Não salvou: ${String(x)}`); }
  };
  const setUntil = async (em: string, v: number | null) => {
    try { await setDoc(doc(db(), "access", em), { until: v === null ? deleteField() : v }, { merge: true }); } catch (x) { setErr(`Não salvou: ${String(x)}`); }
  };
  const remove = async (em: string) => {
    if (!(await ask(`Remover o acesso de ${em}? Os dados dele continuam guardados; ele só não entra mais.`))) return;
    await deleteDoc(doc(db(), "access", em));
  };
  const now = Date.now();
  const rows = (list ?? []).map((m) => ({ ...m, st: subStatus(m.until, now) }))
    .sort((a, b) => SUB_ORDER[a.st.s] - SUB_ORDER[b.st.s] || (a.until ?? 0) - (b.until ?? 0) || (b.at ?? 0) - (a.at ?? 0));
  const count = (k: keyof typeof SUB_ORDER) => rows.filter((r) => r.st.s === k).length;
  const summary = [`${rows.length} ${rows.length === 1 ? "membro" : "membros"}`,
    count("vence") && `${count("vence")} vencem esta semana`, count("atrasado") && `${count("atrasado")} ${count("atrasado") === 1 ? "atrasado" : "atrasados"}`,
    count("sem") && `${count("sem")} sem data`].filter(Boolean).join(" · ");
  return (
    <section className="cfg">
      <div className="modal-head"><h2>Membros</h2><button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button></div>
      <p className="muted small">Só entra quem estiver nesta lista (o e-mail da conta Google). Cada membro tem os próprios dados; ninguém vê os seus nem os de outro membro.
        Membros veem finanças e a própria carteira cripto; o Robô e as fichas dos tokens são só seus.
        O vencimento é só um lembrete: ninguém é bloqueado sozinho. Renove com &quot;+1 mês&quot; e remova quem não pagou.</p>
      <form className="row wrapline" onSubmit={add}>
        <label className="grow">E-mail Google<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="membro@gmail.com" /></label>
        <label>Nome (opcional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Vence em<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button className="primary" type="submit">Liberar acesso</button>
      </form>
      {err && <p className="error small">{err}</p>}
      {list === null ? <p className="muted small">Carregando...</p> : rows.length ? (
        <>
          <p className="small members-sum">{summary}</p>
          <ul className="pend small members">
            {rows.map((m) => (
              <li key={m.email} className={`sub-${m.st.s}`}><b>{m.email}</b>{m.name && <span className="muted">{m.name}</span>}
                <span className={`sub-tag sub-${m.st.s}`}>{subLabel(m.st, m.until)}</span>
                <input className="due-sel" type="date" aria-label={`Vencimento de ${m.email}`} value={m.until !== undefined ? dayBR(m.until) : ""}
                  onChange={(e) => setUntil(m.email, e.target.value ? endOfDayBR(e.target.value) : null)} />
                <button className="ghost small-btn" onClick={() => setUntil(m.email, renew(m.until))}>+1 mês</button>
                {(() => { const g = grants.find((x) => x.email === m.email && x.until > Date.now()); return g
                  ? <button className="primary small-btn" onClick={() => onSupport(g)}>Ver conta (suporte)</button> : <span className="muted">sem suporte liberado</span>; })()}
                <button className="link" onClick={() => remove(m.email)}>remover</button></li>
            ))}
          </ul>
        </>
      ) : <p className="muted small">Nenhum membro liberado ainda.</p>}
    </section>
  );
}

// Minha conta (membro): privacidade e apagar os dados
export function MyAccount({ user, subUntil, onClose }: { user: User; subUntil: number | null; onClose: () => void }) {
  const [until, setUntil] = useState<number | null>(null);
  useEffect(() => {
    try { return onSnapshot(doc(db(), "support", user.uid), (s) => setUntil(s.exists() ? (s.data() as { until: number }).until : null), () => undefined); }
    catch { return undefined; }
  }, [user.uid]);
  const active = until !== null && until > Date.now();
  const allow = async () => {
    if (!(await ask("Permitir suporte por 24 horas? O SeuBitico poderá VER seus dados do site (lançamentos, cartões, investimentos, carteiras), sem poder alterar nada. Você pode encerrar quando quiser."))) return;
    try { await setDoc(doc(db(), "support", user.uid), { email: (user.email ?? "").toLowerCase(), until: Date.now() + 86_400_000, at: Date.now() }); }
    catch (e) { await tell(`Não foi possível liberar: ${String(e)}`); }
  };
  const stop = async () => { try { await deleteDoc(doc(db(), "support", user.uid)); } catch (e) { await tell(`Não foi possível encerrar: ${String(e)}`); } };
  const [busy, setBusy] = useState(false);
  const wipe = async () => {
    if (!(await ask("Apagar todos os seus dados do site (lançamentos, cartões, investimentos, carteiras)? Não dá para desfazer."))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await tell("Seus dados foram apagados.");
      location.reload();
    } catch (e) { setBusy(false); await tell(`Não apagou: ${String(e)}`); }
  };
  return (
    <section className="cfg">
      <div className="modal-head"><h2>Minha conta</h2><button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button></div>
      <p className="small">Entrou como <b>{user.email}</b>.</p>
      <h3>Assinatura</h3>
      <p className="small">{subUntil === null ? "Sem data de vencimento registrada."
        : subStatus(subUntil).s === "atrasado" ? <>Venceu em <b className="warn">{fmtBR(subUntil)}</b>. Renove com o SeuBitico para continuar usando.</>
        : <>Paga até <b>{fmtBR(subUntil)}</b>. Para renovar, fale com o SeuBitico.</>}</p>
      <h3>Suporte</h3>
      {active
        ? <p className="small"><b className="warn">Suporte liberado</b> até {new Date(until!).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. O SeuBitico pode ver seus dados, sem alterar nada.
            <button className="ghost small-btn" onClick={stop}>Encerrar agora</button></p>
        : <p className="small muted">Se precisar de ajuda, você pode liberar a leitura da sua conta por 24 horas. Só você libera e pode encerrar quando quiser.
            <button className="ghost small-btn" onClick={allow}>Permitir suporte por 24 horas</button></p>}
      <h3>Privacidade</h3>
      <ul className="small privacy">
        <li>Seus dados ficam guardados no banco do site (Google Firebase), num espaço só seu: pelo site, ninguém além de você consegue ver, exceto se você liberar o suporte acima.</li>
        <li>Carteiras cripto: só o endereço público, lido em modo leitura. Nunca peça nem informe frase secreta ou chave privada.</li>
        <li>Nada aqui é recomendação de investimento: é uma ferramenta educacional de organização.</li>
      </ul>
      <h3>Exportar meus dados</h3>
      <ExportData owner={false} />
      <h3>Apagar</h3>
      <div className="row"><button className="danger" disabled={busy} onClick={wipe}>{busy ? "Apagando..." : "Apagar meus dados"}</button></div>
    </section>
  );
}
