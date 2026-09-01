import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { competenceOf, type Competence } from "@/lib/competence";
import {
  CAMPOS_DE_ATIVIDADE, diasUteis,
  type CampoDeAtividade, type LinhaDeAtividade, type ProgressoDaMeta,
} from "@/lib/commercial/atividade";

// Reexportados para quem já importava daqui — mas a TELA importa do módulo
// neutro, nunca deste arquivo (ver o cabeçalho de commercial/atividade.ts).
export { CAMPOS_DE_ATIVIDADE, diasUteis };
export type { CampoDeAtividade, LinhaDeAtividade, ProgressoDaMeta };

/**
 * ATIVIDADE DIÁRIA DO SDR (F4.3 · ref. 01 §4.6; 02 §5.4; cenário S2).
 *
 * "Atividade registrada em 30 segundos, com meta visível."
 *
 * Trinta segundos é o requisito e ele decide o formato: um TOQUE por campo,
 * sem formulário, sem salvar, sem confirmar. Cada botão soma um e grava. Um
 * formulário com seis campos e um botão "Salvar" levaria dois minutos no
 * celular, e atividade que leva dois minutos deixa de ser registrada na
 * terceira semana — e aí não existe CPL, não existe comparecimento e não
 * existe conversão de reunião.
 *
 * A LINHA DO DIA É ÚNICA por (data, SDR, agência), garantida por unique no
 * banco. Somar por upsert em vez de criar linha nova é o que faz o toque
 * repetido ser seguro: dois toques no mesmo segundo somam dois, não criam
 * dois registros que ninguém consegue reconciliar depois.
 */

export type PainelDoSdr = {
  sdr: string;
  agencyId: string;
  data: Date;
  competence: Competence;
  hoje: LinhaDeAtividade;
  mes: LinhaDeAtividade;
  progresso: ProgressoDaMeta[];
  /** Comparecimento = realizadas / (realizadas + no-show). */
  comparecimento: number | null;
  diasUteisNoMes: number;
  diasUteisDecorridos: number;
};

function vazia(): LinhaDeAtividade {
  return {
    ligacoes: 0, abordagens: 0, agendamentos: 0,
    reunioesRealizadas: 0, noShows: 0, propostas: 0,
  };
}

function soData(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function painelDoSdr(
  sdr: string,
  opts: { agencyId?: string; hoje?: Date } = {}
): Promise<PainelDoSdr> {
  const hoje = opts.hoje ?? new Date();
  const dia = soData(hoje);
  const agencyId = opts.agencyId ?? "";
  const competence = competenceOf(hoje);
  const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimDoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);

  const [doDia, doMes, metas] = await Promise.all([
    prisma.atividadeDiaria.findFirst({ where: { date: dia, sdr, agencyId } }),
    prisma.atividadeDiaria.findMany({
      where: { sdr, date: { gte: inicioDoMes, lt: fimDoMes } },
    }),
    prisma.commercialGoal.findMany({
      where: { competence, scopeType: "SDR", scopeId: sdr },
      select: { metric: true, target: true },
    }),
  ]);

  const hojeLinha = vazia();
  const mesLinha = vazia();
  for (const c of CAMPOS_DE_ATIVIDADE) {
    hojeLinha[c.id] = doDia ? (doDia[c.id] as number) : 0;
    mesLinha[c.id] = doMes.reduce((s, l) => s + (l[c.id] as number), 0);
  }

  const alvo = new Map(metas.map((m) => [m.metric, n(m.target)]));
  const { total, decorridos } = diasUteis(hoje);

  const progresso: ProgressoDaMeta[] = CAMPOS_DE_ATIVIDADE.map((c) => {
    const metaDoMes = c.metricaDaMeta ? (alvo.get(c.metricaDaMeta) ?? null) : null;
    return {
      campo: c.id,
      rotulo: c.rotulo,
      hoje: hojeLinha[c.id],
      mes: mesLinha[c.id],
      metaDoMes,
      // A meta do dia é a do mês dividida pelos dias ÚTEIS, não pelos dias
      // corridos: cobrar meta de sábado é o jeito mais rápido de o SDR parar
      // de olhar para o número.
      metaDoDia: metaDoMes !== null && total > 0 ? Math.ceil(metaDoMes / total) : null,
      percentualDoMes:
        metaDoMes && metaDoMes > 0
          ? Math.round((mesLinha[c.id] / metaDoMes) * 1000) / 10
          : null,
    };
  });

  const realizadas = mesLinha.reunioesRealizadas;
  const marcadas = realizadas + mesLinha.noShows;

  return {
    sdr,
    agencyId,
    data: dia,
    competence,
    hoje: hojeLinha,
    mes: mesLinha,
    progresso,
    comparecimento: marcadas > 0 ? Math.round((realizadas / marcadas) * 1000) / 10 : null,
    diasUteisNoMes: total,
    diasUteisDecorridos: decorridos,
  };
}

/**
 * Soma (ou subtrai) UM no campo. É a única escrita da tela.
 *
 * `delta` aceita −1 porque errar o toque é normal, e a correção tem de custar
 * o mesmo que o erro. O piso é zero: contagem negativa não existe e o banco
 * também recusa.
 */
export async function registrarAtividade(
  sdr: string,
  campo: CampoDeAtividade,
  delta: number,
  opts: { agencyId?: string; hoje?: Date } = {}
): Promise<{ ok: true; valor: number } | { ok: false; error: string }> {
  if (!CAMPOS_DE_ATIVIDADE.some((c) => c.id === campo))
    return { ok: false, error: "Campo de atividade desconhecido." };
  if (!Number.isInteger(delta) || Math.abs(delta) > 50)
    return { ok: false, error: "Ajuste inválido." };
  if (!sdr.trim()) return { ok: false, error: "Informe de quem é a atividade." };

  const dia = soData(opts.hoje ?? new Date());
  const agencyId = opts.agencyId ?? "";

  // A linha do dia nasce ZERADA e o incremento vem depois: criar já com o
  // delta e incrementar em seguida contaria o primeiro toque duas vezes.
  const linha = await prisma.atividadeDiaria.upsert({
    where: { date_sdr_agencyId: { date: dia, sdr, agencyId } },
    create: { date: dia, sdr, agencyId },
    update: {},
    select: { id: true },
  });

  // SOMAR é atômico no banco: dois toques simultâneos somam dois. Fazer
  // "ler, somar, gravar" em JavaScript perderia um deles — e num contador de
  // atividade essa perda é invisível.
  if (delta > 0) {
    const atualizado = await prisma.atividadeDiaria.update({
      where: { id: linha.id },
      data: { [campo]: { increment: delta } },
      select: { [campo]: true } as any,
    });
    return { ok: true, valor: (atualizado as any)[campo] as number };
  }

  // TIRAR lê antes, para não passar de zero. O banco recusa negativo (CHECK),
  // e deixar o erro estourar transformaria a correção de um toque errado numa
  // mensagem de falha — justamente no gesto que precisa ser barato.
  //
  // Aqui a corrida é aceitável e a assimetria é deliberada: perder um toque
  // somado apaga trabalho que aconteceu; perder um toque subtraído no mesmo
  // milissegundo só adia uma correção que a pessoa refaz olhando o número.
  const atual = await prisma.atividadeDiaria.findUniqueOrThrow({
    where: { id: linha.id },
    select: { [campo]: true } as any,
  });
  const valor = Math.max(0, ((atual as any)[campo] as number) + delta);
  await prisma.atividadeDiaria.update({
    where: { id: linha.id },
    data: { [campo]: valor },
  });
  return { ok: true, valor };
}
