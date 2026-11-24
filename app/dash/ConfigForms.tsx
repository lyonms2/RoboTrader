"use client";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { DEFAULT_ALLOC } from "@/lib/positions";
import { isEvmAddress, isSolAddress } from "@/lib/addresses";
import { type AppConfig } from "@/lib/types";
import { NumInput, fmt, ordered, round8 } from "./util";

// Configuracao em secoes: capital, carteiras, robo, tokens e (recolhidos) ajustes manuais e Lighter
export function ConfigForm({ cfg, onClose }: { cfg: AppConfig; onClose: () => void }) {
  const [draft, setDraft] = useState(cfg);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [watchText, setWatchText] = useState((cfg.watchlist ?? []).join(", "));
  const [walletText, setWalletText] = useState((cfg.wallets?.length ? cfg.wallets : cfg.wallet ? [cfg.wallet] : []).join("\n"));

  async function save() {
    const clean = (m: Record<string, number> = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round8(v)]));
    const wallets = [...new Set(walletText.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean))];
    const bad = wallets.filter((a) => !isEvmAddress(a) && !isSolAddress(a));
    if (bad.length) return setErr(`Endereço inválido: ${bad.join(", ")} (EVM = 0x + 40 caracteres; Solana = 32 a 44 caracteres).`);
    if (draft.lighter?.enabled && !wallets.some(isEvmAddress)) return setErr("Para importar da Lighter, informe um endereço EVM (0x...).");
    if ((draft.capitalFromWallet || draft.walletPositions) && !wallets.length) return setErr("Informe pelo menos uma carteira para usar o patrimônio ou o saldo dela.");
    setSaving(true);
    await setDoc(doc(db(), "config/main"), {
      ...draft, wallet: wallets.find(isEvmAddress) ?? "", wallets,
      watchlist: [...new Set(watchText.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9]{2,12}$/.test(t)))],
      weights: clean(draft.weights), positions: clean(draft.positions), avgPrice: clean(draft.avgPrice), realized: clean(draft.realized),
    });
    setSaving(false);
    onClose();
  }

  const symbols = ordered(Object.keys(draft.weights));
  const totalWeight = Object.values(draft.weights).reduce((a, b) => a + b, 0);
  const setMap = (key: "weights" | "positions" | "avgPrice", s: string, v: number) =>
    setDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [s]: v } });
  const alloc = draft.alloc ?? DEFAULT_ALLOC;
  const setCore = (pctCore: number) => {
    const c = Math.min(100, Math.max(0, pctCore)) / 100;
    setDraft({ ...draft, alloc: { core: round8(c), satellite: round8(1 - c) } });
  };

  return (
    <section className="cfg">
      <div className="modal-head">
        <h2>Configuração</h2>
        <button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button>
      </div>

      <fieldset>
        <legend>1. Capital</legend>
        <div className="choice">
          <label className="radio">
            <input type="radio" checked={!!draft.capitalFromWallet} onChange={() => setDraft({ ...draft, capitalFromWallet: true })} />
            <span><b>Patrimônio das carteiras</b><small>o total lido nas carteiras abaixo (recomendado)</small></span>
          </label>
          <label className="radio">
            <input type="radio" checked={!draft.capitalFromWallet} onChange={() => setDraft({ ...draft, capitalFromWallet: false })} />
            <span><b>Valor fixo</b><small>digite o capital em USDT</small></span>
          </label>
          {!draft.capitalFromWallet && (
            <label className="inline">USDT <NumInput value={draft.capitalUsdt} onChange={(v) => setDraft({ ...draft, capitalUsdt: v })} /></label>
          )}
        </div>
        <div className="split">
          <label>Núcleo (robô BTC/ETH/SOL) %<NumInput value={round8(alloc.core * 100)} onChange={setCore} /></label>
          <label>Satélite (rompimento em outros tokens) %<NumInput value={round8(alloc.satellite * 100)} onChange={(v) => setCore(100 - v)} /></label>
        </div>
        <p className="hint">O robô usa só o núcleo; o satélite tem até 5 tokens. Satélite 0% desliga o rompimento.</p>
      </fieldset>

      <fieldset>
        <legend>2. Carteiras</legend>
        <label>Endereços públicos, um por linha (EVM 0x... da Rabby/Phantom e Solana da Phantom)
          <textarea rows={3} value={walletText} placeholder={"0x... (Rabby)\n7xKX... (Phantom Solana)"} spellCheck={false}
            onChange={(e) => setWalletText(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={!!draft.walletPositions} onChange={(e) => setDraft({ ...draft, walletPositions: e.target.checked })} />
          A posição do robô vem do saldo das carteiras (cbBTC, WETH, stETH, JitoSOL... contam como BTC/ETH/SOL)
        </label>
        <p className="hint">Só leitura pelo endereço público: nunca pede chave nem assinatura.</p>
      </fieldset>

      <fieldset>
        <legend>3. Robô (BTC, ETH, SOL)</legend>
        <div className="table-scroll">
          <table className="cfg-table">
            <thead><tr><th>Moeda</th><th>Peso no núcleo (%)</th>{!draft.walletPositions && <th>Preço médio (para o lucro)</th>}</tr></thead>
            <tbody>
              {symbols.map((s) => (
                <tr key={s}>
                  <td><b>{s.replace("USDT", "")}</b></td>
                  <td><NumInput value={round8(draft.weights[s] * 100)} onChange={(v) => setMap("weights", s, v / 100)} /></td>
                  {!draft.walletPositions && <td><NumInput value={draft.avgPrice?.[s] ?? 0} onChange={(v) => setMap("avgPrice", s, v)} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {draft.walletPositions && <p className="hint">Preço médio: vem da lista &quot;Meus tokens&quot; (aba Carteira), automático ou digitado la.</p>}
        {Math.abs(totalWeight - 1) > 0.011 && <p className="warn small">Os pesos somam {fmt(totalWeight * 100, 0)}%: o normal e 100%.</p>}
        <label className="check">
          <input type="checkbox" checked={draft.reentry} onChange={(e) => setDraft({ ...draft, reentry: e.target.checked })} />
          Reentrada no repique (meia posição quando o preço volta a SMA com a HMA caindo)
        </label>
      </fieldset>

      <fieldset>
        <legend>4. Tokens</legend>
        <label>Tokens extras para acompanhar nas fichas (separados por vírgula)
          <input value={watchText} placeholder="HYPE, PENDLE, JUP" spellCheck={false} onChange={(e) => setWatchText(e.target.value)} />
        </label>
        <p className="hint">Os tokens das suas carteiras e uma lista padrão de projetos grandes já entram sozinhos. Os da lista padrão são só para acompanhar: não geram aviso de compra. Digitando um deles aqui, ele passa a seguir a regra completa.</p>
      </fieldset>

      <details className="cfg-more">
        <summary>Posições manuais (fora das carteiras)</summary>
        <p className="hint">Só para o que não está nas carteiras cadastradas. Registrar uma operação atualiza estes valores sozinho.
          {draft.walletPositions ? " Com a posição vindo das carteiras, estes valores são ignorados." : ""}</p>
        <div className="table-scroll">
          <table className="cfg-table">
            <thead><tr><th>Moeda</th><th>Posição (moedas)</th></tr></thead>
            <tbody>
              {symbols.map((s) => (
                <tr key={s}>
                  <td><b>{s.replace("USDT", "")}</b></td>
                  <td><NumInput value={draft.positions[s] ?? 0} onChange={(v) => setMap("positions", s, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="cfg-more" open={!!draft.lighter?.enabled}>
        <summary>Lighter (perpétuos)</summary>
        <label className="check">
          <input type="checkbox" checked={!!draft.lighter?.enabled}
            onChange={(e) => setDraft({ ...draft, lighter: { enabled: e.target.checked, since: draft.lighter?.since ?? Date.now() - 30 * 86_400_000 } })} />
          Importar posições e operações da Lighter
        </label>
        {draft.lighter?.enabled && (
          <label className="inline">Operações a partir de
            <input type="date" value={new Date(draft.lighter.since).toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && setDraft({ ...draft, lighter: { enabled: true, since: Date.parse(`${e.target.value}T00:00:00Z`) } })} />
          </label>
        )}
        <p className="hint">Desligue depois de sacar da Lighter.</p>
      </details>

      <div className="cfg-footer">
        {err && <p className="error small">{err}</p>}
        <div className="row">
          <button className="primary" onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
          <button className="ghost" onClick={onClose}>Cancelar</button>
        </div>
        <p className="hint">Depois de salvar, clique em &quot;Atualizar&quot; (Cripto) para recalcular com a nova configuração.</p>
      </div>
    </section>
  );
}

// ---------- membros ----------
// Configuracao do membro: so as carteiras (o resto do robo e do dono)
export function MemberConfigForm({ cfg, onClose }: { cfg: AppConfig; onClose: () => void }) {
  const [walletText, setWalletText] = useState((cfg.wallets ?? []).join("\n"));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const wallets = [...new Set(walletText.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean))];
    const bad = wallets.filter((a) => !isEvmAddress(a) && !isSolAddress(a));
    if (bad.length) return setErr(`Endereço inválido: ${bad.join(", ")} (EVM = 0x + 40 caracteres; Solana = 32 a 44 caracteres).`);
    setSaving(true);
    try {
      await setDoc(doc(db(), P("config/main")), { wallets, wallet: wallets.find(isEvmAddress) ?? "" }, { merge: true });
      onClose();
    } catch (e) { setSaving(false); setErr(`Não salvou: ${String(e)}`); }
  };
  return (
    <section className="cfg">
      <div className="modal-head"><h2>Suas carteiras</h2><button className="ghost icon" onClick={onClose} aria-label="Fechar">&#x2715;</button></div>
      <p className="muted small">Endereços públicos das suas carteiras (Rabby, Phantom...), um por linha. Só leitura: o site nunca pede frase secreta nem movimenta nada.</p>
      <textarea className="wallets" rows={4} value={walletText} onChange={(e) => setWalletText(e.target.value)} placeholder="0x... ou endereço Solana" />
      {err && <p className="error small">{err}</p>}
      <div className="row"><button className="primary" disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar"}</button>
        <button className="ghost" onClick={onClose}>Cancelar</button></div>
      <p className="muted small">Depois de salvar, clique em &quot;Atualizar&quot; (Cripto) para ler as carteiras.</p>
    </section>
  );
}
