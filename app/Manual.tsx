"use client";

// Manual de uso (aba Ajuda): passo a passo curto de cada parte do site. O membro so ve o que existe para ele.
type Topic = { title: string; intro?: string; steps: string[]; tips?: string[]; owner?: boolean };

const START: string[] = [
  "Cadastre suas contas e informe o saldo de hoje (Finanças → Lançamentos → Conta / saldo).",
  "Importe o extrato do banco do mês (Lançamentos → Importar extrato).",
  "Resolva o que aparecer em \"Para revisar\": é o que deixa os números certos.",
  "Cadastre seus cartões e as compras parceladas e assinaturas (Cartões e empréstimos).",
  "Cadastre as contas: aluguel, luz, internet (Lançamentos → Contas a pagar → Todo mês).",
  "Cadastre investimentos e bens (Investimentos).",
  "Pronto: a Visão geral passa a mostrar patrimônio, avisos e o que vence.",
];

const TOPICS: { group: string; items: Topic[] }[] = [
  { group: "Contas e lançamentos", items: [
    { title: "Cadastrar uma conta e informar o saldo", steps: [
      "Vá em Finanças → Lançamentos e clique em \"Conta / saldo\".",
      "Digite o nome da conta (PicPay, Nubank...).",
      "Informe o saldo que aparece no app do banco e o dia desse saldo.",
      "Clique em Salvar.",
    ], tips: [
      "\"Conta sem extrato\" é para conta de outra pessoa, vale-alimentação ou dinheiro: começa em zero e só muda com o que você lança.",
      "Se o \"início do mês\" aparecer negativo, quase sempre faltam saídas lançadas: importe o extrato do mês inteiro.",
    ] },
    { title: "Importar o extrato do banco", steps: [
      "No app do banco, exporte o extrato em OFX ou CSV.",
      "Em Lançamentos, clique em \"Importar extrato\" e escolha o arquivo.",
      "Confira a conta de destino e as categorias sugeridas.",
      "Desmarque o que aparecer como \"já importado\" ou \"parece repetido\" e confirme.",
    ], tips: ["O arquivo é lido no seu navegador; só os lançamentos escolhidos são gravados."] },
    { title: "Lançar um gasto ou uma entrada à mão", steps: [
      "Em Lançamentos, clique em \"Gasto ou entrada\".",
      "Escolha Gasto ou Entrada, preencha data, descrição e valor.",
      "Confira a categoria e a conta e clique em Lançar.",
    ] },
    { title: "Trocar a categoria, alterar ou dividir um lançamento", steps: [
      "Categoria: troque direto no seletor da linha. Os iguais do mês mudam juntos e o site lembra para as próximas importações.",
      "\"alterar\": muda data, descrição, valor, sentido (entrou/saiu) e conta.",
      "\"dividir\": separa um valor cheio em partes (ex.: aluguel, água, luz e internet), cada uma com a sua categoria. \"desfazer divisão\" volta ao original.",
    ] },
    { title: "Entender as cores e o que conta como gasto", steps: [
      "Verde: entrada (renda). Vermelho: gasto. Azul: dinheiro seu mudando de lugar (cofrinho, transferência entre suas contas, cripto).",
      "Compra no cartão não entra no mês da compra: o que conta é o pagamento da fatura.",
      "Guardar ou resgatar do cofrinho não é gasto nem renda, mas mexe no saldo da conta.",
    ] },
  ] },
  { group: "Contas do mês e gastos fixos", items: [
    { title: "Cadastrar um gasto fixo", steps: [
      "Em Lançamentos, clique em \"Contas a pagar\" e escolha \"Todo mês\".",
      "Informe descrição, valor, dia, categoria e o mês em que começa.",
      "Se o valor muda todo mês (luz, água), marque essa opção: a previsão usa a média.",
      "Se tem reajuste anual (aluguel), escolha o mês: o site avisa quando chegar.",
    ], tips: ["Mudou o valor? Altere o fixo e diga a partir de quando: os meses anteriores ficam com o valor antigo."] },
    { title: "Lançar uma conta a pagar (ainda não paga)", steps: [
      "Em Lançamentos, clique em \"Contas a pagar\" e escolha \"Uma vez só\".",
      "Informe descrição, valor, vencimento e categoria.",
      "Ela aparece em \"Contas do mês\" como a pagar e entra nos avisos, mas só conta como gasto quando você pagar.",
      "Quando pagar, ligue ao lançamento do extrato ou diga com que conta pagou, como num gasto fixo.",
    ], tips: ["Se o mês virar sem pagar, ela continua aparecendo como atrasada no mês atual."] },
    { title: "Somar alguns lançamentos ou simular valores", steps: [
      "Somar: marque os lançamentos na lista. A barra embaixo mostra entradas, saídas e o total dos marcados.",
      "Simular: clique em \"simular\" ao lado do mês e digite valores que ainda não aconteceram (- sai / + entra).",
      "O site mostra como ficariam o saldo nas contas, o saldo depois de pagar o que falta e o que sobra no mês.",
    ], tips: ["Nada disso é salvo: é só para fazer a conta na hora."] },
    { title: "Marcar uma conta do mês como paga", steps: [
      "No bloco \"Contas do mês\" (acima da lista de lançamentos), ache a conta \"a pagar\".",
      "Em \"pagar / ligar…\", escolha o lançamento que já veio no extrato, ou a conta com que pagou.",
      "Informe o dia em que pagou. Se o site ligou o lançamento errado, clique em \"alterar\".",
    ] },
  ] },
  { group: "Orçamento e metas", items: [
    { title: "Definir um orçamento por categoria", steps: [
      "Em Finanças → Lançamentos, clique em \"+ definir orçamento por categoria\" (ou \"+ categoria\" no bloco Orçamento do mês).",
      "Escolha a categoria e o limite por mês (ex.: Alimentação R$ 600) e salve.",
      "A barra mostra quanto já foi e quanto sobra. Para mudar ou remover, clique em \"alterar\" (0 remove).",
    ], tips: ["O orçamento conta o que saiu da conta e também as compras no cartão feitas no mês. A Visão geral avisa aos 80% e quando passar."] },
    { title: "Criar uma meta de economia", steps: [
      "Em Finanças → Investimentos, no bloco Metas, clique em \"+ nova meta\".",
      "Dê um nome, diga quanto quer juntar e, se quiser, até quando.",
      "Em \"Onde está o dinheiro\", escolha um cofrinho ou investimento para o progresso andar sozinho, ou informe o valor à mão.",
    ], tips: ["Com prazo, o site mostra quanto guardar por mês para chegar lá."] },
  ] },
  { group: "Cartões e empréstimos", items: [
    { title: "Lançar uma compra no cartão", steps: [
      "Em Cartões e empréstimos → Cartões, clique em \"Compra no cartão\".",
      "Preencha data, descrição, valor total e o número de parcelas.",
      "Para assinatura (cobra todo mês até cancelar), marque \"Assinatura\" em vez de parcelas.",
    ], tips: ["O quadro \"Melhor dia para comprar\" mostra o dia em que a compra já cai na fatura seguinte."] },
    { title: "Pagar a fatura", steps: [
      "Abra a fatura do cartão e clique em \"Pagar fatura\".",
      "Informe o valor, a data e a conta. Se o pagamento já está no extrato importado, escolha \"não lançar saída\".",
    ] },
    { title: "Cadastrar e pagar um empréstimo", steps: [
      "Em Empréstimos, clique em \"+ novo empréstimo\" e informe parcela, quantidade, primeiro mês e dia.",
      "Abra o empréstimo para ver as parcelas. Use \"pagar\" na parcela ou \"Adiantar parcelas\".",
    ] },
  ] },
  { group: "A receber", items: [
    { title: "Alguém me deve em parcelas", steps: [
      "Em Cartões e empréstimos → A receber, clique em \"+ novo a receber\".",
      "Escolha \"Emprestei dinheiro\" ou \"Vendi / prestei serviço\" e informe as parcelas.",
      "Quando a pessoa pagar, o Pix com o nome dela é reconhecido sozinho; ou clique em \"recebi\".",
    ] },
    { title: "Conta com uma pessoa (saldo que sobe e desce)", steps: [
      "Em \"+ novo a receber\", escolha \"Conta com a pessoa\" e informe quanto ela deve hoje.",
      "Pagou algo por ela? Mude a categoria do lançamento para \"Emprestei dinheiro\" e escolha a pessoa.",
      "Ela pagou uma conta sua (ex.: condomínio)? Use \"Ela pagou uma conta minha\": conta como seu gasto, sem sair da sua conta.",
    ] },
  ] },
  { group: "Investimentos e bens", items: [
    { title: "Cadastrar investimentos", steps: [
      "Em Investimentos, clique em \"+ novo investimento\".",
      "Escolha o tipo: cofrinho (saldo + % do CDI), Tesouro, ação/FII/ETF (código + quantidade) ou outro.",
      "Clique em \"Atualizar cotações\" para trazer preços e proventos.",
      "Cofrinho com duas taxas (ex.: PicPay 120% numa parte e 102% no resto)? Marque \"Uma parte do saldo rende outra taxa\" e informe o valor e o % dessa parte.",
    ], tips: ["Se o app do banco mostra o valor já sem IR, o site (que calcula o bruto) fica um pouco acima: atualize o saldo de vez em quando.", "Aplicações e resgates do extrato (categoria Investimento) ligados a um cofrinho somam e descontam o saldo dele sozinhos."] },
    { title: "Comparar seus investimentos com o CDI", steps: [
      "Em Investimentos, clique em \"alterar\" no Tesouro ou na ação.",
      "Informe o preço médio e a data da compra e salve.",
      "O bloco \"Comparação com o CDI\" mostra quanto rendeu (com proventos) e quanto o mesmo dinheiro teria rendido a 100% do CDI.",
    ], tips: ["Comprou em várias datas? Use a data da primeira compra: a comparação fica aproximada. Menos de 3 meses diz pouco."] },
    { title: "Cadastrar bens (imóvel, veículo)", steps: [
      "Em Investimentos → Bens, clique em \"+ novo bem\".",
      "Informe o valor estimado e, se quiser, quanto valoriza ou deprecia por ano.",
    ] },
  ] },
  { group: "Visão geral e avisos", items: [
    { title: "Ler a Visão geral", steps: [
      "Patrimônio: tudo o que você tem, mais o que te devem, menos as dívidas.",
      "\"O que fazer hoje\": no máximo 5 avisos, os mais urgentes primeiro (saldo que não cobre o que vence, fatura vencendo, limite do cartão...).",
      "Use \"dispensar\" para esconder um aviso até o mês seguinte.",
    ] },
  ] },
  { group: "Cripto", items: [
    { title: "Acompanhar a carteira cripto", steps: [
      "Em Cripto, clique na engrenagem e cole o endereço público da carteira (Rabby, Phantom...).",
      "Clique em \"Atualizar\" para ler os saldos.",
      "Em Carteira → Meus tokens, informe o preço médio para ver lucro e prejuízo.",
    ], tips: ["É só leitura: o site nunca pede frase secreta nem chave privada, e não movimenta nada."] },
    { title: "Robô: estudo da regra", steps: [
      "Em Cripto → Robô, cada moeda aparece em relação à regra (SMA 150 + HMA 100), com o comportamento da regra no passado.",
      "É estudo educacional: não é recomendação de compra ou venda.",
    ] },
    { title: "Robô e tokens, Operações manuais", owner: true, steps: [
      "Robô e tokens: os sinais do robô, o \"Real x estratégia\" (seu resultado comparado com seguir a regra à risca) e as fichas dos tokens (valor de mercado, oferta, receita e situação pela regra 55/20).",
      "Operações manuais: registre compras e vendas feitas fora das carteiras; elas entram no \"Real x estratégia\".",
    ] },
  ] },
  { group: "Sua conta", items: [
    { title: "Pedir ajuda (modo suporte) e privacidade", steps: [
      "Em \"Minha conta\", clique em \"Permitir suporte por 24 horas\" para o SeuBitico ver seus dados, sem poder alterar.",
      "Você pode clicar em \"Encerrar agora\" quando quiser; depois de 24 horas o acesso fecha sozinho.",
      "\"Apagar meus dados\" remove tudo o que você lançou no site.",
    ] },
    { title: "Liberar membros e dar suporte", owner: true, steps: [
      "Em \"Membros\", digite o e-mail Google do membro e clique em \"Liberar acesso\".",
      "Quando o membro permitir o suporte, aparece \"Ver conta (suporte)\" ao lado do e-mail dele: abre a conta em modo leitura.",
      "Clique em \"Sair do suporte\" para voltar à sua conta.",
    ] },
  ] },
];

export default function Manual({ member }: { member: boolean }) {
  const groups = TOPICS.map((g) => ({ ...g, items: g.items.filter((t) => !t.owner || !member) })).filter((g) => g.items.length);
  return (
    <>
      <section className="card manual-start">
        <h2>Comece por aqui</h2>
        <p className="muted small">A ordem que deixa tudo certo mais rápido. Leva uns 20 minutos na primeira vez.</p>
        <ol className="manual-steps">{START.map((s) => <li key={s}>{s}</li>)}</ol>
      </section>
      {groups.map((g) => (
        <section className="card" key={g.group}>
          <h2>{g.group}</h2>
          {g.items.map((t) => (
            <details className="manual-topic" key={t.title}>
              <summary>{t.title}</summary>
              <ol className="manual-steps">{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              {t.tips?.map((x) => <p className="muted small manual-tip" key={x}>Dica: {x}</p>)}
            </details>
          ))}
        </section>
      ))}
      <p className="muted small">Ferramenta educacional de organização: nada aqui é recomendação de investimento.</p>
    </>
  );
}
