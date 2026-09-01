import { renderEmail, type ConteudoDoEmail } from "./template";

/**
 * OS E-MAILS QUE O SISTEMA MANDA (F3.12 · ref. 02 §7.8, §4.8).
 *
 * Cada um é uma FUNÇÃO PURA de dados para `{ assunto, html }`. É o que
 * permite abrir a prévia, ler o texto em voz alta e corrigir o tom antes de o
 * primeiro cliente receber — que é a única revisão que importa num e-mail.
 *
 * NENHUM DELES ENVIA. A entrega é do Outbox, canal `email` (03 §4.2): o
 * evento é publicado dentro da transação do fato e entregue depois, com
 * recuo e dead-letter. Enquanto não houver provedor configurado, o conteúdo
 * existe, é testável e é revisável — e é assim que ele deve ficar, porque
 * ligar envio de e-mail antes de alguém ler cinquenta mensagens geradas é
 * como se descobre o tom errado com o cliente.
 *
 * O QUE ESTES TEXTOS NUNCA FAZEM (01 §5.2; 02 §2): usar nome de conceito
 * interno. Nem o cliente nem a equipe recebem "billing", "recognitionMode"
 * ou "snapshot" — e nem mesmo "competência", que é vocabulário de dentro:
 * no e-mail o mês é "o mês". Tem teste varrendo os textos, e ele já pegou um
 * vazamento neste arquivo.
 */

export type EmailPronto = { assunto: string; html: string; preheader: string };

function montar(assunto: string, c: ConteudoDoEmail): EmailPronto {
  return { assunto, html: renderEmail(c), preheader: c.preheader };
}

const RODAPE_PADRAO = [
  "B2C Gestão — este e-mail foi enviado automaticamente pelo sistema financeiro da agência.",
  "Para falar com a gente, é só responder esta mensagem.",
];

// ---------------------------------------------------------------------------

export type DadosDeCobranca = {
  cliente: string;
  descricao: string;
  valor: string;
  vencimento: string;
  diasDeAtraso: number;
  link?: string;
};

/**
 * Cobrança. O TOM MUDA com o atraso, como na régua — e pelo mesmo motivo:
 * cobrar com peso quem esqueceu de pagar ontem queima a relação com a maior
 * parte da carteira.
 */
export function emailDeCobranca(d: DadosDeCobranca): EmailPronto {
  const atrasado = d.diasDeAtraso > 0;
  const primeiro = d.cliente.split(" ")[0];

  const assunto = atrasado
    ? `${d.descricao} — em aberto desde ${d.vencimento}`
    : `${d.descricao} — vence em ${d.vencimento}`;

  return montar(assunto, {
    titulo: atrasado ? "Uma cobrança em aberto" : "Lembrete de vencimento",
    preheader: `${d.valor} · ${atrasado ? `vencida em ${d.vencimento}` : `vence em ${d.vencimento}`}`,
    paragrafos: atrasado
      ? [
          `Oi, ${primeiro}! Tudo bem?`,
          `Passando para lembrar de uma cobrança que continua em aberto por aqui. Se já foi paga nos últimos dias, é só ignorar esta mensagem — e nos avisar, que eu dou baixa.`,
        ]
      : [
          `Oi, ${primeiro}! Tudo bem?`,
          `É só um lembrete: o vencimento está chegando. Nada a fazer se já estiver programado.`,
        ],
    destaque: [
      { rotulo: "Referente a", valor: d.descricao },
      { rotulo: "Valor", valor: d.valor },
      {
        rotulo: atrasado ? `Venceu em (${d.diasDeAtraso} ${d.diasDeAtraso === 1 ? "dia" : "dias"})` : "Vence em",
        valor: d.vencimento,
      },
    ],
    botao: d.link ? { rotulo: "Ver a cobrança", href: d.link } : undefined,
    rodape: RODAPE_PADRAO,
  });
}

// ---------------------------------------------------------------------------

export type DadosDePromessa = {
  cliente: string;
  valor: string;
  dataCombinada: string;
};

/** Confirmação de promessa. Existe para a data combinada ficar por escrito. */
export function emailDeConfirmacaoDePromessa(d: DadosDePromessa): EmailPronto {
  const primeiro = d.cliente.split(" ")[0];
  return montar(`Combinado: pagamento em ${d.dataCombinada}`, {
    titulo: "Combinado registrado",
    preheader: `${d.valor} para ${d.dataCombinada}`,
    paragrafos: [
      `Oi, ${primeiro}! Registrei aqui o que combinamos.`,
      `Até lá não mando mais lembrete. Se precisar mudar a data, é só responder — melhor ajustar do que deixar passar.`,
    ],
    destaque: [
      { rotulo: "Valor", valor: d.valor },
      { rotulo: "Data combinada", valor: d.dataCombinada },
    ],
    rodape: RODAPE_PADRAO,
  });
}

