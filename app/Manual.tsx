"use client";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Card, EmptyState, Fold } from "./ui";

// Manual de uso (Mais > Ajuda): passo a passo curto de cada parte do site, com busca. O membro so ve o que existe para ele.
// Caminhos da navegacao nova (redesign de 24/11/2026): Inicio, Mes, + (Lancar), Patrimonio e Mais.
type Topic = { title: string; intro?: string; steps: string[]; tips?: string[]; owner?: boolean; robo?: boolean; member?: boolean };

const START: string[] = [
  "Cadastre suas contas e informe o saldo de hoje (botão ＋ → Conta / saldo de hoje).",
  "Importe o extrato do banco do mês (botão ＋ → Importar extrato do banco).",
  "Resolva o que aparecer em \"Para revisar\", no Mês: é o que deixa os números certos.",
  "Cadastre seus cartões, as compras parceladas e as assinaturas (Patrimônio → Cartões).",
  "Cadastre as contas de todo mês: aluguel, luz, internet (Mês → Contas do mês → + conta).",
  "Cadastre investimentos e bens (Patrimônio → Investimentos).",
  "Pronto: o Início passa a mostrar patrimônio, avisos e o que vence.",
];

const TOPICS: { group: string; items: Topic[] }[] = [
  { group: "Contas e lançamentos", items: [
    { title: "Cadastrar uma conta e informar o saldo", steps: [
      "Toque no botão ＋ e escolha \"Conta / saldo de hoje\" (ou Patrimônio → Contas → \"+ conta\").",
      "Digite o nome da conta (ex.: Conta do salário).",
      "Informe o saldo que aparece no app do banco e o dia desse saldo.",
      "Toque em Salvar.",
    ], tips: [
      "\"Conta sem extrato\" é para conta de outra pessoa, vale-alimentação ou dinheiro: começa em zero e só muda com o que você lança.",
      "Se o \"início do mês\" aparecer negativo, quase sempre faltam saídas lançadas: importe o extrato do mês inteiro.",
    ] },
    { title: "Importar o extrato do banco", steps: [
      "No app do banco, exporte o extrato em OFX ou CSV.",
      "Toque no botão ＋ → \"Importar extrato do banco\" e escolha o arquivo.",
      "Confira a conta de destino e as categorias sugeridas.",
      "Desmarque o que aparecer como \"já importado\" ou \"parece repetido\" e confirme.",
    ], tips: ["O arquivo é lido no seu navegador; só os lançamentos escolhidos são gravados."] },
    { title: "Lançar um gasto, uma entrada ou uma transferência à mão", steps: [
      "Toque no botão ＋ e escolha Gasto, Entrada ou Transferência.",
      "Preencha data, descrição e valor.",
      "Confira a categoria e a conta e toque em Lançar.",
    ] },
    { title: "Trocar a categoria, alterar ou dividir um lançamento", steps: [
      "No Mês, toque no lançamento: abre uma folha com a categoria, as ligações e os botões.",
      "Categoria: os iguais do mês mudam juntos e o site lembra para as próximas importações.",
      "\"Alterar dados\": muda data, descrição, valor, sentido (entrou/saiu) e conta.",
      "\"Dividir\": separa um valor cheio em partes (ex.: aluguel, água, luz e internet), cada uma com a sua categoria. \"Desfazer divisão\" volta ao original.",
    ] },
    { title: "Criar, renomear e excluir categorias suas", steps: [
      "Para criar: no seletor de categoria, escolha \"+ nova categoria de gasto\" (ou de entrada).",
      "Para renomear ou excluir: no fim do Mês, abra \"Categorias e como funciona\".",
      "Renomear muda o nome em todos os lançamentos e cadastros. Excluir passa o que estava nela para \"Outros\" (ou \"Outras entradas\").",
    ], tips: ["Cada pessoa pode ter até 20 categorias suas."] },
    { title: "Entender as cores e o que conta como gasto", steps: [
      "Verde: entrada (renda). Vermelho: gasto. Azul: dinheiro seu mudando de lugar (cofrinho, transferência entre suas contas, cripto).",
      "Compra no cartão não entra no mês da compra: o que conta é o pagamento da fatura.",
      "Guardar ou resgatar do cofrinho não é gasto nem renda, mas mexe no saldo da conta.",
    ] },
  ] },
  { group: "Contas do mês e gastos fixos", items: [
    { title: "Cadastrar um gasto fixo", steps: [
      "No Mês, em \"Contas do mês\", toque em \"+ conta\" (ou botão ＋ → Conta a pagar) e escolha \"Todo mês\".",
      "Informe descrição, valor, dia, categoria e o mês em que começa.",
      "Se o valor muda todo mês (luz, água), marque essa opção: a previsão usa a média.",
      "Se tem reajuste anual (aluguel), escolha o mês: o site avisa quando chegar.",
    ], tips: ["Mudou o valor? Toque no nome da conta e diga a partir de quando: os meses anteriores ficam com o valor antigo."] },
    { title: "Entrada fixa (aluguel recebido, salário...)", steps: [
      "No Mês, em \"Contas do mês\", toque em \"+ entrada\" (ou botão ＋ → Entrada fixa).",
      "Informe descrição, valor, dia em que costuma cair e categoria. Sem mês de fim, ela continua todo mês.",
      "Se o valor muda todo mês, marque essa opção (a previsão usa a média).",
      "Ela aparece como a receber até a entrada vir no extrato, ou toque em \"Recebi\".",
    ] },
    { title: "Lançar uma conta a pagar (ainda não paga)", steps: [
      "Botão ＋ → Conta a pagar → \"Uma vez só\".",
      "Informe descrição, valor, vencimento e categoria.",
      "Ela aparece em \"Contas do mês\" como a pagar e entra nos avisos, mas só conta como gasto quando você pagar.",
    ], tips: ["Se o mês virar sem pagar, ela continua aparecendo como atrasada no mês atual."] },
    { title: "Pagar uma conta do mês", steps: [
      "No Mês, em \"Contas do mês\", toque em \"Pagar\" na conta.",
      "Se já veio no extrato, toque no lançamento (o \"parece ser\" aparece no topo).",
      "Se não vem em extrato, escolha com que conta ou cartão pagou, o valor e a data, e toque em \"Lançar o pagamento\".",
      "Outra pessoa pagou com o dinheiro dela? Escolha o nome dela em \"Pagou com\": abate o que ela te deve.",
    ], tips: ["Ligou errado? Toque na conta paga em \"ver as contas pagas\" e altere."] },
    { title: "Somar alguns lançamentos ou simular valores", steps: [
      "Somar: em Lançamentos, toque em \"somar\" e depois nos lançamentos. A barra embaixo mostra entradas, saídas e o total.",
      "Simular: no menu \"…\" ao lado do mês, escolha \"Simular valores\" e digite valores que ainda não aconteceram.",
    ], tips: ["Nada disso é salvo: é só para fazer a conta na hora."] },
  ] },
  { group: "Lista de compras", items: [
    { title: "Usar a lista de compras do mercado", steps: [
      "Em Mais → Lista de compras, escreva os itens (vários de uma vez, separados por vírgula: \"arroz, 2 leite, café\").",
      "No mercado, marque o que já pegou: o item vai para o fim da lista. O preço é opcional e estima o total.",
      "Ao terminar, toque em \"Terminei: lançar o gasto\", informe o valor do cupom e com o que pagou: a compra entra no Mês (Mercado).",
      "Os itens que você mais usa aparecem em \"Frequentes\" para adicionar com um toque.",
    ] },
    { title: "Salvar o preço dos produtos e ver se está caro", steps: [
      "Digite o preço de um item da lista: ele fica salvo no produto, com a data.",
      "Na próxima lista, o item já vem com o último preço. Mudou o preço? O site compara: menor preço, barato, na média ou caro (+%).",
      "Em \"Produtos salvos\" você vê último, menor e média de cada produto e pode salvar um preço sem estar comprando.",
    ], tips: ["Use sempre o mesmo nome e o preço da mesma unidade (ex.: o pacote de 5 kg), para a comparação fazer sentido."] },
    { title: "Lista de compras inteligente", steps: [
      "Mercado de hoje: escolha no topo da lista; os preços digitados ficam com o mercado e a tabela mostra onde cada produto saiu mais barato.",
      "Tamanho da embalagem (Produtos salvos, \"+ tamanho\"): aparece o preço por kg/litro, para comparar pacotes diferentes.",
      "Depois de 2 compras terminadas, o site sabe de quanto em quanto tempo você compra cada coisa e mostra \"Está na hora de comprar\".",
      "\"Bom para estocar\": item que você compra sempre, no menor preço da sua história.",
      "Sua inflação no mercado: quanto os seus produtos subiram em 3, 6 e 12 meses, ao lado do IPCA.",
    ] },
  ] },
  { group: "Orçamento e metas", items: [
    { title: "Definir um orçamento por categoria", steps: [
      "No Mês, abra \"Orçamento\" e toque em \"+ categoria\".",
      "Escolha a categoria de gasto e o limite por mês (ex.: Alimentação R$ 600) e salve.",
      "A barra mostra quanto já foi e quanto sobra (amarela aos 80%, vermelha quando passa). Para mudar ou remover, toque em \"alterar\" (0 remove).",
    ], tips: ["Conta o que saiu da conta e as compras no cartão feitas no mês, cada uma na sua categoria. O pagamento da fatura não entra: as compras dela já contaram."] },
    { title: "Planejar quanto gastar na fatura de um cartão", steps: [
      "Em Patrimônio → Cartões, toque no lápis ao lado do cartão (ou em \"alterar\" no Orçamento do Mês).",
      "Preencha \"Planejado por fatura\" (ex.: R$ 1.500) e salve.",
      "A fatura mostra a barra do planejado e o Início avisa aos 80%.",
    ], tips: ["É outro jeito de olhar as mesmas compras: não se soma ao orçamento por categoria."] },
    { title: "Criar uma meta de economia", steps: [
      "Em Patrimônio → Investimentos, abra \"Metas\" e toque em \"+ nova meta\".",
      "Dê um nome, diga quanto quer juntar e, se quiser, até quando.",
      "Escolha um cofrinho ou investimento para o progresso andar sozinho, ou informe o valor à mão.",
    ], tips: ["Com prazo, o site mostra quanto guardar por mês para chegar lá."] },
  ] },
  { group: "Cartões e empréstimos", items: [
    { title: "Lançar uma compra no cartão", steps: [
      "Toque no botão ＋ → \"Compra no cartão\" (ou, em Patrimônio → Cartões, \"Nova compra\").",
      "Preencha data, descrição, valor total e o número de parcelas.",
      "Para assinatura (cobra todo mês até cancelar), marque \"Assinatura\" em vez de parcelas.",
    ], tips: ["Embaixo da fatura aparece o melhor dia para comprar: a compra já cai na fatura seguinte."] },
    { title: "Pagar a fatura", steps: [
      "Em Patrimônio → Cartões, escolha o cartão e toque em \"Pagar fatura\".",
      "Informe o valor, a data e a conta. Se o pagamento já está no extrato importado, escolha \"não lançar saída\".",
    ] },
    { title: "Cadastrar e pagar um empréstimo", steps: [
      "Em Patrimônio → Empréstimos, toque em \"+ empréstimo\" e informe parcela, quantidade, primeiro mês e dia.",
      "Toque no empréstimo para ver as parcelas. Use \"Pagar parcela\" ou \"Adiantar parcelas\".",
    ] },
  ] },
  { group: "A receber", items: [
    { title: "Alguém me deve em parcelas", steps: [
      "Em Patrimônio → A receber, toque em \"+ a receber\".",
      "Escolha \"Emprestei dinheiro\" ou \"Vendi / prestei serviço\" e informe as parcelas.",
      "Quando a pessoa pagar, o Pix com o nome dela é reconhecido sozinho; ou toque em \"Recebi\".",
    ] },
    { title: "Conta com uma pessoa (saldo que sobe e desce)", steps: [
      "Em \"+ a receber\", escolha \"Conta com a pessoa\" e informe quanto ela deve hoje.",
      "Pagou algo por ela? Mude a categoria do lançamento para \"Emprestei dinheiro\" e escolha a pessoa.",
      "Ela pagou uma conta sua (ex.: condomínio)? Na folha Pagar da conta, escolha o nome dela: conta como seu gasto, sem sair da sua conta.",
    ] },
  ] },
  { group: "Investimentos e bens", items: [
    { title: "Cadastrar investimentos", steps: [
      "Em Patrimônio → Investimentos, toque em \"+ Investimento\".",
      "Escolha o tipo: cofrinho (saldo + % do CDI), Tesouro, ação/FII/ETF (código + quantidade) ou outro.",
      "Toque em \"Atualizar cotações\" para trazer preços e proventos.",
      "Cofrinho com duas taxas (uma parte rende mais)? Marque \"Uma parte do saldo rende outra taxa\" e informe o valor e o % dessa parte.",
    ], tips: ["Se o app do banco mostra o valor já sem IR, o site (que calcula o bruto) fica um pouco acima: atualize o saldo de vez em quando.", "Aplicações e resgates do extrato (categoria Investimento) ligados a um cofrinho somam e descontam o saldo dele sozinhos."] },
    { title: "Comparar seus investimentos com o CDI", steps: [
      "Em Patrimônio → Investimentos, toque no Tesouro ou na ação.",
      "Informe o preço médio e a data da compra e salve.",
      "O bloco \"Comparação com o CDI\" mostra quanto rendeu (com proventos) e quanto o mesmo dinheiro teria rendido a 100% do CDI.",
    ], tips: ["Comprou em várias datas? Use a data da primeira compra: a comparação fica aproximada. Menos de 3 meses diz pouco."] },
    { title: "Cadastrar bens (imóvel, veículo)", steps: [
      "Em Patrimônio → Investimentos, abra \"Imóveis e veículos\" e toque em \"+ novo bem\".",
      "Informe o valor estimado e, se quiser, quanto valoriza ou deprecia por ano.",
    ] },
  ] },
  { group: "Início e avisos", items: [
    { title: "Ler o Início", steps: [
      "Patrimônio líquido: tudo o que você tem, mais o que te devem, menos as dívidas. O \"i\" mostra a conta linha a linha.",
      "\"Para hoje\": os avisos mais urgentes primeiro (saldo que não cobre o que vence, fatura vencendo, limite do cartão...). Toque para abrir.",
      "O X esconde um aviso até o mês seguinte.",
    ] },
  ] },
  { group: "Cripto", items: [
    { title: "Acompanhar a carteira cripto", steps: [
      "Em Mais → Cripto, toque na engrenagem e cole o endereço público da carteira.",
      "Toque em \"Atualizar\" para ler os saldos.",
      "Em Carteira → Meus tokens, informe o preço médio para ver lucro e prejuízo.",
    ], tips: ["É só leitura: o site nunca pede frase secreta nem chave privada, e não movimenta nada."] },
    { title: "Robô: estudo da regra", robo: true, steps: [
      "Em Mais → Cripto: robô, cada moeda aparece em relação à regra (SMA 150 + HMA 100), com o comportamento da regra no passado.",
      "É estudo educacional: não é recomendação de compra ou venda.",
    ] },
    { title: "Robô e tokens, Operações manuais", owner: true, steps: [
      "Robô e tokens: os sinais do robô, o \"Real x estratégia\" (seu resultado comparado com seguir a regra à risca) e as fichas dos tokens.",
      "Operações manuais: registre compras e vendas feitas fora das carteiras; elas entram no \"Real x estratégia\".",
    ] },
  ] },
  { group: "Sua conta", items: [
    { title: "Exportar meus dados (backup)", steps: [
      "Em Patrimônio → Contas, no fim da página (\"Seus dados\"), ou em \"Minha conta\" (membros).",
      "\"Exportar tudo\" baixa um arquivo com tudo o que você lançou: guarde como backup.",
      "\"Lançamentos em planilha\" baixa um CSV que abre em qualquer planilha.",
    ], tips: ["O arquivo inclui os endereços públicos das carteiras: guarde num lugar seu e não compartilhe."] },
    { title: "Pedir ajuda (modo suporte) e privacidade", steps: [
      "Em \"Minha conta\" (no botão com a sua inicial, no topo), toque em \"Permitir suporte por 24 horas\" para o SeuBitico ver seus dados, sem poder alterar.",
      "Você pode tocar em \"Encerrar agora\" quando quiser; depois de 24 horas o acesso fecha sozinho.",
      "\"Apagar meus dados\" remove tudo o que você lançou no site.",
    ] },
    { title: "Sua assinatura", member: true, steps: [
      "Em \"Minha conta\" aparece até quando a sua assinatura está paga.",
      "Uma semana antes de vencer, um aviso aparece no topo do site.",
      "Para renovar, fale com o SeuBitico: seus dados continuam guardados.",
    ] },
    { title: "Liberar membros e dar suporte", owner: true, steps: [
      "Em \"Membros\" (Mais, ou o botão com a sua inicial), digite o e-mail Google do membro, escolha a data de vencimento e toque em \"Liberar acesso\".",
      "Membros veem finanças e a própria carteira cripto; o Robô e as fichas dos tokens são só seus.",
      "A lista mostra primeiro os atrasados e os que vencem em até 7 dias. O vencimento é só um lembrete: ninguém é bloqueado sozinho.",
      "Quando o membro pagar, toque em \"+1 mês\" ou ajuste a data. Quem não pagou, toque em \"remover\".",
      "Quando o membro permitir o suporte, aparece \"Ver conta (suporte)\" ao lado do e-mail dele: abre a conta em modo leitura.",
    ] },
  ] },
];

