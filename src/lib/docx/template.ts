import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

/**
 * Motor de modelos de contrato DOCX.
 *
 * Extração: o texto de cada parágrafo é remontado juntando os runs
 * (<w:t>) antes de aplicar o regex — o Word costuma fatiar "{{Nome da
 * empresa}}" em vários runs, então regex direto no XML perderia (ou
 * capturaria lixo interno). Cobre corpo, tabelas, cabeçalhos, rodapés
 * e notas.
 *
 * Geração: docxtemplater + pizzip com delimitadores {{ }} e parser de
 * chave exata (aceita espaços, acentos, ç, parênteses). O DOCX é
 * preenchido preservando estilos/formatação; o modelo original nunca
 * é alterado.
 */

export type TemplateVariableType =
  | "text"
  | "date"
  | "number"
  | "money"
  | "email"
  | "phone"
  | "document";

export type TemplateVariable = {
  /** Token exatamente como está no DOCX, ex.: "{{Nome da empresa}}" */
  originalToken: string;
  /** Texto interno original, ex.: "Nome da empresa" */
  rawName: string;
  /** Chave normalizada, ex.: "nome_da_empresa" */
  key: string;
  /** Rótulo amigável para o formulário */
  label: string;
  type: TemplateVariableType;
  required: boolean;
  /** Campo de origem para pré-preenchimento, ex.: "client.name" */
  clientField: string | null;
};

const VARIABLE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
// Secundário (modelos antigos com uma chave) — apenas para alertar.
const LEGACY_SINGLE_RE = /(?<!\{)\{\s*([a-zA-ZÀ-ÿ0-9_][a-zA-ZÀ-ÿ0-9_\s.-]{1,40}?)\s*\}(?!\})/g;

