import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { abrirVidaDoCliente, agenciaPadrao } from "@/lib/services/client-lifecycle";
import { termAt, openTerm } from "@/lib/services/commercial-term";
import { assignManager } from "@/lib/services/client-managers";
import { settleBilling } from "@/lib/engines/payment-engine";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import { parseCompetence, toCompetence, type Competence } from "@/lib/competence";
import { toNumber as n } from "@/lib/format";
import {
  normalizarNomeCliente,
  type LinhaCliente, type LinhaMensal, type LinhaRenovacao, type PlanilhaTotal,
} from "./parser";

/**
 * MOTOR DA IMPORTAÇÃO TOTAL (F1.12 v2 · seção IMPORTAÇÃO TOTAL do plano).
 *
 * Aplica a planilha POR COMPETÊNCIA, reusando os serviços de domínio que o
 * produto já usa (nascimento de cliente, termos por vigência, motor de
 * pagamento) — o histórico importado passa pelo MESMO caminho do dado vivo,
 * então as métricas não têm como divergir por origem.
 *
 * Idempotência: a chave natural é (documento) para clientes e
 * (cliente + competência) para o mês. Reimportar atualiza o que está aberto
 * e NUNCA reescreve dinheiro pago — divergência em cobrança quitada vira
 * item de revisão, porque reescrever pagamento em silêncio é o proibido
 * número um deste sistema.
 *
 * Reversão: cada escrita vira um ImportedRecord com `operation` CRIOU ou
 * ATUALIZOU. O lote desfaz TUDO o que criou (na ordem inversa de
 * dependência) e lista o que atualizou — atualização não tem imagem
 * anterior, e prometer reversão dela seria mentira.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ResultadoAplicacao = {
  batchId: string;
  clientesCriados: number;
  clientesAtualizados: number;
  cobrancasCriadas: number;
  pagamentosCriados: number;
  avaliacoesGravadas: number;
  termosAbertos: number;
  paraRevisar: number;
  avisos: string[];
  /** Competências tocadas pela MENSAL — insumo do F1.14 (snapshots). */
  competencias: Competence[];
};

type Indice = {
  porDocumento: Map<string, string>;
  porNome: Map<string, string>;
  nomes: { id: string; nome: string }[];
  agencias: Map<string, string>;
  usuarios: Map<string, string>;
  servicos: Map<string, string>;
  fechadas: Set<string>;
};

type Registro = {
  entity: string;
  entityId: string | null;
  sheet: string;
  row: number;
  operation: "CRIOU" | "ATUALIZOU";
  raw: unknown;
  confianca?: number;
  revisao?: string | null;
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/** Distância de edição (cap 3) — só para ACUSAR nome parecido, nunca para decidir. */
export function distanciaDeEdicao(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = prev[0];
    prev[0] = i;
    let menor = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      anterior = temp;
      if (prev[j] < menor) menor = prev[j];
    }
    if (menor > cap) return cap + 1;
  }
  return prev[b.length];
}

function nomeParecido(nome: string, indice: Indice): string | null {
  for (const c of indice.nomes) {
    if (c.nome === nome) continue;
    if (distanciaDeEdicao(nome, c.nome, 2) <= 2) return c.nome;
  }
  return null;
}

function primeiroDia(comp: Competence): Date {
  const p = parseCompetence(comp)!;
  return new Date(p.year, p.month - 1, 1);
}

/**
 * status_atual da planilha → status do CLIENTE. "Onboarding" vira ACTIVE no
 * cliente de propósito: onboarding é estado do ciclo da RELAÇÃO (e é lá que
 * ele é gravado); o enum do cliente nem tem esse valor.
 */
const STATUS_CLIENTE = {
  Ativo: "ACTIVE", Pausado: "PAUSED", Churn: "CHURNED", Onboarding: "ACTIVE",
} as const;

const UPSELL_MAPA: Record<string, string> = { sim: "Mapeado", "não": "Sem oportunidade" };

// ---------------------------------------------------------------------------
// Índice inicial
// ---------------------------------------------------------------------------

