/**
 * E-MAIL TRANSACIONAL NO TEMA (F3.12 · ref. 02 §7.8).
 *
 * Manual da marca "Clareza em movimento": logo PNG transparente sobre faixa
 * clara, corpo claro, UM botão azul e a assinatura institucional
 * "B2C Finance · Um produto B2C Gestão".
 *
 * Módulo PURO: monta a string HTML e nada mais. Não envia, não consulta banco
 * e não sabe quem é o destinatário — a entrega é do Outbox (03 §4.2), que é
 * quem sabe reagendar quando o provedor cai.
 *
 * TRÊS RESTRIÇÕES QUE VÊM DO MEIO, NÃO DO GOSTO, e por isso este arquivo não
 * se parece com o resto da interface:
 *
 *  1. TUDO EM ESTILO INLINE. Gmail, Outlook e a maioria dos clientes removem
 *     ou ignoram <style> e classes. Um token CSS aqui viraria texto preto em
 *     fundo branco no cliente de e-mail de quem mais precisa ler.
 *  2. TABELAS PARA LAYOUT. Outlook no Windows renderiza com o motor do Word:
 *     flex e grid simplesmente não existem.
 *  3. CORES LITERAIS. É o segundo arquivo do produto que NÃO segue o tema do
 *     usuário — o primeiro é o tema documento do PDF. O e-mail é lido fora do
 *     sistema, num cliente que tem o próprio tema; ele carrega a identidade
 *     da marca, não a preferência de aparência de quem enviou. Os HEX aqui
 *     são os mesmos de docs/branding/b2c-finance/colors.json.
 *
 * SEM IMAGEM DECORATIVA, e há um motivo prático além do estético: a maioria
 * dos clientes bloqueia imagem por padrão, e um e-mail cuja identidade
 * depende de imagem chega quebrado na primeira leitura — que é a única que
 * importa numa cobrança. A ÚNICA imagem permitida é a logo PNG do manual de
 * marca, e mesmo ela é opcional: sem domínio absoluto configurado o
 * cabeçalho cai no wordmark em texto, e com a imagem bloqueada o
 * alt="B2C Finance" ocupa o mesmo lugar. Nenhuma informação depende dela.
 */

const TINTA = "#142B45";        /* azul profundo */
const TINTA_SUAVE = "#60738B";
const PAPEL = "#ffffff";
const FUNDO = "#F5F8FC";
const BORDA = "#DCE6F2";
const CABECALHO = "#E9F1FC";    /* faixa clara — o manual pede fundo claro */
const ACENTO = "#216FD3";       /* azul institucional */
const ASSINATURA = "B2C Finance · Um produto B2C Gestão";
/* Pilha nativa do manual de marca. Vai INLINE em cada bloco de texto: o
   Outlook ignora font-family herdada de <body> e cai em Times New Roman —
   um e-mail de cobrança em serifa não parece do mesmo produto. */
const FONTE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

/**
 * Logo da marca em PNG absoluto. E-mail não resolve caminho relativo: sem
 * domínio configurado, devolvemos null e o cabeçalho usa texto.
 */
function urlDaLogo(): string | null {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "")
  ).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return null;
  return `${base}/brand/b2c-finance/logos/b2c-finance-logo-horizontal-light.png`;
}

export type BotaoDoEmail = { rotulo: string; href: string };

export type ConteudoDoEmail = {
  /** Vira o <title> e o título dentro do corpo. */
  titulo: string;
  /** Primeira linha da caixa de entrada, antes de abrir. */
  preheader: string;
  paragrafos: string[];
  /** UM botão, no máximo (§7.8: "um botão de acento"). */
  botao?: BotaoDoEmail;
  /** Linhas de rodapé — quem enviou, como responder, como sair. */
  rodape?: string[];
  /** Bloco de destaque (valor, vencimento) — sem virar um segundo botão. */
  destaque?: { rotulo: string; valor: string }[];
};

/** Escapa o que vem de dado do cliente. Nome com "&" quebra o HTML. */
export function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEmail(c: ConteudoDoEmail): string {
  const paragrafos = c.paragrafos
    .map(
      (p) =>
        `<p style="margin:0 0 14px;${FONTE}font-size:15px;line-height:1.6;color:${TINTA};">${esc(p)}</p>`
    )
    .join("");

  const destaque = c.destaque?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid ${BORDA};border-radius:8px;">
         ${c.destaque
           .map(
             (d, i) => `<tr>
               <td style="padding:10px 14px;${FONTE}font-size:13px;color:${TINTA_SUAVE};${i > 0 ? `border-top:1px solid ${BORDA};` : ""}">${esc(d.rotulo)}</td>
               <td style="padding:10px 14px;${FONTE}font-size:15px;font-weight:600;color:${TINTA};text-align:right;${i > 0 ? `border-top:1px solid ${BORDA};` : ""}">${esc(d.valor)}</td>
             </tr>`
           )
           .join("")}
       </table>`
    : "";

  const botao = c.botao
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;">
         <tr><td style="border-radius:8px;background:${ACENTO};">
           <a href="${esc(c.botao.href)}" style="display:inline-block;padding:11px 22px;${FONTE}font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(c.botao.rotulo)}</a>
         </td></tr>
       </table>`
    : "";

  const rodape =
    (c.rodape ?? [])
      .map(
        (l) =>
          `<p style="margin:0 0 6px;${FONTE}font-size:12px;line-height:1.5;color:${TINTA_SUAVE};">${esc(l)}</p>`
      )
      .join("") +
    `<p style="margin:8px 0 0;${FONTE}font-size:12px;line-height:1.5;color:${TINTA_SUAVE};">${ASSINATURA}</p>`;

  const logo = urlDaLogo();
  const marca = logo
    ? `<img src="${esc(logo)}" alt="B2C Finance" width="160" height="40" style="display:block;border:0;outline:none;text-decoration:none;height:40px;width:160px;">`
    : `<span style="${FONTE}font-size:17px;font-weight:700;letter-spacing:0.01em;color:${TINTA};">B2C</span><span style="${FONTE}font-size:17px;font-weight:400;color:${ACENTO};"> Finance</span>`;

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${FUNDO};${FONTE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${PAPEL};border-radius:12px;overflow:hidden;border:1px solid ${BORDA};">
      <tr><td style="background:${CABECALHO};padding:18px 24px;border-bottom:1px solid ${BORDA};">
        ${marca}
      </td></tr>
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 14px;${FONTE}font-size:19px;line-height:1.35;font-weight:600;color:${TINTA};">${esc(c.titulo)}</h1>
        ${paragrafos}
        ${destaque}
        ${botao}
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid ${BORDA};background:${FUNDO};">${rodape}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
