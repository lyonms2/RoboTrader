"use client";
// Folha unica "O que voce quer lancar?": abre do botao + em qualquer tela e usa os mesmos formularios de sempre
import { useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, CreditCard, FileUp, Landmark, Repeat } from "lucide-react";
import { accountsOf, todayBR, type Account, type GastosSetup, type MonthDoc } from "@/lib/gastos";
import type { FinItem } from "@/lib/types";
import { AccountForm, FixoForm, ImportPanel, PayableForm, QuickAdd, saveSetup } from "./GastosCard";
import { tell } from "./Dialog";
import { Button, List, ListRow, Segmented, Sheet } from "./ui";

type Pick = "gasto" | "entrada" | "cartao" | "transf" | "import" | "pagar" | "fixaIn" | "conta";
const TITLE: Record<Pick, string> = {
  gasto: "Gasto", entrada: "Entrada", cartao: "Compra no cartão", transf: "Transferência",
  import: "Importar extrato do banco", pagar: "Conta a pagar", fixaIn: "Entrada fixa", conta: "Conta / saldo de hoje",
};

export default function LaunchSheet({ open, onClose, months, setup, invest, onCards }: {
  open: boolean; onClose: () => void; months: Record<string, MonthDoc>; setup: GastosSetup; invest: FinItem[];
  onCards?: () => void; // sem cartao cadastrado: leva para Patrimonio > Cartoes
}) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [once, setOnce] = useState(false);
  const [msg, setMsg] = useState("");
  const [n, setN] = useState(0); // muda a key para limpar o formulario depois de salvar
  const close = () => { setPick(null); setMsg(""); onClose(); };
  const go = (p: Pick) => { setMsg(""); setOnce(false); setPick(p); };
  const done = (m?: string) => { setMsg(m ?? "Salvo."); setN((x) => x + 1); };
  const accounts = accountsOf(setup);
  const saveAccount = async (a: Account) => {
    const list = accounts.some((x) => x.id === a.id) ? accounts.map((x) => (x.id === a.id ? a : x)) : [...accounts, a];
    try {
      await saveSetup({ accounts: JSON.parse(JSON.stringify(list)), account: null } as Partial<GastosSetup>);
      done(`Adicionada: conta ${a.name}${a.balance !== undefined ? `, saldo ${a.balance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}.`);
    } catch { await tell("Não salvou (sem conexão?). Tente de novo."); }
  };

  return (
    <Sheet open={open} onClose={close} title={pick ? TITLE[pick] : "O que você quer lançar?"} width={pick === "import" ? 760 : 560}>
      {!pick ? (
        <>
          <p className="ls-label">No dia a dia</p>
          <div className="ls-grid">
            <Tile tone="neg" icon={<ArrowUpRight size={20} />} title="Gasto" sub="saiu da conta" onClick={() => go("gasto")} />
            <Tile tone="pos" icon={<ArrowDownLeft size={20} />} title="Entrada" sub="entrou na conta" onClick={() => go("entrada")} />
            <Tile tone="brand" icon={<CreditCard size={20} />} title="Compra no cartão" sub="à vista ou parcelada" onClick={() => go("cartao")} />
            <Tile tone="info" icon={<ArrowLeftRight size={20} />} title="Transferência" sub="entre suas contas" onClick={() => go("transf")} />
          </div>
          <p className="ls-label">Organizar</p>
          <List>
            <ListRow icon={<FileUp size={18} />} title="Importar extrato do banco" chevron onClick={() => go("import")} />
            <ListRow icon={<CalendarClock size={18} />} title={<>Conta a pagar <span className="ls-soft">· todo mês ou uma vez</span></>} chevron onClick={() => go("pagar")} />
            <ListRow icon={<Repeat size={18} />} title={<>Entrada fixa <span className="ls-soft">· salário, aluguel</span></>} chevron onClick={() => go("fixaIn")} />
            <ListRow icon={<Landmark size={18} />} title="Conta / saldo de hoje" chevron onClick={() => go("conta")} />
          </List>
        </>
      ) : (
        <div className="ls-form">
          <Button variant="link" className="ls-back" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => { setPick(null); setMsg(""); }}>outro tipo</Button>
          {(pick === "gasto" || pick === "entrada" || pick === "transf") &&
            <QuickAdd key={`${pick}-${n}`} preset={pick === "transf" ? "transfer" : pick} months={months} setup={setup} invest={invest} defaultDate={todayBR()} />}
          {pick === "cartao" && (setup.cards.length
            ? <QuickAdd key={`cartao-${n}`} mode="cartao" months={months} setup={setup} invest={invest} defaultDate={todayBR()} />
            : <p className="muted small">Cadastre um cartão primeiro, em Patrimônio &gt; Cartões.{onCards && <> <Button variant="link" onClick={() => { close(); onCards(); }}>ir para Cartões</Button></>}</p>)}
          {pick === "import" && <ImportPanel months={months} setup={setup} invest={invest} onDone={close} />}
          {pick === "pagar" && <>
            <Segmented label="Repete?" value={once ? "uma" : "mes"} onChange={(v) => setOnce(v === "uma")}
              options={[{ id: "mes", label: "Todo mês" }, { id: "uma", label: "Uma vez só" }]} />
            <p className="muted small">{once ? "Boleto, conserto, IPVA..." : "Aluguel, internet, luz..."}</p>
            {once ? <PayableForm key={`once-${n}`} setup={setup} fixo={null} onDone={done} /> : <FixoForm key={`fixo-${n}`} setup={setup} fixo={null} onDone={done} />}
          </>}
          {pick === "fixaIn" && <FixoForm key={`in-${n}`} setup={setup} fixo={null} entrada onDone={done} />}
          {pick === "conta" && <AccountForm key={`acc-${n}`} acc={null} canRemove={false} onCancel={() => setPick(null)} onRemove={() => undefined} onSave={saveAccount} />}
          {msg && <p className="ls-msg">&#10003; {msg}</p>}
        </div>
      )}
    </Sheet>
  );
}

function Tile({ tone, icon, title, sub, onClick }: { tone: "neg" | "pos" | "brand" | "info"; icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" className="ls-tile" onClick={onClick}>
      <span className={`ls-ico ${tone}`} aria-hidden="true">{icon}</span>
      <span><b>{title}</b><small>{sub}</small></span>
    </button>
  );
}