async function montarIndice(): Promise<Indice> {
  const [clientes, agencias, usuarios, servicos, fechados] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true, document: true } }),
    runWithoutScope(async () =>
      prisma.agency.findMany({ where: { active: true }, select: { id: true, name: true } })
    ),
    runWithoutScope(async () =>
      prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } })
    ),
    prisma.service.findMany({ select: { id: true, name: true } }),
    runWithoutScope(async () =>
      prisma.closingPeriod.findMany({ where: { state: "CLOSED" }, select: { competence: true } })
    ),
  ]);
  const porDocumento = new Map<string, string>();
  const porNome = new Map<string, string>();
  const nomes: { id: string; nome: string }[] = [];
  for (const c of clientes) {
    const doc = String(c.document ?? "").replace(/\D/g, "");
    if (doc.length >= 11) porDocumento.set(doc, c.id);
    const nome = normalizarNomeCliente(c.name);
    porNome.set(nome, c.id);
    nomes.push({ id: c.id, nome });
  }
  return {
    porDocumento,
    porNome,
    nomes,
    agencias: new Map(agencias.map((a) => [normalizarNomeCliente(a.name), a.id])),
    usuarios: new Map(usuarios.map((u) => [normalizarNomeCliente(u.name), u.id])),
    servicos: new Map(servicos.map((s) => [normalizarNomeCliente(s.name), s.id])),
    fechadas: new Set(fechados.map((f) => f.competence)),
  };
}

function resolverCliente(ref: string, ehDocumento: boolean, indice: Indice): string | null {
  if (ehDocumento) return indice.porDocumento.get(ref) ?? null;
  return indice.porNome.get(normalizarNomeCliente(ref)) ?? null;
}

// ---------------------------------------------------------------------------
// Prévia (somente leitura)
// ---------------------------------------------------------------------------

export type RevisaoPrevista = { aba: string; linha: number; motivo: string };

/**
 * O que a fila de revisão vai receber SE a planilha for confirmada como
 * está — dedupes, gestores/serviços/agências não casados, clientes da
 * MENSAL desconhecidos e competências fechadas. Nada é gravado.
 */
