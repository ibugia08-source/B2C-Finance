import { prisma } from "@/lib/prisma";
import type { CategorizationRule } from "@prisma/client";

export type RuleInput = {
  description: string;
  cardId?: string | null;
  amount: number;
};

export type RuleEffect = {
  categoryId?: string | null;
  responsibleId?: string | null;
  belongsTo?: string | null;
  reimbursable?: boolean | null;
  status?: string | null;
};

export type RuleContext = {
  rules: CategorizationRule[];
  personIdByName: Map<string, string>;
};

/**
 * Carrega as regras ativas + pessoas referenciadas UMA vez.
 * Use com applyRulesSync para processar muitas linhas sem N+1.
 */
export async function loadRuleContext(): Promise<RuleContext> {
  const rules = await prisma.categorizationRule.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });

  const names = Array.from(
    new Set(rules.map((r) => r.responsibleName).filter(Boolean))
  ) as string[];

  // person.findMany é escopado por dono pela extensão do Prisma → resolve
  // apenas pessoas do próprio usuário.
  const people = names.length
    ? await prisma.person.findMany({
        where: { name: { in: names } },
        select: { id: true, name: true },
      })
    : [];

  return {
    rules,
    personIdByName: new Map(people.map((p) => [p.name, p.id])),
  };
}

/** Aplica as regras já carregadas a uma linha — 100% em memória. */
export function applyRulesSync(ctx: RuleContext, input: RuleInput): RuleEffect {
  const desc = (input.description || "").toUpperCase();
  const effect: RuleEffect = {};

  for (const r of ctx.rules) {
    let matches = true;

    if (r.descriptionContains) {
      matches = matches && desc.includes(r.descriptionContains.toUpperCase());
    }
    if (r.cardId) {
      matches = matches && input.cardId === r.cardId;
    }
    if (r.amountGreaterThan != null) {
      matches = matches && input.amount > r.amountGreaterThan;
    }
    if (r.amountLessThan != null) {
      matches = matches && input.amount < r.amountLessThan;
    }

    if (!matches) continue;

    if (r.categoryId && effect.categoryId == null) effect.categoryId = r.categoryId;
    if (r.belongsTo && effect.belongsTo == null) effect.belongsTo = r.belongsTo;
    if (r.reimbursable != null && effect.reimbursable == null) effect.reimbursable = r.reimbursable;
    if (r.status && effect.status == null) effect.status = r.status;
    if (r.responsibleName && effect.responsibleId == null) {
      const id = ctx.personIdByName.get(r.responsibleName);
      if (id) effect.responsibleId = id;
    }
  }

  return effect;
}

/** Versão avulsa (1 linha). Para lotes, use loadRuleContext + applyRulesSync. */
export async function applyRules(input: RuleInput): Promise<RuleEffect> {
  const ctx = await loadRuleContext();
  return applyRulesSync(ctx, input);
}
