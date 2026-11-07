"use client";
import type { CandidatesDoc, CandidateRow } from "@/lib/candidates";

const fmt = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number) => `${v > 0 ? "+" : ""}${fmt(v * 100)}%`;
const pnlClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const LABEL: Record<CandidateRow["verdict"], string> = {
  no_robo: "No robo", candidato: "Candidata", neutro: "Neutra", nao_serve: "Nao serve", pouco_historico: "Pouco historico",
};

// Outras moedas para o robo: a mesma regra rodada em ~30 moedas, comparada com as atuais
export default function CandidatesCard({ doc }: { doc: CandidatesDoc | null }) {
  if (!doc)
    return (
      <section className="card">
        <h2>Outras moedas para o robo</h2>
        <p className="muted">Ainda nao avaliadas. Clique em &quot;Atualizar tudo&quot; (a avaliacao roda 1 vez por semana).</p>
      </section>
    );
  const shown = doc.rows.filter((r) => r.verdict !== "pouco_historico" && r.verdict !== "nao_serve");
  const discarded = doc.rows.filter((r) => r.verdict === "nao_serve");
  const cands = shown.filter((r) => r.verdict === "candidato");
  return (
    <section className="card">
      <div className="card-head">
        <h2>Outras moedas para o robo</h2>
        <span className="muted small">avaliado {new Date(doc.at).toLocaleDateString("pt-BR")} - refeito toda semana</span>
      </div>
      <p className="small">
        {cands.length
          ? <>Pela mesma regra, <b>{cands.map((c) => c.coin).join(", ")}</b> {cands.length > 1 ? "foram" : "foi"} tao bem quanto as moedas atuais nos ultimos ~{fmt(cands[0].years, 1)} anos.</>
          : "Nenhuma moeda fora do robo foi melhor que as atuais de forma consistente."}
      </p>
      <div className="table-scroll">
        <table className="stack cands">
          <thead>
            <tr><th>Moeda</th><th>Avaliacao</th><th>Robo</th><th>So segurar</th><th>Pior queda</th><th>1a / 2a metade</th><th>Retorno/risco</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.coin} className={r.verdict === "candidato" ? "cand-row" : ""}>
                <td><b>{r.coin}</b><div className="muted small">{r.reason}</div></td>
                <td data-label="Avaliacao"><span className={`sit sit-${r.verdict}`}>{LABEL[r.verdict]}</span></td>
                <td data-label="Robo" className={pnlClass(r.totalRet)}>{pct(r.totalRet)}</td>
                <td data-label="So segurar" className={pnlClass(r.bhRet)}>{pct(r.bhRet)}</td>
                <td data-label="Pior queda"><span>{pct(r.mdd)} <span className="muted small">(segurar {pct(r.bhMdd)})</span></span></td>
                <td data-label="1a / 2a metade"><span><span className={pnlClass(r.halves.strat[0])}>{pct(r.halves.strat[0])}</span> / <span className={pnlClass(r.halves.strat[1])}>{pct(r.halves.strat[1])}</span></span></td>
                <td data-label="Retorno/risco">{fmt(r.score, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {discarded.length > 0 && (
        <details className="history">
          <summary className="small">Nao servem ({discarded.length}): o robo perdeu dinheiro nelas</summary>
          <p className="small muted">
            {discarded.map((r) => `${r.coin} ${pct(r.totalRet)} (segurar ${pct(r.bhRet)})`).join(" - ")}
          </p>
        </details>
      )}
      <p className="muted small">
        &quot;Candidata&quot; = lucro nas duas metades do periodo, pior queda no maximo 70% da de so segurar, queda menor que 55% e
        retorno/risco (retorno ao ano / pior queda) pelo menos igual ao da pior moeda atual. Mesmas condicoes do robo
        (reentrada {doc.reentry ? "ligada" : "desligada"}, a vista, 0,1% de taxa), so com os graficos disponiveis (~2,3 anos).
      </p>
      <p className="warn small">
        Cuidado: escolher moeda pelo resultado passado e vies de retrospecto. No teste de 2018-2026 (RESUMO 5q), as melhores de um
        periodo quase nunca repetiram no seguinte; so a SOL foi bem nos dois. Use como pista para estudar, nao como ordem de troca.
      </p>
    </section>
  );
}