export async function preverRevisoes(plan: PlanilhaTotal): Promise<RevisaoPrevista[]> {
  const indice = await montarIndice();
  const out: RevisaoPrevista[] = [];
  const conhecidos = new Set<string>();

  for (const c of plan.clientes) {
    const nomeNorm = normalizarNomeCliente(c.nome);
    conhecidos.add(nomeNorm);
    if (c.documento) conhecidos.add(c.documento);
    const existe =
      (c.documento && indice.porDocumento.has(c.documento)) || indice.porNome.has(nomeNorm);
    if (!existe && !c.documento) {
      const parecido = nomeParecido(nomeNorm, indice);
      if (parecido)
        out.push({
          aba: "CLIENTES", linha: c.sourceRow,
          motivo: `nome parecido com cliente existente ("${parecido}") e sem documento — vai para revisão humana`,
        });
    }
    if (c.agencia && !indice.agencias.has(normalizarNomeCliente(c.agencia)))
      out.push({ aba: "CLIENTES", linha: c.sourceRow, motivo: `agência "${c.agencia}" não encontrada — cairá na agência padrão` });
    for (const g of [c.gestor1, c.gestor2])
      if (g && !indice.usuarios.has(normalizarNomeCliente(g)))
        out.push({ aba: "CLIENTES", linha: c.sourceRow, motivo: `gestor "${g}" não casa com nenhum usuário` });
    for (const svc of c.servicos)
      if (!indice.servicos.has(normalizarNomeCliente(svc)))
        out.push({ aba: "CLIENTES", linha: c.sourceRow, motivo: `serviço "${svc}" será criado INATIVO para conferência` });
  }

  for (const l of plan.mensal) {
    const conhecido = l.clienteRefEhDocumento
      ? conhecidos.has(l.clienteRef) || indice.porDocumento.has(l.clienteRef)
      : conhecidos.has(normalizarNomeCliente(l.clienteRef)) || indice.porNome.has(normalizarNomeCliente(l.clienteRef));
    if (!conhecido)
      out.push({ aba: l.sourceSheet, linha: l.sourceRow, motivo: `cliente "${l.clienteRef}" não existe nem na aba CLIENTES nem no sistema` });
    if (indice.fechadas.has(l.competencia))
      out.push({ aba: l.sourceSheet, linha: l.sourceRow, motivo: `competência ${l.competencia} está FECHADA — exige reabertura antes de importar` });
    if (l.gestor1DoMes && !indice.usuarios.has(normalizarNomeCliente(l.gestor1DoMes)))
      out.push({ aba: l.sourceSheet, linha: l.sourceRow, motivo: `gestor do mês "${l.gestor1DoMes}" não casa com nenhum usuário` });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

export async function aplicarPlanilhaTotal(
  plan: PlanilhaTotal,
  opts: { fileName: string; byEmail?: string | null }
): Promise<ResultadoAplicacao> {
  const indice = await montarIndice();
  const avisos: string[] = [...plan.avisos];
  const r: ResultadoAplicacao = {
    batchId: "",
    clientesCriados: 0, clientesAtualizados: 0,
    cobrancasCriadas: 0, pagamentosCriados: 0,
    avaliacoesGravadas: 0, termosAbertos: 0,
    paraRevisar: 0, avisos,
    competencias: [],
  };

  const batch = await prisma.importBatch.create({
    data: { source: "xlsx", module: "total", fileName: opts.fileName },
    select: { id: true },
  });
  r.batchId = batch.id;

  const registros: Registro[] = [];
  const registrar = (reg: Registro) => {
    registros.push(reg);
    if (reg.revisao) r.paraRevisar++;
  };

  // Relação por cliente (cache) — a MENSAL e as RENOVACOES precisam dela.
  const relacaoDe = new Map<string, string>();
  async function relacionamento(clientId: string): Promise<string | null> {
    if (relacaoDe.has(clientId)) return relacaoDe.get(clientId)!;
    const rel = await prisma.clientAgencyRelationship.findFirst({
      where: { clientId },
      orderBy: [{ churnedAt: { sort: "asc", nulls: "first" } }, { startedAt: "asc" }],
      select: { id: true },
    });
    if (rel) { relacaoDe.set(clientId, rel.id); return rel.id; }
    const nascimento = await abrirVidaDoCliente(clientId, {});
    if (nascimento.relationshipId) relacaoDe.set(clientId, nascimento.relationshipId);
    return nascimento.relationshipId;
  }

  // ---------------- 1) CLIENTES ----------------
  for (const linha of plan.clientes) {
    const nomeNorm = normalizarNomeCliente(linha.nome);
    let clientId =
      (linha.documento ? indice.porDocumento.get(linha.documento) : null) ??
      indice.porNome.get(nomeNorm) ??
      null;

    let operation: "CRIOU" | "ATUALIZOU" = "ATUALIZOU";
    let revisao: string | null = null;

    if (!clientId) {
      const parecido = nomeParecido(nomeNorm, indice);
      if (parecido && !linha.documento) {
        // Sem documento e com nome parecido no banco: NUNCA decidir em
        // silêncio — a linha vai para revisão humana e nada é criado.
        registrar({
          entity: "cliente", entityId: null, sheet: "CLIENTES", row: linha.sourceRow,
          operation: "CRIOU", raw: linha, confianca: 40,
          revisao: `nome parecido com cliente existente ("${parecido}") e sem documento para desempatar`,
        });
        continue;
      }

      const agenciaId = linha.agencia
        ? indice.agencias.get(normalizarNomeCliente(linha.agencia)) ?? null
        : null;
      if (linha.agencia && !agenciaId)
        revisao = `agência "${linha.agencia}" não encontrada — usada a agência padrão`;

      const criado = await prisma.client.create({
        data: {
          name: linha.nome,
          document: linha.documentoBruto,
          segment: linha.nicho,
          city: linha.cidade,
          state: linha.uf,
          origin: linha.canalOrigem,
          modality: linha.modalidade,
          monthlyValue: linha.modalidade === "MRR" ? linha.valorMensal : null,
          totalContractValue: linha.modalidade === "TCV" ? linha.valorTotal : null,
          contractMonths: linha.prazoMeses,
          paymentDay: linha.diaVencimento,
          startedAt: linha.dataEntrada,
          status: STATUS_CLIENTE[linha.statusAtual] ?? "ACTIVE",
          churnedAt: linha.statusAtual === "Churn" ? linha.dataChurn : null,
          notes: linha.obs,
        },
        select: { id: true },
      });
      clientId = criado.id;
      operation = "CRIOU";
      r.clientesCriados++;

      indice.porNome.set(nomeNorm, clientId);
      if (linha.documento) indice.porDocumento.set(linha.documento, clientId);
      indice.nomes.push({ id: clientId, nome: nomeNorm });

      const nascimento = await abrirVidaDoCliente(clientId, {
        status: linha.statusAtual === "Churn" ? "CHURNED" : null,
        startedAt: linha.dataEntrada,
        modality: linha.modalidade,
        monthlyValue: linha.valorMensal,
        totalContractValue: linha.valorTotal,
        contractMonths: linha.prazoMeses,
        agencyId: agenciaId ?? (await agenciaPadrao()),
      });
      if (nascimento.relationshipId) {
        relacaoDe.set(clientId, nascimento.relationshipId);
        if (nascimento.termoAberto) r.termosAbertos++;
        // Estado do ciclo de vida vindo da planilha.
        const lifecycle =
          linha.statusAtual === "Churn" ? "CHURNED"
          : linha.statusAtual === "Pausado" ? "PAUSED"
          : linha.statusAtual === "Onboarding" ? "ONBOARDING"
          : "ACTIVE";
        await prisma.clientAgencyRelationship.update({
          where: { id: nascimento.relationshipId },
          data: {
            lifecycleStatus: lifecycle,
            pausedAt: linha.statusAtual === "Pausado" ? new Date() : null,
            churnedAt: linha.statusAtual === "Churn" ? linha.dataChurn : null,
          },
        });
      }
      if (nascimento.faltou.length)
        revisao = [revisao, ...nascimento.faltou].filter(Boolean).join("; ");
    } else {
      // Reimportação: atualiza cadastro SEM tocar o que é história.
      await prisma.client.update({
        where: { id: clientId },
        data: {
          segment: linha.nicho ?? undefined,
          city: linha.cidade ?? undefined,
          state: linha.uf ?? undefined,
          origin: linha.canalOrigem ?? undefined,
          paymentDay: linha.diaVencimento ?? undefined,
          document: linha.documentoBruto ?? undefined,
          notes: linha.obs ?? undefined,
        },
      });
      r.clientesAtualizados++;
    }

    // Gestores da vigência inicial.
    const relId = await relacionamento(clientId);
    if (relId) {
      for (const [nomeGestor, role] of [
        [linha.gestor1, "MANAGER_1"], [linha.gestor2, "MANAGER_2"],
      ] as const) {
        if (!nomeGestor) continue;
        const userId = indice.usuarios.get(normalizarNomeCliente(nomeGestor));
        if (!userId) {
          revisao = [revisao, `gestor "${nomeGestor}" não casa com nenhum usuário`]
            .filter(Boolean).join("; ");
          continue;
        }
        const jaTem = await prisma.clientManagerAssignment.findFirst({
          where: { relationshipId: relId, role, validTo: null, managerId: userId },
          select: { id: true },
        });
        if (!jaTem) {
          const a = await assignManager({
            relationshipId: relId, managerId: userId, role,
            validFrom: linha.dataEntrada, reason: "Importação total",
            changedBy: opts.byEmail ?? null,
          });
          registrar({
            entity: "gestor", entityId: a.id, sheet: "CLIENTES", row: linha.sourceRow,
            operation: "CRIOU", raw: { gestor: nomeGestor, role },
          });
        }
      }
    }

    // Serviços do catálogo — inexistente nasce INATIVO e marcado p/ revisão.
    for (const nomeServico of linha.servicos) {
      const key = normalizarNomeCliente(nomeServico);
      if (indice.servicos.has(key)) continue;
      const s = await prisma.service.create({
        data: { name: nomeServico, active: false },
        select: { id: true },
      });
      indice.servicos.set(key, s.id);
      registrar({
        entity: "servico", entityId: s.id, sheet: "CLIENTES", row: linha.sourceRow,
        operation: "CRIOU", raw: { servico: nomeServico },
        revisao: `serviço "${nomeServico}" não existia no catálogo — criado INATIVO para conferência`,
      });
    }

    registrar({
      entity: "cliente", entityId: clientId, sheet: "CLIENTES", row: linha.sourceRow,
      operation, raw: linha, confianca: revisao ? 70 : 100, revisao,
    });
  }

  // ---------------- 2) MENSAL (por competência, em ordem) ----------------
  const mensalOrdenada = [...plan.mensal].sort((a, b) =>
    a.competencia < b.competencia ? -1 : a.competencia > b.competencia ? 1 : 0
  );
  const competencias = new Set<Competence>();
  const ultimaCompetenciaDo = new Map<string, Competence>();

  for (const linha of mensalOrdenada) {
    const clientId = resolverCliente(linha.clienteRef, linha.clienteRefEhDocumento, indice);
    if (!clientId) {
      registrar({
        entity: "mensal", entityId: null, sheet: linha.sourceSheet, row: linha.sourceRow,
        operation: "CRIOU", raw: linha, confianca: 30,
        revisao: `cliente "${linha.clienteRef}" não encontrado (nem na aba CLIENTES, nem no sistema)`,
      });
      continue;
    }
    if (indice.fechadas.has(linha.competencia)) {
      registrar({
        entity: "mensal", entityId: null, sheet: linha.sourceSheet, row: linha.sourceRow,
        operation: "CRIOU", raw: linha, confianca: 30,
        revisao: `competência ${linha.competencia} está FECHADA — reabra o período para importar este mês`,
      });
      continue;
    }
    competencias.add(linha.competencia);
    ultimaCompetenciaDo.set(clientId, linha.competencia);

    const relId = await relacionamento(clientId);
    const inicioDoMes = primeiroDia(linha.competencia);
    const comp = parseCompetence(linha.competencia)!;

    await aplicarLinhaMensal({
      linha, clientId, relId, inicioDoMes, comp,
      indice, registrar, r, byEmail: opts.byEmail ?? null, fileName: opts.fileName,
    });
  }
  r.competencias = [...competencias].sort();

  // ---------------- 3) RENOVACOES ----------------
  for (const linha of plan.renovacoes) {
    const clientId = resolverCliente(linha.clienteRef, linha.clienteRefEhDocumento, indice);
    const relId = clientId ? await relacionamento(clientId) : null;
    if (!clientId || !relId) {
      registrar({
        entity: "renovacao", entityId: null, sheet: "RENOVACOES", row: linha.sourceRow,
        operation: "CRIOU", raw: linha, confianca: 30,
        revisao: `cliente "${linha.clienteRef}" não encontrado`,
      });
      continue;
    }
    const vigente = await termAt(relId, linha.data);
    const modalidade = linha.modalidade ?? (vigente?.modality as "MRR" | "TCV") ?? "MRR";
    const termo = await openTerm({
      relationshipId: relId,
      modality: modalidade,
      monthlyValue: modalidade === "MRR" ? linha.valorMensal ?? n(vigente?.monthlyValue) : null,
      totalContractValue: modalidade === "TCV" ? linha.valorTotal ?? n(vigente?.totalContractValue) : null,
      contractMonths: linha.prazoMeses ?? vigente?.contractMonths ?? null,
      validFrom: linha.data,
      reason: linha.obs ? `Renovação (importação): ${linha.obs}` : "Renovação (importação)",
    });
    r.termosAbertos++;
    registrar({
      entity: "termo", entityId: termo.id, sheet: "RENOVACOES", row: linha.sourceRow,
      operation: "CRIOU",
      raw: { anterior: vigente?.id ?? null, motivo: "renovacao", linha },
    });
  }

  // ---------------- 4) Churn sem data: inferir e AVISAR ----------------
  for (const linha of plan.clientes) {
    if (linha.statusAtual !== "Churn" || linha.dataChurn) continue;
    const clientId = resolverCliente(
      linha.documento ?? linha.nome,
      linha.documento != null,
      indice
    );
    if (!clientId) continue;
    const ultima = ultimaCompetenciaDo.get(clientId);
    if (!ultima) {
      avisos.push(`"${linha.nome}": Churn sem data e sem linha MENSAL — churnedAt ficou vazio.`);
      continue;
    }
    const p = parseCompetence(ultima)!;
    const inferida = new Date(p.year, p.month, 1); // mês SEGUINTE à última linha
    await prisma.client.update({ where: { id: clientId }, data: { churnedAt: inferida } });
    const relId = await relacionamento(clientId);
    if (relId)
      await prisma.clientAgencyRelationship.update({
        where: { id: relId },
        data: { churnedAt: inferida, lifecycleStatus: "CHURNED" },
      });
    avisos.push(
      `"${linha.nome}": Churn sem data — assumido ${toCompetence(inferida.getFullYear(), inferida.getMonth() + 1)} (mês seguinte à última linha MENSAL).`
    );
  }

  // ---------------- 5) Buracos de série: avisar, nunca decidir ----------------
  const mesesPorCliente = new Map<string, Set<string>>();
  for (const l of mensalOrdenada) {
    const id = resolverCliente(l.clienteRef, l.clienteRefEhDocumento, indice);
    if (!id) continue;
    if (!mesesPorCliente.has(id)) mesesPorCliente.set(id, new Set());
    mesesPorCliente.get(id)!.add(l.competencia);
  }
  for (const [clientId, meses] of mesesPorCliente) {
    const lista = [...meses].sort();
    const buracos: string[] = [];
    let p = parseCompetence(lista[0])!;
    for (const compStr of lista.slice(1)) {
      const alvo = parseCompetence(compStr)!;
      let seguinte = p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 };
      while (seguinte.year * 12 + seguinte.month < alvo.year * 12 + alvo.month) {
        buracos.push(toCompetence(seguinte.year, seguinte.month));
        seguinte = seguinte.month === 12 ? { year: seguinte.year + 1, month: 1 } : { year: seguinte.year, month: seguinte.month + 1 };
      }
      p = alvo;
    }
    if (buracos.length) {
      const nome = indice.nomes.find((x) => x.id === clientId)?.nome ?? clientId;
      avisos.push(
        `"${nome}": sem linha MENSAL em ${buracos.join(", ")} — possível pausa; nada foi decidido automaticamente.`
      );
    }
  }

  // ---------------- 6) Proveniência ----------------
  if (registros.length) {
    await prisma.importedRecord.createMany({
      data: registros.map((reg) => ({
        batchId: batch.id,
        entity: reg.entity,
        entityId: reg.entityId,
        sourceRow: reg.row,
        sourceSheet: reg.sheet,
        operation: reg.operation,
        confidence: reg.confianca ?? 100,
        raw: JSON.parse(JSON.stringify(reg.raw ?? {})),
        reviewStatus: reg.revisao ? "PENDENTE" : "OK",
        reviewReason: reg.revisao ?? null,
      })),
    });
  }
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      total: plan.clientes.length + plan.mensal.length + plan.renovacoes.length,
      imported: r.clientesCriados + r.cobrancasCriadas + r.pagamentosCriados + r.avaliacoesGravadas,
      errors: r.paraRevisar,
    },
  });

  return r;
}

