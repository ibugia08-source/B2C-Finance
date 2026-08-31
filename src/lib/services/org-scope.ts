import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * ESCOPO ORGANIZACIONAL da barra global (F1.14 · ref. 02 §2).
 *
 * "Seletor de escopo (Todas | EntidadeLegal | Agência)".
 *
 * Regra de honestidade: o seletor só aparece quando há de fato mais de
 * uma opção. O seed da F0.5 criou UMA entidade e UMA agência espelhando
 * a B2C Gestão — mostrar um seletor com um item só seria um controle
 * morto, e a Camada de Simplicidade (02 §1) não admite enfeite que não
 * faz nada. Quando a F1.1 ligar clientes a agências e existir a segunda,
 * o seletor aparece sozinho.
 */

export type ScopeOption = {
  id: string;
  label: string;
  kind: "entidade" | "agencia";
  /** Agência: a entidade legal dona dela. */
  parentId?: string;
  color?: string | null;
};

export type ScopeOptions = {
  entities: ScopeOption[];
  agencies: ScopeOption[];
  /** false quando há 0 ou 1 opção de cada — a barra esconde o seletor. */
  multiple: boolean;
};

export async function getScopeOptions(): Promise<ScopeOptions> {
  // Entidades e agências são do WORKSPACE, não de um dono: a extensão de
  // escopo por ownerId não se aplica a elas.
  const [entidades, agencias] = await runWithoutScope(async () => {
    const e = await prisma.legalEntity.findMany({
      where: { active: true },
      select: { id: true, legalName: true, tradeName: true },
      orderBy: { legalName: "asc" },
    });
    const a = await prisma.agency.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true, legalEntityId: true },
      orderBy: { name: "asc" },
    });
    return [e, a] as const;
  });

  const entities: ScopeOption[] = entidades.map((e) => ({
    id: e.id,
    label: e.tradeName || e.legalName,
    kind: "entidade",
  }));
  const agencies: ScopeOption[] = agencias.map((a) => ({
    id: a.id,
    label: a.name,
    kind: "agencia",
    parentId: a.legalEntityId,
    color: a.color,
  }));

  return { entities, agencies, multiple: entities.length + agencies.length > 2 };
}
