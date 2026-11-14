"use client";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useState } from "react";
import { db } from "@/lib/firebaseClient";
import { P } from "@/lib/paths";
import { catLabel, dirOf, type Gasto, type GastosSetup } from "@/lib/gastos";

// Exportar meus dados (manual): tudo o que voce lancou num arquivo JSON e os lancamentos numa planilha CSV.
// Le direto do banco (o mesmo espaco de quem esta logado) e gera os arquivos no navegador: nada passa por outro servidor.
const stamp = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readCol(path: string) {
  try {
    const s = await getDocs(collection(db(), P(path)));
    return Object.fromEntries(s.docs.map((d) => [d.id, d.data()]));
  } catch { return {}; }
}
async function readAll(owner: boolean) {
  const [config, wallet, walletHist, nwHist, finance] = await Promise.all([
    readCol("config"), getDoc(doc(db(), P("wallet/main"))).then((s) => s.data() ?? null).catch(() => null),
    readCol("wallet_history_m"), readCol("patrimonio_history_m"),
    getDoc(doc(db(), P("finance/main"))).then((s) => s.data() ?? null).catch(() => null),
  ]);
  // historicos ainda no formato antigo (um documento por dia)
  const [walletDays, nwDays] = await Promise.all([
    Object.keys(walletHist).length ? {} : readCol("wallet_history"), Object.keys(nwHist).length ? {} : readCol("patrimonio_history"),
  ]);
  const trades = owner ? await readCol("trades") : {};
  return {
    exportado: new Date().toISOString(), site: "SeuBitico", versao: 1,
    config, trades, carteira: wallet, cotacoes: finance,
    historico_carteira: Object.keys(walletHist).length ? walletHist : walletDays,
    historico_patrimonio: Object.keys(nwHist).length ? nwHist : nwDays,
  };
}
// Planilha: ; como separador e virgula nos valores (abre direto no Excel/Google Planilhas em portugues)
export function toCsv(config: Record<string, unknown>) {
  const setup = (config["gastos-setup"] ?? {}) as Partial<GastosSetup>;
  const accName = (id?: string) => setup.accounts?.find((a) => a.id === id)?.name ?? (id ? id : setup.accounts?.[0]?.name ?? "");
  const cardName = (id?: string) => setup.cards?.find((c) => c.id === id)?.name ?? id ?? "";
  const items = Object.entries(config).filter(([k]) => /^gastos-\d{4}-\d{2}$/.test(k))
    .flatMap(([, v]) => ((v as { items?: Gasto[] }).items ?? [])).sort((a, b) => a.d.localeCompare(b.d));
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [["Data", "Descrição", "Valor", "Entrou/Saiu", "Tipo", "Categoria", "Conta", "Cartão", "Parcela", "Origem"].join(";")];
  for (const g of items) {
    const sign = g.card ? -1 : dirOf(g);
    rows.push([
      `${g.d.slice(8, 10)}/${g.d.slice(5, 7)}/${g.d.slice(0, 4)}`, q(g.desc), (sign * g.v).toFixed(2).replace(".", ","),
      sign > 0 ? "entrou" : "saiu", g.tipo, q(catLabel(g.cat)), q(g.card ? "" : accName(g.acc)), q(g.card ? cardName(g.card) : ""),
      g.parc ? `${g.parc[0]}/${g.parc[1]}` : "", g.src ?? "",
    ].join(";"));
  }
  return { csv: "﻿" + rows.join("\r\n"), count: items.length };
}

export default function ExportData({ owner }: { owner: boolean }) {
  const [busy, setBusy] = useState<"" | "json" | "csv">("");
  const [msg, setMsg] = useState("");
  const run = async (kind: "json" | "csv") => {
    setBusy(kind); setMsg("");
    try {
      const data = await readAll(owner);
      if (kind === "json") {
        download(`seubitico-dados-${stamp()}.json`, JSON.stringify(data, null, 1), "application/json");
        setMsg("Arquivo completo baixado.");
      } else {
        const { csv, count } = toCsv(data.config as Record<string, unknown>);
        download(`seubitico-lancamentos-${stamp()}.csv`, csv, "text/csv;charset=utf-8");
        setMsg(`Planilha baixada: ${count} lançamentos.`);
      }
    } catch (e) {
      setMsg(`Não exportou: ${String(e)}`);
    } finally { setBusy(""); }
  };
  return (
    <div className="export">
      <div className="row wrapline">
        <button className="primary" disabled={!!busy} onClick={() => run("json")}>{busy === "json" ? "Gerando..." : "Exportar tudo (arquivo .json)"}</button>
        <button className="ghost" disabled={!!busy} onClick={() => run("csv")}>{busy === "csv" ? "Gerando..." : "Lançamentos em planilha (.csv)"}</button>
      </div>
      {msg && <p className="small pos">{msg}</p>}
      <p className="muted small">O arquivo completo guarda tudo o que você lançou (contas, lançamentos, cartões, empréstimos, investimentos, metas e
        históricos) e serve de backup. Ele inclui os endereços públicos das carteiras: guarde num lugar seu e não compartilhe.
        Os arquivos são gerados no seu navegador; nada é enviado para outro lugar.</p>
    </div>
  );
}