// ---------------------------------------------------------------------------
// Uma linha MENSAL
// ---------------------------------------------------------------------------

async function aplicarLinhaMensal(ctx: {
  linha: LinhaMensal;
  clientId: string;
  relId: string | null;
  inicioDoMes: Date;
  comp: { year: number; month: number };
  indice: Indice;
  registrar: (reg: Registro) => void;
  r: ResultadoAplicacao;
  byEmail: string | null;
  fileName: string;
}) {
  const { linha, clientId, relId, inicioDoMes, comp, indice, registrar, r, byEmail } = ctx;
  const proveniencia = `Importação total — aba ${linha.sourceSheet}, linha ${linha.sourceRow}`;

  // ----- Termo vigente e inferência de mudança de valor (só MRR) -----
  // O termo "do mês" é o vigente no dia 1 OU o que nasce DENTRO do mês (o
  // cliente que entrou dia 10 tem o termo inicial valendo para o mês de
  // entrada; sem isso, o motor abriria um termo duplicado no dia 1).
  const fimDoMes = new Date(comp.year, comp.month, 0, 23, 59, 59, 999);
  let termo = relId
    ? (await termAt(relId, inicioDoMes)) ?? (await termAt(relId, fimDoMes))
    : null;
  if (relId && linha.valorCobrado != null && linha.valorCobrado > 0) {
    const vigenteMRR = termo?.modality === "MRR" ? n(termo.monthlyValue) : null;
    if (
      termo && termo.modality === "MRR" && vigenteMRR !== linha.valorCobrado &&
      termo.validFrom > inicioDoMes
    ) {
      // O termo nasceu NESTE mês (entrada do cliente) e a MENSAL já o
      // contradiz: corrige o valor do próprio termo inicial — abrir outro
      // criaria vigência invertida.
      await prisma.commercialTerm.update({
        where: { id: termo.id },
        data: { monthlyValue: linha.valorCobrado },
      });
      termo = { ...termo, monthlyValue: linha.valorCobrado as any };
      registrar({
        entity: "termo", entityId: termo.id, sheet: linha.sourceSheet, row: linha.sourceRow,
        operation: "ATUALIZOU",
        raw: { motivo: "valor-do-mes-de-entrada", competencia: linha.competencia },
      });
    } else if (termo && termo.modality === "MRR" && vigenteMRR !== linha.valorCobrado) {
      const anterior = termo.id;
      termo = await openTerm({
        relationshipId: relId,
        modality: "MRR",
        monthlyValue: linha.valorCobrado,
        validFrom: inicioDoMes,
        reason: `Importação: valor mudou na planilha em ${linha.competencia}`,
      });
      r.termosAbertos++;
      registrar({
        entity: "termo", entityId: termo.id, sheet: linha.sourceSheet, row: linha.sourceRow,
        operation: "CRIOU", raw: { anterior, motivo: "mudanca-de-valor", competencia: linha.competencia },
      });
    } else if (!termo) {
      termo = await openTerm({
        relationshipId: relId,
        modality: "MRR",
        monthlyValue: linha.valorCobrado,
        validFrom: inicioDoMes,
        reason: `Importação: primeiro valor conhecido (${linha.competencia})`,
      });
      r.termosAbertos++;
      registrar({
        entity: "termo", entityId: termo.id, sheet: linha.sourceSheet, row: linha.sourceRow,
        operation: "CRIOU", raw: { anterior: null, motivo: "primeiro-valor", competencia: linha.competencia },
      });
    }
  }

  // ----- Avaliação do mês (mesmo sem cobrança: avaliação é fato próprio) -----
  if (relId && (linha.estabilidade || linha.ads || linha.risco || linha.upsell || linha.obsDoMes)) {
    const gestores = await prisma.clientManagerAssignment.findMany({
      where: { relationshipId: relId, validTo: null },
      select: { manager: { select: { name: true } } },
    });
    const existia = await prisma.avaliacaoMensal.findUnique({
      where: { relationshipId_competence: { relationshipId: relId, competence: linha.competencia } },
      select: { id: true },
    });
    const av = await prisma.avaliacaoMensal.upsert({
      where: { relationshipId_competence: { relationshipId: relId, competence: linha.competencia } },
      create: {
        relationshipId: relId,
        competence: linha.competencia,
        estabilidade: linha.estabilidade,
        ads: linha.ads,
        risco: linha.risco,
        upsell: linha.upsell ? UPSELL_MAPA[linha.upsell] : null,
        observacao: linha.obsDoMes,
        gestores: gestores.map((g) => g.manager.name),
        confirmedAt: new Date(),
        confirmedBy: byEmail,
      },
      update: {
        estabilidade: linha.estabilidade ?? undefined,
        ads: linha.ads ?? undefined,
        risco: linha.risco ?? undefined,
        upsell: linha.upsell ? UPSELL_MAPA[linha.upsell] : undefined,
        observacao: linha.obsDoMes ?? undefined,
      },
      select: { id: true },
    });
    r.avaliacoesGravadas++;
    registrar({
      entity: "avaliacao", entityId: av.id, sheet: linha.sourceSheet, row: linha.sourceRow,
      operation: existia ? "ATUALIZOU" : "CRIOU",
      raw: { competencia: linha.competencia },
    });
  }

  // ----- Gestor do mês (troca abre vigência nova) -----
  if (relId && linha.gestor1DoMes) {
    const userId = indice.usuarios.get(normalizarNomeCliente(linha.gestor1DoMes));
    if (!userId) {
      registrar({
        entity: "gestor", entityId: null, sheet: linha.sourceSheet, row: linha.sourceRow,
        operation: "CRIOU", raw: { gestor: linha.gestor1DoMes }, confianca: 50,
        revisao: `gestor do mês "${linha.gestor1DoMes}" não casa com nenhum usuário`,
      });
    } else {
      const atual = await prisma.clientManagerAssignment.findFirst({
        where: { relationshipId: relId, role: "MANAGER_1", validTo: null },
        select: { managerId: true },
      });
      if (atual?.managerId !== userId) {
        const a = await assignManager({
          relationshipId: relId, managerId: userId, role: "MANAGER_1",
          validFrom: inicioDoMes, reason: `Importação: troca de gestor em ${linha.competencia}`,
          changedBy: byEmail,
        });
        registrar({
          entity: "gestor", entityId: a.id, sheet: linha.sourceSheet, row: linha.sourceRow,
          operation: "CRIOU", raw: { gestor: linha.gestor1DoMes, competencia: linha.competencia },
        });
      }
    }
  }

  // ----- Sem cobrança: nenhum Billing, com o motivo guardado -----
  if (linha.status.tipo === "SEM_COBRANCA") {
    registrar({
      entity: "mensal", entityId: null, sheet: linha.sourceSheet, row: linha.sourceRow,
      operation: "CRIOU",
      raw: { competencia: linha.competencia, semCobranca: true, motivo: linha.obsDoMes ?? "(sem motivo na planilha)" },
    });
    return;
  }

  // ----- Cobrança da competência -----
  const cliente = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { name: true, paymentDay: true, modality: true, totalContractValue: true },
  });
  const revenueType = (termo?.modality ?? cliente.modality) === "TCV" ? "TCV" : "MRR";
  const amount =
    linha.valorCobrado ??
    (revenueType === "MRR" ? n(termo?.monthlyValue) : 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    registrar({
      entity: "mensal", entityId: null, sheet: linha.sourceSheet, row: linha.sourceRow,
      operation: "CRIOU", raw: linha, confianca: 40,
      revisao: "sem valor_cobrado e sem termo vigente com valor — a cobrança do mês não sabe quanto vale",
    });
    return;
  }

  const dueDate = getValidDueDateForMonth(comp.year, comp.month, cliente.paymentDay);
  const compLabel = `${String(comp.month).padStart(2, "0")}/${comp.year}`;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  const existente = await prisma.billing.findFirst({
    where: {
      clientId,
      competenceMonth: comp.month,
      competenceYear: comp.year,
      revenueType,
      status: { not: "CANCELED" },
    },
    select: { id: true, status: true, amount: true, paidTotal: true },
  });

  let billingId: string;
  let billingOperation: "CRIOU" | "ATUALIZOU" = "ATUALIZOU";
  let revisao: string | null = null;

  if (!existente) {
    const criada = await prisma.billing.create({
      data: {
        clientId,
        description: `${revenueType === "TCV" ? "Contrato" : "Mensalidade"} ${compLabel} — ${cliente.name}`,
        competenceMonth: comp.month,
        competenceYear: comp.year,
        amount,
        dueDate,
        revenueType,
        status:
          linha.status.tipo === "REMOVIDO" ? "CANCELED"
          : dueDate < hoje ? "OVERDUE" : "PENDING",
        ...(linha.status.tipo === "REMOVIDO"
          ? {
              canceledAt: new Date(),
              canceledBy: byEmail,
              cancelReason: `Removido na importação (${proveniencia})`,
            }
          : {}),
      },
      select: { id: true },
    });
    billingId = criada.id;
    billingOperation = "CRIOU";
    r.cobrancasCriadas++;
  } else {
    billingId = existente.id;
    if (linha.status.tipo === "REMOVIDO") {
      if (n(existente.paidTotal) > 0) {
        revisao = "planilha diz Removido, mas a cobrança tem pagamento — nada foi cancelado";
      } else if (existente.status !== "CANCELED") {
        await prisma.billing.update({
          where: { id: existente.id },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            canceledBy: byEmail,
            cancelReason: `Removido na importação (${proveniencia})`,
          },
        });
      }
    } else if (existente.status === "PAID") {
      if (Math.abs(n(existente.amount) - amount) > 0.005)
        revisao = `cobrança já QUITADA com valor ${n(existente.amount).toFixed(2)} ≠ planilha ${amount.toFixed(2)} — dinheiro pago nunca é reescrito`;
    } else if (Math.abs(n(existente.amount) - amount) > 0.005) {
      await prisma.billing.update({
        where: { id: existente.id },
        data: { amount, dueDate },
      });
    }
  }

  // ----- Pagamento conforme o vocabulário -----
  const t = linha.status.tipo;
  if ((t === "PAGO" || t === "PAGO_COM_ATRASO" || t === "PAGO_EM" || t === "PARCIAL") && !revisao) {
    const atual = await prisma.billing.findUniqueOrThrow({
      where: { id: billingId },
      select: { status: true, amount: true, paidTotal: true },
    });
    const aberto = n(atual.amount) - n(atual.paidTotal);
    const valor = t === "PARCIAL" ? linha.valorPago! : aberto;

    // Idempotência de reimportação: já pago (ou parcial já aplicado) = não repete.
    const jaSatisfeito =
      atual.status === "PAID" ||
      (t === "PARCIAL" && n(atual.paidTotal) >= linha.valorPago! - 0.005);

    if (!jaSatisfeito && valor > 0) {
      const paidAt =
        t === "PAGO_EM"
          ? getValidDueDateForMonth(linha.status.ano, linha.status.mes, cliente.paymentDay)
          : linha.dataPagamento ?? dueDate;
      const notas =
        t === "PAGO_EM"
          ? `${proveniencia}. Pago em ${String(linha.status.mes).padStart(2, "0")}/${linha.status.ano} — dia exato não informado na planilha.`
          : proveniencia;

      const res = await settleBilling({
        billingId,
        amount: Math.round(valor * 100) / 100,
        paidAt,
        method: "OTHER",
        accountId: null,
        notes: notas,
      });
      if (res.ok) {
        r.pagamentosCriados++;
        registrar({
          entity: "pagamento", entityId: res.paymentId, sheet: linha.sourceSheet, row: linha.sourceRow,
          operation: "CRIOU", raw: { competencia: linha.competencia, valor, tipo: t },
        });
      } else {
        revisao = `pagamento não entrou: ${res.error}`;
      }
    }
  }

  registrar({
    entity: "mensal", entityId: billingId, sheet: linha.sourceSheet, row: linha.sourceRow,
    operation: billingOperation, raw: linha, confianca: revisao ? 60 : 100, revisao,
  });
}