// busca sem acento e sem maiuscula
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Manual({ member, robo = true }: { member: boolean; robo?: boolean }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => TOPICS.map((g) => ({ ...g, items: g.items.filter((t) => (!t.owner || !member) && (!t.member || member) && (!t.robo || robo)) })).filter((g) => g.items.length), [member, robo]);
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hit = (t: Topic) => { const txt = norm([t.title, ...t.steps, ...(t.tips ?? [])].join(" ")); return words.every((w) => txt.includes(w)); };
  const found = words.length ? groups.map((g) => ({ ...g, items: g.items.filter(hit) })).filter((g) => g.items.length) : groups;
  const n = found.reduce((t, g) => t + g.items.length, 0);
  return (
    <div className="help">
      <h1 className="help-title">Ajuda</h1>
      <label className="help-search">
        <Search size={18} aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="O que você quer fazer? Ex.: pagar fatura" aria-label="Buscar na ajuda" />
        {q && <button type="button" aria-label="Limpar a busca" onClick={() => setQ("")}><X size={16} aria-hidden="true" /></button>}
      </label>

      {!words.length && (
        <Fold title="Comece por aqui" meta="uns 20 minutos" defaultOpen>
          <Card><ol className="manual-steps">{START.map((s) => <li key={s}>{s}</li>)}</ol></Card>
        </Fold>
      )}
      {words.length > 0 && <p className="mes-line">{n ? `${n} ${n > 1 ? "tópicos" : "tópico"}` : "Nada encontrado"}</p>}
      {words.length > 0 && !n && <Card><EmptyState title="Não achei esse assunto" text="Tente outra palavra (ex.: cartão, extrato, saldo, meta)." /></Card>}

      {found.map((g) => (
        <section className="ui-section" key={g.group}>
          <div className="ui-section-head"><h2>{g.group}</h2></div>
          <div className="ui-list help-list">
            {g.items.map((t) => (
              <details className="help-topic" key={t.title} open={words.length > 0 && n <= 3}>
                <summary>{t.title}</summary>
                <ol className="manual-steps">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                {t.tips?.map((x) => <p className="help-tip" key={x}>Dica: {x}</p>)}
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="mes-line">Ferramenta educacional de organização: nada aqui é recomendação de investimento.</p>
    </div>
  );
}
