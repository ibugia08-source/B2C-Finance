import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { openTerm } from "@/lib/services/commercial-term";
import { iniciarOnboarding } from "@/lib/services/onboarding";

/**
 * O QUE UM CLIENTE PRECISA TER PARA EXISTIR DE VERDADE (F1.21 · 01 §4.1-4.3).
 *
 * Cliente cadastrado é só metade do fato. Sem a RELAÇÃO com a agência, a
 * cobrança nasce sem vínculo (o gatilho do banco não tem o que preencher) e o
 * cliente some da grade de avaliação. Sem o TERMO, o preço não tem histórico
 * e o MRR do mês passado deixa de ser explicável. Sem o ONBOARDING, o board
 * de implantação vira ficção.
 *
 * Este arquivo existe porque essa sequência estava escrita DENTRO da action de
 * cadastro manual, e a importação por planilha não passava por lá — 100
 * clientes importados nasciam pela metade, calados. Com o sistema entrando em
 * produção vazio (decisão 19.32), a planilha é a porta principal, não a
 * secundária: era o caminho mais usado que estava errado.
 *
 * NADA AQUI DERRUBA O CADASTRO. O cliente é o fato principal; relação, termo e
 * onboarding se reparam depois, e o que falhou volta como pendência em vez de
 * virar erro na cara de quem estava importando 300 linhas.
 */

export type NascimentoCliente = {
  status?: string | null;
  startedAt?: Date | null;
  modality?: "MRR" | "TCV" | null;
  monthlyValue?: number | null;
  totalContractValue?: number | null;
  contractMonths?: number | null;
  agencyId?: string | null;
};

export type ResultadoNascimento = {
  relationshipId: string | null;
  termoAberto: boolean;
  onboardingIniciado: boolean;
  /** O que não deu certo, em português, para virar pendência de revisão. */
  faltou: string[];
};

/** Agência padrão: a primeira ativa. Workspace-scoped, fora do escopo de dono. */
export async function agenciaPadrao(): Promise<string | null> {
  const a = await runWithoutScope(async () =>
    prisma.agency.findFirst({
      where: { active: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    })
  );
  return a?.id ?? null;
}

export async function abrirVidaDoCliente(
  clientId: string,
  dados: NascimentoCliente = {}
): Promise<ResultadoNascimento> {
  const faltou: string[] = [];
  const inicio = dados.startedAt ?? new Date();

  const agencyId = dados.agencyId ?? (await agenciaPadrao());
  if (!agencyId) {
    return {
      relationshipId: null,
      termoAberto: false,
      onboardingIniciado: false,
      faltou: ["nenhuma agência cadastrada — o cliente ficou sem relação"],
    };
  }

  // Idempotente: reimportar a mesma planilha não duplica a relação.
  const jaTem = await prisma.clientAgencyRelationship.findFirst({
    where: { clientId, agencyId, churnedAt: null },
    select: { id: true },
  });

  let relationshipId = jaTem?.id ?? null;
  if (!relationshipId) {
    try {
      const rel = await prisma.clientAgencyRelationship.create({
        data: {
          clientId,
          agencyId,
          lifecycleStatus: dados.status === "CHURNED" ? "CHURNED" : "ONBOARDING",
          startedAt: inicio,
        },
        select: { id: true },
      });
      relationshipId = rel.id;
    } catch {
      faltou.push("não foi possível criar a relação com a agência");
      return { relationshipId: null, termoAberto: false, onboardingIniciado: false, faltou };
    }
  }

  // TERMO — só quando há preço. Abrir termo com valor zero criaria um
  // histórico dizendo "este cliente valia R$ 0,00 em setembro", que é
  // exatamente a mentira que o histórico de preço existe para evitar.
  let termoAberto = false;
  const temPreco =
    (dados.monthlyValue ?? 0) > 0 || (dados.totalContractValue ?? 0) > 0;
  if (temPreco) {
    try {
      const jaTemTermo = await prisma.commercialTerm.findFirst({
        where: { relationshipId, validTo: null },
        select: { id: true },
      });
      if (!jaTemTermo) {
        await openTerm({
          relationshipId,
          modality: dados.modality ?? "MRR",
          monthlyValue: dados.monthlyValue ?? null,
          totalContractValue: dados.totalContractValue ?? null,
          contractMonths: dados.contractMonths ?? null,
          validFrom: inicio,
          reason: "Entrada do cliente",
        });
      }
      termoAberto = true;
    } catch {
      faltou.push("o preço não virou termo comercial");
    }
  } else if (dados.status !== "CHURNED" && dados.status !== "PROSPECT") {
    faltou.push("cliente ativo sem valor — sem preço não há termo nem MRR");
  }

  let onboardingIniciado = false;
  if (dados.status !== "CHURNED") {
    try {
      await iniciarOnboarding(relationshipId);
      onboardingIniciado = true;
    } catch {
      faltou.push("o roteiro de implantação não foi aberto");
    }
  }

  return { relationshipId, termoAberto, onboardingIniciado, faltou };
}
