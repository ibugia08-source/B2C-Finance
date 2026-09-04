"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { limparSistema, type ResultadoLimpeza } from "@/lib/services/limpar-sistema";
import { FRASE_DE_CONFIRMACAO } from "@/lib/limpar-sistema-meta";

/**
 * LIMPAR O SISTEMA pela interface (Configurações → Zona de risco).
 *
 * Três travas, nenhuma decorativa:
 *  1. só ADMIN — não é permissão configurável, é papel;
 *  2. a frase exata "APAGAR TUDO" digitada, conferida DE NOVO aqui no
 *     servidor — a interface pode ser contornada, a action não;
 *  3. o serviço confere estrutura intacta depois do corte e reporta alto
 *     se algo saiu do combinado.
 *
 * O que fica: usuários, agência, plano de contas, métricas, regras,
 * categorias, modelos de contrato e demais configurações. O que sai: TODO o
 * movimento — clientes, cobranças, pagamentos, despesas, avaliações,
 * fotografias, histórico. Não há backup automático aqui: é o recomeço que o
 * dono pediu, e a tela diz isso com todas as letras antes do clique.
 */

export async function limparSistemaAction(frase: string): Promise<ResultadoLimpeza> {
  const viewer = await getViewer();
  if (viewer.role !== "ADMIN")
    return { ok: false, error: "Só o administrador pode limpar o sistema." };
  if (frase !== FRASE_DE_CONFIRMACAO)
    return {
      ok: false,
      error: `Digite exatamente ${FRASE_DE_CONFIRMACAO} para confirmar.`,
    };

  const r = await limparSistema({ actorEmail: viewer.email });
  if (r.ok) {
    for (const p of [
      "/", "/dashboard", "/clientes", "/cobrancas", "/despesas", "/caixa",
      "/importacoes", "/configuracoes", "/avaliacoes", "/fechamento", "/relatorios",
    ])
      revalidatePath(p);
  }
  return r;
}
