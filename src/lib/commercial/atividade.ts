/**
 * OS CAMPOS DA ATIVIDADE DIÁRIA (F4.3 · ref. 01 §4.6; 02 §5.4).
 *
 * Módulo NEUTRO — sem Prisma, sem React. A tela do SDR é um componente de
 * cliente e precisa desta lista para desenhar os botões; importá-la do
 * serviço arrastaria o Prisma (e o `async_hooks` do contexto de dono) para
 * dentro do pacote do navegador, e a página quebra ao abrir.
 *
 * Foi exatamente o que aconteceu na primeira versão, e o build NÃO pegou:
 * tipo atravessa a fronteira servidor→cliente sem reclamar, valor não. A
 * mesma armadilha dos ícones do setup guiado, em outra roupa.
 */

export const CAMPOS_DE_ATIVIDADE = [
  { id: "ligacoes", rotulo: "Ligações", metricaDaMeta: "ligacoes" },
  { id: "abordagens", rotulo: "Abordagens", metricaDaMeta: "abordagens" },
  { id: "agendamentos", rotulo: "Agendamentos", metricaDaMeta: "agendamentos" },
  { id: "reunioesRealizadas", rotulo: "Reuniões realizadas", metricaDaMeta: "reunioes" },
  // No-show não tem meta: ninguém tem alvo de cliente que não apareceu.
  { id: "noShows", rotulo: "No-shows", metricaDaMeta: null },
  { id: "propostas", rotulo: "Propostas", metricaDaMeta: "propostas" },
] as const;

export type CampoDeAtividade = (typeof CAMPOS_DE_ATIVIDADE)[number]["id"];

export type LinhaDeAtividade = Record<CampoDeAtividade, number>;

export type ProgressoDaMeta = {
  campo: CampoDeAtividade;
  rotulo: string;
  hoje: number;
  mes: number;
  /** Meta do MÊS, quando houver. */
  metaDoMes: number | null;
  /** Meta do mês dividida pelos dias úteis — o alvo de hoje. */
  metaDoDia: number | null;
  percentualDoMes: number | null;
};

/** Dia útil = segunda a sexta (mesma regra da régua de cobrança). */
export function ehDiaUtilComercial(d: Date): boolean {
  const dia = d.getDay();
  return dia >= 1 && dia <= 5;
}

/** Dias úteis do mês e quantos já passaram (inclusive hoje). */
export function diasUteis(referencia: Date) {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  let total = 0;
  let decorridos = 0;
  for (let d = 1; d <= new Date(ano, mes + 1, 0).getDate(); d++) {
    const dia = new Date(ano, mes, d);
    if (!ehDiaUtilComercial(dia)) continue;
    total++;
    if (d <= referencia.getDate()) decorridos++;
  }
  return { total, decorridos };
}
