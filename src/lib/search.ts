"use server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectivePermissions } from "@/lib/permissions";
import { formatBRL } from "@/lib/format";

/**
 * BUSCA GLOBAL (F1.14 · ref. 02 §3).
 *
 * "Clientes, contratos, cobranças (valor/descrição), despesas, leads,
 * telas; agrupada por tipo, navegável por teclado. Carteira usa índice
 * local (instantâneo); resto no servidor."
 *
 * Leads ainda não existem como modelo (nascem na F4.1) — quando nascerem,
 * entram aqui como mais um grupo. Nada é inventado no meio-tempo.
 *
 * RBAC: cada grupo só é consultado se o usuário puder ver aquele módulo.
 * O escopo por dono já vem da extensão do Prisma; aqui filtramos por
 * PERMISSÃO, que é uma pergunta diferente.
 */

export type SearchKind = "cliente" | "cobranca" | "contrato" | "despesa";

export type SearchHit = {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  href: string;
};

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] };

const LABEL: Record<SearchKind, string> = {
  cliente: "Clientes",
  cobranca: "Cobranças",
  contrato: "Contratos",
  despesa: "Despesas",
};

const POR_GRUPO = 5;

/** Índice local da carteira: baixado uma vez e filtrado no navegador. */
export async function clientSearchIndex(): Promise<
  { id: string; name: string; document: string | null; status: string }[]
> {
  const user = await getCurrentUser();
  if (!user) return [];
  const perms = effectivePermissions(user);
  if (user.role !== "ADMIN" && !perms.has("clientes.visualizar")) return [];

  return prisma.client.findMany({
    select: { id: true, name: true, document: true, status: true },
    orderBy: { name: "asc" },
  });
}

export async function globalSearch(termo: string): Promise<SearchGroup[]> {
  const q = termo.trim();
  if (q.length < 2) return [];

  const user = await getCurrentUser();
  if (!user) return [];
  const perms = effectivePermissions(user);
  const pode = (p: string) => user.role === "ADMIN" || perms.has(p);

  const like = { contains: q, mode: "insensitive" as const };
  const grupos: SearchGroup[] = [];

  if (pode("clientes.visualizar")) {
    const clientes = await prisma.client.findMany({
      where: { OR: [{ name: like }, { legalName: like }, { document: like }, { email: like }] },
      select: { id: true, name: true, segment: true, status: true },
      take: POR_GRUPO,
      orderBy: { name: "asc" },
    });
    push(grupos, "cliente", clientes.map((c) => ({
      id: c.id,
      kind: "cliente" as const,
      title: c.name,
      subtitle: [c.segment, c.status === "ACTIVE" ? "ativo" : c.status.toLowerCase()]
        .filter(Boolean)
        .join(" · "),
      href: `/clientes/${c.id}`,
    })));
  }

  if (pode("recebimentos.visualizar")) {
    const cobrancas = await prisma.billing.findMany({
      where: { OR: [{ description: like }, { client: { name: like } }] },
      select: {
        id: true, description: true, amount: true, competence: true,
        competenceMonth: true, competenceYear: true, client: { select: { name: true } },
      },
      take: POR_GRUPO,
      orderBy: [{ competenceYear: "desc" }, { competenceMonth: "desc" }],
    });
    push(grupos, "cobranca", cobrancas.map((b) => ({
      id: b.id,
      kind: "cobranca" as const,
      title: `${b.client.name} — ${b.description}`,
      subtitle: `${formatBRL(b.amount)} · ${b.competence ?? `${b.competenceYear}-${String(b.competenceMonth).padStart(2, "0")}`}`,
      // Abre o mês da cobrança já filtrado (02 §5.5: "abre detalhe já filtrado").
      href: `/cobrancas?mes=${b.competence ?? `${b.competenceYear}-${String(b.competenceMonth).padStart(2, "0")}`}`,
    })));
  }

  if (pode("contratos.visualizar")) {
    const contratos = await prisma.contract.findMany({
      where: { OR: [{ title: like }, { client: { name: like } }] },
      select: { id: true, title: true, monthlyValue: true, client: { select: { name: true } } },
      take: POR_GRUPO,
      orderBy: { startDate: "desc" },
    });
    push(grupos, "contrato", contratos.map((c) => ({
      id: c.id,
      kind: "contrato" as const,
      title: c.title,
      subtitle: `${c.client.name} · ${formatBRL(c.monthlyValue)}/mês`,
      href: `/contratos/${c.id}`,
    })));
  }

  if (pode("despesas.visualizar")) {
    const despesas = await prisma.transaction.findMany({
      where: { type: "despesa", description: like },
      select: { id: true, description: true, amount: true, date: true },
      take: POR_GRUPO,
      orderBy: { date: "desc" },
    });
    push(grupos, "despesa", despesas.map((t) => ({
      id: t.id,
      kind: "despesa" as const,
      title: t.description,
      subtitle: `${formatBRL(t.amount)} · ${t.date.toLocaleDateString("pt-BR")}`,
      href: `/despesas?mes=${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`,
    })));
  }

  return grupos;
}

function push(destino: SearchGroup[], kind: SearchKind, hits: SearchHit[]) {
  if (hits.length) destino.push({ kind, label: LABEL[kind], hits });
}
