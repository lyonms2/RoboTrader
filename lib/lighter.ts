import { adminDb } from "./firebaseAdmin";
import { SYMBOLS, type LighterSyncDoc, type TradeDoc } from "./types";

// Lighter (perpetuos): API publica, sem chave. Le a conta pelo endereco da carteira e:
//   - posicao e preco medio de cada moeda -> sync/lighter (somados as operacoes manuais no painel)
//   - execucoes (agrupadas por ordem) desde config.lighter.since -> trades/lighter_{ordem}, so para historico
const API = "https://mainnet.zklighter.elliot.ai/api/v1";

type Fill = {
  trade_id_str: string;
  type: string;
  market_symbol: string;
  market_kind: string;
  size: string;
  price: string;
  timestamp: number;
  bid_account_id: number;
  ask_account_id: number;
  bid_id_str: string;
  ask_id_str: string;
};

type Account = {
  index: number;
  positions: { symbol: string; sign: number; position: string; avg_entry_price: string; realized_pnl: string }[];
};

const symbolOf = (s: string) => (SYMBOLS.includes(`${s}USDT`) ? `${s}USDT` : null);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Lighter respondeu HTTP ${res.status}`);
  return (await res.json()) as T;
}

// Execucoes da conta, da mais nova para a mais antiga, ate "since"
async function fills(account: number, since: number): Promise<Fill[]> {
  const out: Fill[] = [];
  let cursor = "";
  for (let page = 0; page < 30; page++) {
    const body = await get<{ trades?: Fill[]; next_cursor?: string }>(
      `trades?account_index=${account}&sort_by=timestamp&limit=100${cursor ? `&cursor=${cursor}` : ""}`);
    const batch = body.trades ?? [];
    out.push(...batch.filter((f) => f.timestamp >= since));
    if (!batch.length || !body.next_cursor || batch[batch.length - 1].timestamp < since) break;
    cursor = body.next_cursor;
  }
  return out;
}

// Junta as execucoes de uma mesma ordem numa operacao (quantidade somada, preco medio ponderado)
export function groupFills(list: Fill[], account: number) {
  const orders = new Map<string, TradeDoc & { ext: string }>();
  for (const f of list) {
    const symbol = symbolOf(f.market_symbol);
    if (!symbol || f.market_kind !== "perps") continue;
    const buy = f.bid_account_id === account;
    const id = `${buy ? f.bid_id_str : f.ask_id_str}`;
    const qty = Number(f.size);
    const prev = orders.get(id);
    if (prev) {
      const q = prev.qty + qty;
      prev.price = (prev.qty * prev.price + qty * Number(f.price)) / q;
      prev.qty = q;
      prev.t = Math.min(prev.t, f.timestamp);
    } else {
      orders.set(id, {
        symbol, side: buy ? "compra" : "venda", qty, price: Number(f.price), t: f.timestamp,
        source: "lighter", ext: id, note: f.type === "liquidation" ? "liquidacao" : undefined,
      });
    }
  }
  const r8 = (v: number) => Math.round(v * 1e8) / 1e8;
  return [...orders.values()].map((o) => ({ ...o, qty: r8(o.qty), price: r8(o.price) }));
}

// Sincroniza posicoes e importa execucoes novas. Chamado pelo agendador e pelo "Recalcular agora".
export async function syncLighter(address: string, since: number) {
  const db = adminDb();
  const body = await get<{ accounts?: Account[] }>(`account?by=l1_address&value=${address}`);
  const acc = body.accounts?.[0];
  if (!acc) return null; // sem conta na Lighter (ela so registra depois do primeiro deposito)

  const positions: Record<string, number> = {};
  const avgPrice: Record<string, number> = {};
  const realized: Record<string, number> = {};
  const shorts: string[] = [];
  for (const p of acc.positions) {
    const symbol = symbolOf(p.symbol);
    const size = Number(p.position) * (p.sign >= 0 ? 1 : -1);
    if (!symbol) continue;
    if (size < 0) shorts.push(`${p.symbol} ${size}`);
    // A estrategia e so comprada: posicao vendida nao entra na conta (fica so o aviso)
    positions[symbol] = Math.max(0, size);
    avgPrice[symbol] = size > 0 ? Number(p.avg_entry_price) : 0;
    realized[symbol] = Number(p.realized_pnl) || 0;
  }

  const ref = db.doc("sync/lighter");
  const prev = (await ref.get()).data() as LighterSyncDoc | undefined;
  // Busca so o que e novo (com 1 h de folga), a menos que a data inicial tenha mudado
  const from = prev && prev.since === since && prev.lastFill ? Math.max(since, prev.lastFill - 3_600_000) : since;
  const list = await fills(acc.index, from);
  const trades = groupFills(list, acc.index);
  for (let i = 0; i < trades.length; i += 400) {
    const batch = db.batch();
    for (const t of trades.slice(i, i + 400)) batch.set(db.doc(`trades/lighter_${t.ext}`), JSON.parse(JSON.stringify(t)));
    await batch.commit();
  }
  const doc: LighterSyncDoc = {
    at: Date.now(), account: acc.index, since, positions, avgPrice, realized, shorts,
    lastFill: Math.max(prev?.since === since ? prev.lastFill ?? 0 : 0, ...list.map((f) => f.timestamp), 0),
  };
  await ref.set(doc);
  return { imported: trades.length, positions };
}
