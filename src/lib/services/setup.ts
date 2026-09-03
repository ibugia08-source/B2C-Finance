import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { PASSOS, type PassoId, type PassoSetup } from "@/lib/setup-meta";

/**
 * SETUP GUIADO — estado real (F1.20 · ref. 02 §3).
 *
 * A REGRA DE PROJETO DESTE ARQUIVO, e é a única que importa: "feito" é
 * SEMPRE deduzido do banco, nunca de um clique. Uma lista que se marca
 * pronta porque alguém apertou "pronto" é pior que não ter lista — ela
 * afirma que o sistema está configurado quando não está, e o dono só
 * descobre no fim do mês, quando o resultado não bate.
 *
 * O que fica gravado é só o que NÃO dá para deduzir: quais passos o dono
 * escolheu ADIAR ("fazer depois", exigido por §3) e quando ele encerrou a
 * lista de vez.
 */

/**
 * O passo SEM o ícone.
 *
 * O ícone é um componente React, ou seja, uma FUNÇÃO — e função não
 * atravessa a fronteira servidor→cliente do App Router. Mandá-lo junto
 * derruba a home inteira em tempo de execução, com o build passando verde
 * (o erro é de serialização, não de tipo). O cliente resolve o ícone pelo id,
 * importando o mesmo catálogo neutro.
 */
export type EstadoPasso = Omit<PassoSetup, "icon"> & {
  feito: boolean;
  adiado: boolean;
  /** Quantos itens já existem (0 quando nada foi feito). */
  quantidade: number;
};

export type EstadoSetup = {
  passos: EstadoPasso[];
  feitos: number;
  total: number;
  /** Minutos declarados do que ainda falta. */
  minutosRestantes: number;
  /** Tudo feito ou adiado. */
  completo: boolean;
  /** O dono mandou sumir com a lista. */
  encerrado: boolean;
};

type Guardado = { adiados?: string[]; encerradoEm?: string | null };

async function lerGuardado(): Promise<Guardado> {
  const id = await currentWorkspaceId();
  const w = await runWithoutScope(async () =>
    prisma.workspace.findUnique({ where: { id }, select: { setupState: true } })
  );
  const raw = (w?.setupState ?? {}) as any;
  return {
    adiados: Array.isArray(raw.adiados) ? raw.adiados : [],
    encerradoEm: typeof raw.encerradoEm === "string" ? raw.encerradoEm : null,
  };
}

async function gravarGuardado(next: Guardado): Promise<void> {
  const id = await currentWorkspaceId();
  await runWithoutScope(async () =>
    prisma.workspace.update({ where: { id }, data: { setupState: next as any } })
  );
}

/**
 * Contagens que decidem cada passo. Uma consulta por passo, todas em
 * paralelo — o card abre junto com a home, não depois dela.
 */
async function contagens(): Promise<Record<PassoId, number>> {
  const [agencias, usuarios, clientes, despesas] = await Promise.all([
    runWithoutScope(async () => prisma.agency.count({ where: { active: true } })),
    // Equipe = alguém ALÉM do dono. Um usuário só significa que ninguém entrou.
    runWithoutScope(async () => prisma.user.count({ where: { active: true } })),
    prisma.client.count(),
    prisma.transaction.count({ where: { type: "despesa" } }),
  ]);
  return {
    agencia: agencias,
    time: Math.max(0, usuarios - 1),
    clientes,
    despesas,
  };
}

export async function estadoDoSetup(): Promise<EstadoSetup> {
  const [guardado, qtd] = await Promise.all([lerGuardado(), contagens()]);
  const adiados = new Set(guardado.adiados ?? []);

  const passos: EstadoPasso[] = PASSOS.map(({ icon: _icon, ...p }) => ({
    ...p,
    quantidade: qtd[p.id],
    feito: qtd[p.id] > 0,
    // Adiar é escolha sobre um passo que ainda NÃO está feito; assim que o
    // dono faz o passo, a marca de adiado deixa de importar sozinha.
    adiado: adiados.has(p.id) && qtd[p.id] === 0,
  }));

  const feitos = passos.filter((p) => p.feito).length;
  return {
    passos,
    feitos,
    total: passos.length,
    minutosRestantes: passos
      .filter((p) => !p.feito && !p.adiado)
      .reduce((s, p) => s + p.minutos, 0),
    completo: passos.every((p) => p.feito || p.adiado),
    encerrado: !!guardado.encerradoEm,
  };
}

/** O card aparece? §3: "checklist na home ATÉ CONCLUIR". */
export async function mostrarSetup(): Promise<EstadoSetup | null> {
  const e = await estadoDoSetup();
  if (e.encerrado) return null;
  // Todos os passos feitos de verdade → a lista já cumpriu o papel e some
  // sozinha, sem exigir mais um clique de quem acabou de fazer cinco.
  if (e.passos.every((p) => p.feito)) return null;
  return e;
}

export async function adiarPasso(id: PassoId): Promise<void> {
  const g = await lerGuardado();
  const set = new Set(g.adiados ?? []);
  set.add(id);
  await gravarGuardado({ ...g, adiados: [...set] });
}

export async function retomarPasso(id: PassoId): Promise<void> {
  const g = await lerGuardado();
  await gravarGuardado({ ...g, adiados: (g.adiados ?? []).filter((x) => x !== id) });
}

export async function encerrarSetup(): Promise<void> {
  const g = await lerGuardado();
  await gravarGuardado({ ...g, encerradoEm: new Date().toISOString() });
}

export async function reabrirSetup(): Promise<void> {
  const g = await lerGuardado();
  await gravarGuardado({ ...g, encerradoEm: null });
}
