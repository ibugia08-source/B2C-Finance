import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { competenceOf, type Competence } from "@/lib/competence";

/**
 * COMISSÃO (F4.7 · ref. 01 §4.8 · DECIDIDO 19.14).
 *
 * **O VALOR É DIGITADO À MÃO. Ponto.**
 *
 * A spec original previa regra de comissão VERSIONADA com gatilho automático
 * (01 §4.8; 03 §57 lista "regras de comissão versionadas" nas configurações).
 * A direção decidiu em 31/08 que isso não existe nesta versão: "o valor será
 * colocado manualmente no campo de comissão".
 *
 * ESTA AUSÊNCIA É DELIBERADA E ESTÁ TESTADA. Não há `CommissionRule`, não há
 * percentual padrão por closer, não há gatilho que crie comissão quando uma
 * venda é ganha. O motivo de escrever isso aqui em vez de simplesmente não
 * construir: sem o registro, a próxima pessoa que ler "regras de comissão
 * versionadas" na spec vai achar que é dívida técnica e implementar — e vai
 * automatizar uma decisão que a direção quis manual.
 *
 * O QUE ESTE MÓDULO FAZ é a única automação que a decisão permite, porque
 * não calcula nada: lembrar quais vendas ganhas ainda não têm comissão
 * lançada, e guardar de qual venda cada comissão veio.
 */

export type VendaSemComissao = {
  opportunityId: string;
  titulo: string;
  closer: string | null;
  valorDaVenda: number;
  ganhaEm: Date | null;
  competence: Competence;
};

/**
 * Vendas ganhas na competência que ainda não têm comissão registrada.
 *
 * A lista NÃO sugere valor. Sugerir um percentual seria a regra automática de
 * volta pela porta dos fundos: o número sugerido vira o número aceito.
 */
export async function vendasSemComissao(competence: Competence): Promise<VendaSemComissao[]> {
  const [ano, mes] = competence.split("-").map(Number);
  const ganhas = await prisma.opportunity.findMany({
    where: {
      stage: "GANHA",
      wonAt: { gte: new Date(ano, mes - 1, 1), lt: new Date(ano, mes, 1) },
    },
    orderBy: { wonAt: "desc" },
    select: {
      id: true, title: true, closer: true, amount: true, wonAt: true,
      commissions: { select: { id: true } },
    },
  });

  return ganhas
    .filter((o) => o.commissions.length === 0)
    .map((o) => ({
      opportunityId: o.id,
      titulo: o.title,
      closer: o.closer,
      valorDaVenda: n(o.amount),
      ganhaEm: o.wonAt,
      competence,
    }));
}

export type EntradaDeComissao = {
  employeeId: string;
  /** Digitado à mão. Sempre. */
  amount: number;
  competence: Competence;
  opportunityId?: string | null;
  clientId?: string | null;
  notes?: string | null;
};

/**
 * Registra a comissão com o valor que a pessoa digitou.
 *
 * Repare no que NÃO existe na assinatura: base de cálculo e percentual. Eles
 * continuam no formulário antigo da folha como CALCULADORA de conveniência
 * (quem quiser digitar 10% de 3.000 e deixar o campo calcular), mas o que é
 * gravado e o que vale é o `amount`.
 */
export async function registrarComissao(
  input: EntradaDeComissao
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(input.amount > 0))
    return { ok: false, error: "Digite o valor da comissão." };
  const p = input.competence.match(/^(\d{4})-(\d{2})$/);
  if (!p) return { ok: false, error: "Competência inválida." };

  const funcionario = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!funcionario) return { ok: false, error: "Colaborador não encontrado." };

  if (input.opportunityId) {
    const jaTem = await prisma.commission.count({
      where: { opportunityId: input.opportunityId },
    });
    if (jaTem > 0)
      return { ok: false, error: "Esta venda já tem comissão lançada." };
  }

  const c = await prisma.commission.create({
    data: {
      employeeId: input.employeeId,
      amount: input.amount,
      year: Number(p[1]),
      month: Number(p[2]),
      opportunityId: input.opportunityId ?? null,
      clientId: input.clientId ?? null,
      notes: input.notes ?? null,
      status: "PENDING",
    },
    select: { id: true },
  });
  return { ok: true, id: c.id };
}

/** Total de comissão da competência, por situação. */
export async function resumoDeComissoes(competence: Competence) {
  const [ano, mes] = competence.split("-").map(Number);
  const linhas = await prisma.commission.findMany({
    where: { year: ano, month: mes },
    select: { amount: true, status: true },
  });
  const soma = (s: string) =>
    Math.round(
      linhas.filter((l) => l.status === s).reduce((t, l) => t + n(l.amount), 0) * 100
    ) / 100;
  return {
    competence,
    total: Math.round(linhas.reduce((t, l) => t + n(l.amount), 0) * 100) / 100,
    pendente: soma("PENDING"),
    aprovada: soma("APPROVED"),
    paga: soma("PAID"),
    quantidade: linhas.length,
  };
}

/** Competência de hoje — usada pela tela quando não vem mês na URL. */
export function competenciaDeHoje(hoje: Date = new Date()): Competence {
  return competenceOf(hoje);
}
