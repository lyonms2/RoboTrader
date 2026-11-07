import type { WalletItem } from "./types";

// Carteira Solana (ex.: Phantom), so leitura pelo endereco publico, sem chave:
//   saldos = RPC publica da Solana; precos e simbolos = API publica da Jupiter
const RPC = "https://api.mainnet-beta.solana.com";
const JUP = "https://lite-api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
// SOL em staking liquido conta como SOL na estrategia
const SOL_LIKE = /^(W?SOL|JITOSOL|MSOL|BSOL|JUPSOL|INF|BNSOL|HSOL|VSOL|DSOL|STSOL)$/i;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RPC da Solana respondeu HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`RPC da Solana: ${body.error.message}`);
  return body.result as T;
}

type TokenAccounts = { value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } } }[] };

export async function readSolana(address: string): Promise<WalletItem[]> {
  const lamports = (await rpc<{ value: number }>("getBalance", [address])).value;
  const amounts = new Map<string, number>();
  if (lamports > 0) amounts.set(SOL_MINT, lamports / 1e9);
  for (const programId of TOKEN_PROGRAMS) {
    const acc = await rpc<TokenAccounts>("getTokenAccountsByOwner", [address, { programId }, { encoding: "jsonParsed" }]);
    for (const a of acc.value) {
      const info = a.account.data.parsed.info;
      const q = info.tokenAmount.uiAmount ?? 0;
      if (q > 0) amounts.set(info.mint, (amounts.get(info.mint) ?? 0) + q);
    }
  }
  const mints = [...amounts.keys()].slice(0, 50);
  if (!mints.length) return [];
  const [prices, meta] = await Promise.all([
    fetch(`${JUP}/price/v3?ids=${mints.join(",")}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})) as Promise<Record<string, { usdPrice?: number }>>,
    fetch(`${JUP}/tokens/v2/search?query=${mints.join(",")}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])) as Promise<{ id: string; symbol: string; name: string }[]>,
  ]);
  const names = new Map(meta.map((m) => [m.id, m]));
  const items: WalletItem[] = [];
  for (const mint of mints) {
    const qty = amounts.get(mint)!;
    const price = prices[mint]?.usdPrice;
    if (!price) continue; // sem preco na Jupiter (NFT ou token sem liquidez): fica de fora
    const value = qty * price;
    if (value < 0.01) continue;
    const m = names.get(mint);
    const symbol = mint === SOL_MINT ? "SOL" : m?.symbol ?? mint.slice(0, 6);
    items.push({
      app: "Carteira Solana",
      chain: "solana",
      type: "wallet",
      symbol,
      name: m?.name ?? symbol,
      qty,
      value,
      cls: SOL_LIKE.test(symbol) ? "SOL" : /USD/i.test(symbol) ? "stable" : /BTC/i.test(symbol) ? "BTC" : /ETH/i.test(symbol) ? "ETH" : "outro",
      maturity: null,
    });
  }
  return items;
}