const DOC_PARTS_RE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/** Normaliza para chave interna: minúsculas, sem acento, snake_case. */
export function normalizeVariableKey(rawName: string): string {
  return rawName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

/** snake_case → "Texto legível" (para labels de variáveis normalizadas). */
export function humanizeKey(raw: string): string {
  const txt = raw.replace(/_/g, " ").trim();
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/** Mapeamento inicial chave normalizada → campo do cliente/contrato. */
const CLIENT_FIELD_MAP: Record<string, string> = {
  // Cliente
  nome_da_empresa: "client.name",
  nome_do_cliente: "client.name",
  nome_cliente: "client.name",
  empresa: "client.name",
  contratante: "client.name",
  nome_fantasia: "client.name",
  razao_social: "client.legalName",
  razao_social_da_empresa: "client.legalName",
  cnpj: "client.document",
  cnpj_da_empresa: "client.document",
  cnpj_do_contratante: "client.document",
  cpf: "client.document",
  cpf_cnpj: "client.document",
  documento: "client.document",
  email: "client.email",
  e_mail: "client.email",
  email_da_empresa: "client.email",
  telefone: "client.phone",
  celular: "client.phone",
  whatsapp: "client.phone",
  cidade: "client.city",
  estado: "client.state",
  uf: "client.state",
  segmento: "client.segment",
  endereco: "client.address",
  endereco_da_empresa: "client.address",
  endereco_do_contratante: "client.address",
  endereco_completo: "client.address",
  representante_legal: "client.legalRepresentative",
  nome_do_representante_legal: "client.legalRepresentative",
  nome_do_representante_legal_da_empresa: "client.legalRepresentative",
  nome_do_representante_legal_da_empresa_dono: "client.legalRepresentative",
  nome_do_responsavel: "client.legalRepresentative",
  // Contrato
  data_de_inicio: "contract.startDate",
  data_inicio: "contract.startDate",
  inicio_do_contrato: "contract.startDate",
  data_de_assinatura: "contract.startDate",
  dia_de_vencimento: "contract.dueDay",
  dia_do_vencimento: "contract.dueDay",
  dia_vencimento: "contract.dueDay",
  vencimento: "contract.dueDay",
  valor_mensal: "contract.monthlyAmount",
  mensalidade: "contract.monthlyAmount",
  valor_total: "contract.totalAmount",
  valor_do_contrato: "contract.totalAmount",
  valor_total_do_contrato: "contract.totalAmount",
  prazo: "contract.durationMonths",
  prazo_em_meses: "contract.durationMonths",
  duracao_em_meses: "contract.durationMonths",
};

function inferType(key: string): TemplateVariableType {
  if (/(^|_)data(_|$)|^data_/.test(key) || key.startsWith("data")) return "date";
  if (/valor|preco|mensalidade|honorario/.test(key)) return "money";
  if (/^dia(_|$)|(^|_)dia_de|vencimento$/.test(key) || /^\d+$/.test(key)) return "number";
  if (/email|e_mail/.test(key)) return "email";
  if (/telefone|celular|whatsapp/.test(key)) return "phone";
  if (/cnpj|cpf|documento/.test(key)) return "document";
  if (/prazo|meses|quantidade|numero/.test(key)) return "number";
  return "text";
}

/** Variável pouco descritiva? (numérica ou curta demais) */
export function isUnclearVariable(rawName: string): boolean {
  const trimmed = rawName.trim();
  return /^\d+$/.test(trimmed) || normalizeVariableKey(trimmed).length < 3;
}

function buildVariable(originalToken: string, rawName: string): TemplateVariable {
  const key = normalizeVariableKey(rawName);
  // Caso especial dos modelos antigos: {{15}} é o dia de vencimento.
  if (/^\d{1,2}$/.test(rawName.trim())) {
    return {
      originalToken,
      rawName,
      key,
      label: "Dia de vencimento",
      type: "number",
      required: true,
      clientField: "contract.dueDay",
    };
  }
  return {
    originalToken,
    rawName,
    key,
    label: humanizeKey(rawName.includes("_") ? key : rawName),
    type: inferType(key),
    required: true,
    clientField: CLIENT_FIELD_MAP[key] ?? null,
  };
}

/** Extrai o texto visível de um XML do Word, parágrafo a parágrafo. */
function paragraphTexts(xml: string): string[] {
  return xml.split("</w:p>").map((seg) =>
    (seg.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .map((t) => t.replace(/<[^>]+>/g, ""))
      .join("")
  );
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

export type ExtractionResult = {
  variables: TemplateVariable[];
  warnings: string[];
};

/** Lê o DOCX e identifica as variáveis {{ }} (corpo, tabelas, cabeçalho, rodapé). */
export function extractTemplateVariables(buffer: Buffer): ExtractionResult {
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw new Error("Arquivo inválido — envie um .docx (Word) válido.");
  }
  if (!zip.file("word/document.xml")) {
    throw new Error("O arquivo não parece ser um DOCX — envie um modelo do Word (.docx).");
  }

  const seen = new Map<string, TemplateVariable>();
  const legacySeen = new Set<string>();

  for (const name of Object.keys(zip.files)) {
    if (!DOC_PARTS_RE.test(name)) continue;
    const xml = zip.file(name)!.asText();
    for (const para of paragraphTexts(xml)) {
      const text = decodeXmlEntities(para);
      for (const m of text.matchAll(VARIABLE_RE)) {
        const rawName = m[1].trim();
        if (!rawName || seen.has(rawName)) continue;
        seen.set(rawName, buildVariable(`{{${rawName}}}`, rawName));
      }
      // Sem as duplas, procura possíveis variáveis antigas de uma chave (só alerta).
      const single = text.replace(VARIABLE_RE, "");
      for (const m of single.matchAll(LEGACY_SINGLE_RE)) {
        legacySeen.add(m[1].trim());
      }
    }
  }

  const variables = Array.from(seen.values());
  const warnings: string[] = [];
  for (const v of variables) {
    if (isUnclearVariable(v.rawName)) {
      warnings.push(
        `A variável "${v.originalToken}" foi identificada, mas seu nome não é descritivo. ` +
          `Recomendamos mapear esse campo como "${v.label}" ou ajustar o modelo para "{{${v.label}}}".`
      );
    }
  }
  for (const raw of legacySeen) {
    warnings.push(
      `Encontramos "{${raw}}" com uma chave só — o padrão oficial é com chaves duplas. ` +
        `Se for uma variável, ajuste o modelo para "{{${raw}}}".`
    );
  }

  return { variables, warnings };
}

/**
 * Gera um novo DOCX preenchendo as variáveis, sem tocar no modelo
 * original. `values` é indexado pelo rawName exato da variável.
 */
export function fillTemplate(buffer: Buffer, values: Record<string, string>): Buffer {
  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    // Chave exata: aceita espaço, acento, ç, parênteses — sem split por ".".
    parser: (tag: string) => ({
      get: (scope: Record<string, unknown>) => scope?.[tag.trim()] ?? "",
    }),
    nullGetter: () => "",
  });
  doc.render(values);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
