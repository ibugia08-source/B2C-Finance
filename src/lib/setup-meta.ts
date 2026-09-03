import {
  Building2, Users, Contact, Receipt, Rocket, type LucideIcon,
} from "lucide-react";

/**
 * SETUP GUIADO DE PRIMEIRO USO — catálogo dos passos (F1.20 · ref. 02 §3).
 *
 * Módulo NEUTRO (sem prisma, sem next): o card da home é client component e
 * os EmptyStates de tela inteira importam daqui para apontar para o passo
 * certo — que é a segunda metade de §3 ("estados vazios de todas as telas
 * apontam para o passo correspondente") e o que faz T4 valer alguma coisa.
 *
 * POR QUE ISTO VIROU CAMINHO CRÍTICO: a direção decidiu em 31/08 (19.32) que
 * não há migração — o sistema entra em produção com o banco VAZIO. Antes
 * dessa decisão o setup era conforto; agora é a única porta de entrada dos
 * dados reais, e a primeira tela que o dono vê é uma tela vazia.
 *
 * §3 fixa três regras que valem mais que qualquer enfeite:
 *   · NADA BLOQUEIA — todo passo tem "fazer depois";
 *   · ~30 minutos no total, e o tempo de cada passo é declarado;
 *   · o fim é a Gestão do Mês aberta e POPULADA, não um troféu.
 */

export type PassoId = "agencia" | "time" | "clientes" | "despesas";

export type PassoSetup = {
  id: PassoId;
  numero: number;
  titulo: string;
  /** O que este passo resolve, na língua de quem usa. */
  descricao: string;
  href: string;
  cta: string;
  /** Minutos declarados — a soma tem de caber nos ~30 de §3. */
  minutos: number;
  icon: LucideIcon;
  /** Frase do EmptyState das telas que dependem deste passo. */
  vazio: string;
};

export const PASSOS: PassoSetup[] = [
  {
    id: "agencia",
    numero: 1,
    titulo: "Suas agências",
    descricao:
      "Confirme o nome da agência e crie as outras, se você atende por mais de uma marca. Serve para dizer quais clientes são de quem.",
    href: "/configuracoes?secao=agencias",
    cta: "Revisar agências",
    minutos: 3,
    icon: Building2,
    vazio: "Nenhuma agência cadastrada ainda.",
  },
  {
    id: "time",
    numero: 2,
    titulo: "Quem mais entra",
    descricao:
      "Cadastre a equipe e escolha o que cada um enxerga. Folha só você vê — conceder é escolha sua, um usuário por vez.",
    href: "/usuarios",
    cta: "Cadastrar equipe",
    minutos: 5,
    icon: Users,
    vazio: "Você é o único usuário até aqui.",
  },
  {
    id: "clientes",
    numero: 3,
    titulo: "Sua carteira",
    descricao:
      "Traga os clientes por planilha, com prévia conferida antes de gravar, ou cadastre um a um. É o passo que enche o sistema.",
    href: "/importacoes",
    cta: "Importar clientes",
    minutos: 10,
    icon: Contact,
    vazio: "Nenhum cliente na carteira ainda.",
  },
  // O passo "Contas e saldo de hoje" SAIU em 02/09 por decisão da direção:
  // cadastrar conta bancária à mão não é mais o fluxo — a conta nasce da
  // importação de extrato (conciliação) ou da conexão Open Finance.
  {
    id: "despesas",
    numero: 4,
    titulo: "Despesas fixas",
    descricao:
      "Aluguel, ferramentas, folha, impostos. Sem elas o resultado do mês mostra só a receita e parece bom demais.",
    href: "/despesas",
    cta: "Lançar despesas fixas",
    minutos: 6,
    icon: Receipt,
    vazio: "Nenhuma despesa lançada neste mês.",
  },
];

/** Passo 6 de §3 não é tarefa: é a chegada. */
export const PASSO_FINAL = {
  titulo: "Pronto",
  descricao: "A Gestão do Mês abre com a sua carteira dentro.",
  href: "/cobrancas",
  cta: "Abrir a Gestão do Mês",
  icon: Rocket,
};

export const MINUTOS_TOTAIS = PASSOS.reduce((s, p) => s + p.minutos, 0);

export function passoPorId(id: PassoId): PassoSetup {
  const p = PASSOS.find((x) => x.id === id);
  if (!p) throw new Error(`Passo de setup desconhecido: ${id}`);
  return p;
}
