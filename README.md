# Robô de Sinais (BTC/ETH, diário)

Painel web que calcula todo dia o sinal da estratégia diária, a mesma do `btc_swing_sma_vol.pine` e do `robo_sinais.py`:

- **Compra:** o fechamento diário fica acima de SMA 150 × (1 + 2%) e a HMA 100 está subindo.
- **Saída:** o fechamento fica abaixo de SMA 150 × (1 − 2%) **ou** a HMA 100 vira para baixo.
- **Tamanho:** 1x × min(1, 80% ÷ volatilidade de 30 dias). Só rebalanceia se a diferença passar de 25%.

**Não opera nada.** Ele não tem chave de corretora, só mostra o que fazer, e você executa manualmente.

## Como funciona

```
Vercel Cron (todo dia, logo depois das 00:00 UTC = 21:00 Brasília)
  └─ /api/cron: busca os candles diários públicos (Binance), calcula o sinal
       ├─ grava no Firestore: latest/{ativo}, history/{ativo}_{data}
       └─ (opcional) avisa no Telegram se houver COMPRAR/VENDER/REBALANCEAR
Painel (Next.js na Vercel) com login Google
  ├─ cartões por ativo: ação sugerida, gráfico, SMA, HMA, volatilidade, exposição alvo
  ├─ "Registrar operação": anota a compra/venda que você fez e atualiza a posição
  ├─ "Configuração": capital, pesos (BTC/ETH 50/50), posição, reentrada no repique
  └─ "Recalcular agora": roda o cálculo na hora
```

A ação mostrada no painel compara a exposição alvo com a **posição registrada**. Por isso, registre cada operação.

## Passo a passo (uma vez só)

### 1. Firebase
1. Em [console.firebase.google.com](https://console.firebase.google.com), crie um projeto. O Google Analytics não é necessário.
2. Vá em **Build → Firestore Database → Criar banco de dados**, no modo de produção, na região `southamerica-east1`.
3. Vá em **Firestore → Regras** e cole o conteúdo de [`firestore.rules`](firestore.rules), **trocando `SEU_EMAIL@gmail.com` pelo seu e-mail**. Depois clique em Publicar.
4. Vá em **Build → Authentication → Começar → Google** e ative.
5. Em **Configurações do projeto → Seus apps → Web (`</>`)**, registre o app. Anote `apiKey`, `authDomain`, `projectId` e `appId`.
6. Em **Configurações do projeto → Contas de serviço → Gerar nova chave privada**, baixe o JSON. **É secreto: não suba para o GitHub.**

### 2. Telegram (opcional)
1. No Telegram, fale com o **@BotFather**, digite `/newbot` e guarde o token.
2. Mande qualquer mensagem para o seu bot e depois fale com o **@userinfobot** para descobrir o seu chat id.

### 3. Vercel
1. Em [vercel.com](https://vercel.com), clique em **Add New → Project** e importe o repositório `RoboTrader`.
2. Em **Environment Variables**, cadastre as variáveis do [`.env.example`](.env.example):

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` | Valores do passo 1.5 |
| `FIREBASE_SERVICE_ACCOUNT` | O JSON do passo 1.6 inteiro, colado como está |
| `ALLOWED_EMAIL` | Seu e-mail do Google |
| `CRON_SECRET` | Um texto aleatório longo (por exemplo, gerado num gerenciador de senhas) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Opcional (passo 2) |

3. Clique em **Deploy**.
4. Volte ao Firebase, em **Authentication → Configurações → Domínios autorizados**, e adicione o domínio da Vercel (`seu-projeto.vercel.app`).
5. Abra o site, entre com o Google, clique em **Recalcular agora** e ajuste capital e posição em **Configuração**.

O cron (`vercel.json`) roda uma vez por dia. No plano gratuito, a Vercel pode executá-lo em qualquer momento dentro da hora agendada (00:10–00:59 UTC).

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev
```

## Validação

A lógica em [`lib/strategy.ts`](lib/strategy.ts) foi comparada dia a dia com o `robo_sinais.py`, em BTC e ETH desde 2017 (3.363 dias). Os sinais deram iguais em todos os dias, com diferença de exposição de ~1e-16. O robô Python, por sua vez, confere com o backtest da estratégia.

---
Ferramenta educacional. **Não é recomendação de investimento.**
