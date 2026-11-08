"use client";
import { useEffect, useRef, useState } from "react";

// Janelas no estilo do site no lugar de confirm/prompt/alert do navegador.
// ask("Apagar X?") -> true/false; askText("Nome:", "padrao") -> texto ou null; tell("Aviso") -> quando fechar
type Req = { kind: "confirm" | "prompt" | "alert"; msg: string; def?: string; resolve: (v: unknown) => void };
let push: ((r: Req) => void) | null = null;
const queue: Req[] = [];
const open = (r: Req) => (push ? push(r) : queue.push(r));

export const ask = (msg: string) => new Promise<boolean>((resolve) => open({ kind: "confirm", msg, resolve: resolve as (v: unknown) => void }));
export const askText = (msg: string, def = "") => new Promise<string | null>((resolve) => open({ kind: "prompt", msg, def, resolve: resolve as (v: unknown) => void }));
export const tell = (msg: string) => new Promise<void>((resolve) => open({ kind: "alert", msg, resolve: resolve as (v: unknown) => void }));

// verbo da acao vira o texto do botao (Apagar, Remover, Desfazer...) e acoes destrutivas ficam em vermelho
const verb = (msg: string) => {
  const m = /^(Apagar|Remover|Excluir|Desfazer|Marcar|Salvar)\b/i.exec(msg.trim());
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "Confirmar";
};

export function DialogHost() {
  const [list, setList] = useState<Req[]>([]);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    push = (r) => setList((l) => [...l, r]);
    if (queue.length) setList((l) => [...l, ...queue.splice(0)]);
    return () => { push = null; };
  }, []);
  const cur = list[0];
  useEffect(() => {
    if (!cur) return;
    setText(cur.def ?? "");
    setTimeout(() => (cur.kind === "prompt" ? input.current?.select() : okBtn.current?.focus()), 0);
  }, [cur]);
  if (!cur) return null;
  const close = (v: unknown) => { cur.resolve(v); setList((l) => l.slice(1)); };
  const cancel = () => close(cur.kind === "confirm" ? false : cur.kind === "prompt" ? null : undefined);
  const ok = () => close(cur.kind === "confirm" ? true : cur.kind === "prompt" ? text : undefined);
  const v = cur.kind === "confirm" ? verb(cur.msg) : "OK";
  const danger = cur.kind === "confirm" && /^(Apagar|Remover|Excluir)$/.test(v);
  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form className="dlg" role="dialog" aria-modal="true" onSubmit={(e) => { e.preventDefault(); ok(); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } }}>
        <p className="dlg-msg">{cur.msg}</p>
        {cur.kind === "prompt" && <input ref={input} value={text} onChange={(e) => setText(e.target.value)} />}
        <div className="dlg-btns">
          {cur.kind !== "alert" && <button type="button" className="ghost" onClick={cancel}>Cancelar</button>}
          <button ref={okBtn} type="submit" className={danger ? "danger" : "primary"}>{v}</button>
        </div>
      </form>
    </div>
  );
}
