"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";

/**
 * A ESCOLHA DE HORIZONTE FICA COM A PESSOA (02 §4.4).
 *
 * Quem trabalha o caixa numa janela de 7 dias não quer reencontrar 30 toda
 * vez que abre a tela. A preferência é guardada como SavedView — a mesma
 * mecânica das visões nomeadas —, num módulo PRÓPRIO (`fluxo:preferencia`)
 * para não poluir a barra de visões, que lista o módulo `fluxo`.
 *
 * É preferência de pessoa, não configuração do sistema: cada usuário tem a
 * sua (createdBy), e ela nunca é global.
 */
const MODULO = "fluxo:preferencia";

export async function lembrarFiltroDoFluxo(params: string): Promise<{ ok: boolean }> {
  try {
    const viewer = await getViewer();
    const atual = await prisma.savedView.findFirst({
      where: { module: MODULO, createdBy: viewer.id },
      select: { id: true },
    });
    if (atual) {
      await prisma.savedView.update({
        where: { id: atual.id },
        data: { params: params.slice(0, 2000) },
      });
    } else {
      await prisma.savedView.create({
        data: {
          name: "Último filtro do fluxo",
          module: MODULO,
          params: params.slice(0, 2000),
          visibility: "PRIVATE",
          createdBy: viewer.id,
        },
      });
    }
    return { ok: true };
  } catch (e) {
    // Preferência é conveniência: falhar aqui não pode derrubar a tela.
    console.error("lembrarFiltroDoFluxo", e);
    return { ok: false };
  }
}

/** Último filtro do usuário, para a tela abrir onde ele parou. */
export async function filtroLembradoDoFluxo(): Promise<string | null> {
  try {
    const viewer = await getViewer();
    const v = await prisma.savedView.findFirst({
      where: { module: MODULO, createdBy: viewer.id },
      select: { params: true },
    });
    return v?.params ?? null;
  } catch {
    return null;
  }
}
