"use client";
import { useEffect, useState } from "react";
import { CalendarDays, CreditCard, PieChart, Plus } from "lucide-react";
import Dashboard from "../Dashboard";
import { Badge, Button, Card, EmptyState, InfoTip, List, ListRow, Money, Progress, Section, Segmented, Sheet, Skeleton, Stat, Stats } from "../ui";
import { sampleDemo } from "./sample";

type View = "pecas" | "dono" | "membro";

export default function Gallery() {
  const [view, setView] = useState<View | null>(null);
  useEffect(() => { setView((new URLSearchParams(location.search).get("v") as View) || "pecas"); }, []);
  const go = (v: View) => { setView(v); history.replaceState(null, "", `?v=${v}`); };
  if (!view) return null;
  return (
    <>
      <div style={{ padding: "12px 20px 0", maxWidth: 960, margin: "0 auto" }}>
        <Segmented label="Demonstração" value={view} onChange={go}
          options={[{ id: "pecas", label: "Peças" }, { id: "dono", label: "Painel (dono)" }, { id: "membro", label: "Painel (membro)" }]} />
      </div>
      {view === "pecas" ? <Pieces /> : <Dashboard key={view} demo={sampleDemo(view === "membro")} />}
    </>
  );
}

function Pieces() {
  const [sheet, setSheet] = useState(false);
  const [seg, setSeg] = useState("cartoes");
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "16px 20px 80px", display: "flex", flexDirection: "column", gap: 24 }}>
      <Card tone="brand">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#c9b48f", fontWeight: 600 }}>Patrimônio líquido</span>
          <InfoTip more={{ href: "#" }}><p>O que você tem (contas, investimentos, bens e a receber) menos o que deve (cartões e empréstimos).</p></InfoTip>
        </div>
        <div style={{ marginTop: 4 }}><Money value={12480.35} size="xl" /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone="pos">▲ R$ 640 no mês</Badge><span style={{ fontSize: 12, color: "var(--text-3)" }}>tem R$ 21.300 · deve R$ 8.820</span>
        </div>
      </Card>

      <Stats scroll>
        <Stat label="Reserva" value={<Money value={6100} size="md" cents={false} />} hint="2,9 meses" />
        <Stat label="Sobrou no mês" value={<Money value={2665} size="md" cents={false} tone="pos" />} hint="de R$ 6.028" />
        <Stat label="Rende por mês" value={<Money value={39} size="md" cents={false} />} hint="estimado" />
      </Stats>

      <Section title="Para hoje" count={3} action={<Button variant="link">ver todos</Button>}>
        <List>
          <ListRow icon={<CalendarDays size={18} />} iconTone="warn" title="Academia vence amanhã" sub="conta do mês" value="R$ 107" onClick={() => setSheet(true)} />
          <ListRow icon={<CreditCard size={18} />} iconTone="neg" title="Cartão A: 96% do planejado" sub="fatura de dezembro" value="R$ 961" onClick={() => undefined} />
          <ListRow icon={<PieChart size={18} />} iconTone="info" title="Moradia em 84% do orçamento" sub="sobram R$ 161" onClick={() => undefined} />
        </List>
      </Section>

      <Section title="Orçamento" info={<p>Conta o que saiu da conta e as compras no cartão, cada uma na sua categoria.</p>}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><b>Moradia</b><span className="ui-num" style={{ color: "var(--text-3)" }}>839 / 1.000</span></div>
          <div style={{ marginTop: 6 }}><Progress value={0.84} label="Moradia" /></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 12 }}><b>Mercado</b><span className="ui-num" style={{ color: "var(--text-3)" }}>686 / 1.300</span></div>
          <div style={{ marginTop: 6 }}><Progress value={0.53} label="Mercado" /></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 12 }}><b>Lazer</b><span className="ui-num" style={{ color: "var(--text-3)" }}>420 / 350</span></div>
          <div style={{ marginTop: 6 }}><Progress value={1.2} label="Lazer" /></div>
        </Card>
      </Section>

      <Section title="Botões e etiquetas">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button variant="primary" icon={<Plus size={18} />}>Lançar</Button>
          <Button>Secundário</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="danger">Apagar</Button>
          <Button variant="primary" size="sm">Pagar</Button>
          <Button variant="link">confirmar</Button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge>neutra</Badge><Badge tone="pos">pago</Badge><Badge tone="warn">vence amanhã</Badge><Badge tone="neg">atrasado</Badge><Badge tone="info">varia</Badge><Badge tone="brand">3</Badge>
        </div>
        <Segmented label="Partes" value={seg} onChange={setSeg}
          options={[{ id: "contas", label: "Contas" }, { id: "invest", label: "Investimentos" }, { id: "cartoes", label: "Cartões", badge: "R$ 961" }, { id: "emp", label: "Empréstimos" }, { id: "rec", label: "A receber" }]} />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
          <Money value={-356.24} signed tone="auto" /><Money value={400} signed tone="auto" /><Money value={960.9} size="lg" /><Money value={10466.86} size="md" tone="brand" />
        </div>
      </Section>

      <Section title="Vazio e carregando">
        <Card><EmptyState title="Nenhum lançamento ainda" text="Importe o extrato do banco ou lance um gasto à mão." action={<Button variant="primary">Lançar</Button>} /></Card>
        <Card><div style={{ display: "flex", flexDirection: "column", gap: 10 }}><Skeleton w="40%" h={12} /><Skeleton h={28} /><Skeleton w="70%" /></div></Card>
      </Section>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Pagar Academia">
        <p style={{ margin: "0 0 16px", color: "var(--text-2)" }}>Exemplo de folha: no celular sobe de baixo, no computador vira janela.</p>
        <Button variant="primary" block onClick={() => setSheet(false)}>Confirmar</Button>
      </Sheet>
    </main>
  );
}