// ---------------------------------------------------------------------------

export type DadosDeConvite = {
  nome: string;
  papel: string;
  convidadoPor: string;
  link: string;
};

/** Convite de usuário — o único e-mail com destino INTERNO. */
export function emailDeConvite(d: DadosDeConvite): EmailPronto {
  return montar("Seu acesso ao B2C Gestão", {
    titulo: "Você foi convidado para o B2C Gestão",
    preheader: `${d.convidadoPor} criou um acesso para você como ${d.papel}.`,
    paragrafos: [
      `Oi, ${d.nome.split(" ")[0]}!`,
      `${d.convidadoPor} criou um acesso para você no sistema da agência, com o perfil ${d.papel}.`,
      `Use o botão abaixo para definir sua senha. O link é pessoal — não repasse.`,
    ],
    botao: { rotulo: "Definir minha senha", href: d.link },
    rodape: [
      "Se você não esperava este convite, ignore esta mensagem: sem definir a senha, o acesso não é ativado.",
      ...RODAPE_PADRAO,
    ],
  });
}

// ---------------------------------------------------------------------------

export type DadosDeFechamento = {
  competencia: string;
  resultado: string;
  quemFechou: string;
  versao: number;
  link?: string;
};

/** Aviso interno de que a competência fechou. */
export function emailDeFechamento(d: DadosDeFechamento): EmailPronto {
  return montar(`${d.competencia} fechado`, {
    titulo: `O mês de ${d.competencia} foi fechado`,
    preheader: `Resultado ${d.resultado} · fechado por ${d.quemFechou}`,
    paragrafos: [
      `A fotografia do mês foi gerada e guardada. A partir de agora, o que aparece nela é o que ${d.competencia} mostrou no fechamento — mesmo que os dados mudem depois.`,
      `Alterar o resultado deste mês exige reabri-lo, com justificativa registrada.`,
    ],
    destaque: [
      { rotulo: "Resultado do mês", valor: d.resultado },
      { rotulo: "Fechado por", valor: d.quemFechou },
      { rotulo: "Versão da fotografia", valor: `v${d.versao}` },
    ],
    botao: d.link ? { rotulo: "Abrir a fotografia", href: d.link } : undefined,
    rodape: RODAPE_PADRAO,
  });
}

/** Catálogo, para a prévia listar tudo sem ninguém manter uma segunda lista. */
export const EMAILS_DE_EXEMPLO: { id: string; nome: string; email: EmailPronto }[] = [
  {
    id: "cobranca-vencida",
    nome: "Cobrança vencida",
    email: emailDeCobranca({
      cliente: "Padaria do Bairro",
      descricao: "Gestão de tráfego — Agosto/2026",
      valor: "R$ 1.850,00",
      vencimento: "10/08/2026",
      diasDeAtraso: 7,
      link: "https://exemplo.b2c/cobrancas",
    }),
  },
  {
    id: "cobranca-a-vencer",
    nome: "Lembrete antes do vencimento",
    email: emailDeCobranca({
      cliente: "Oficina Central",
      descricao: "Gestão de tráfego — Setembro/2026",
      valor: "R$ 2.400,00",
      vencimento: "10/09/2026",
      diasDeAtraso: 0,
    }),
  },
  {
    id: "promessa",
    nome: "Promessa confirmada",
    email: emailDeConfirmacaoDePromessa({
      cliente: "Padaria do Bairro",
      valor: "R$ 1.850,00",
      dataCombinada: "22/08/2026",
    }),
  },
  {
    id: "convite",
    nome: "Convite de usuário",
    email: emailDeConvite({
      nome: "Bianca Souza",
      papel: "Financeiro",
      convidadoPor: "Vitor",
      link: "https://exemplo.b2c/definir-senha?t=exemplo",
    }),
  },
  {
    id: "fechamento",
    nome: "Competência fechada",
    email: emailDeFechamento({
      competencia: "Agosto de 2026",
      resultado: "R$ 12.430,00",
      quemFechou: "Vitor",
      versao: 1,
      link: "https://exemplo.b2c/fechamento/fotografia?mes=2026-08",
    }),
  },
];
