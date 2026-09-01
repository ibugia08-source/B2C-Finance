/**
 * CATÁLOGO DE COMPONENTES (T6 · ref. 02 §245).
 *
 * "Componente novo entra no catálogo com os 5 estados documentados." A regra
 * de 02 §245 pede o CATÁLOGO NO CI — e o CI daqui é a suíte: o teste
 * tests/catalogo.test.ts recusa componente canônico fora da lista e entrada
 * com número errado de estados. Um Storybook completo faria o mesmo papel
 * gastando meio gigabyte de dependências; o que a regra protege é a
 * DOCUMENTAÇÃO VIVA, e ela mora aqui e na tela /catalogo, que RENDERIZA os
 * estados de verdade — se um componente quebrar, a tela quebra junto.
 *
 * OS CINCO ESTADOS são os mesmos para todo componente, na língua do design
 * system: padrão, vazio, carregando, erro/atenção e desabilitado/limite.
 * Componente que não tem um dos estados DECLARA por quê — dizer "não se
 * aplica" é documentação; omitir é lacuna.
 */

export type EstadoDoComponente = {
  nome: "padrão" | "vazio" | "carregando" | "erro/atenção" | "desabilitado/limite";
  descricao: string;
};

export type EntradaDoCatalogo = {
  /** Nome canônico (02 §245). */
  componente: string;
  arquivo: string;
  papel: string;
  estados: [
    EstadoDoComponente,
    EstadoDoComponente,
    EstadoDoComponente,
    EstadoDoComponente,
    EstadoDoComponente,
  ];
};

export const CATALOGO: EntradaDoCatalogo[] = [
  {
    componente: "KPI único (MetricCard)",
    arquivo: "src/components/metric-card.tsx",
    papel: "O número com ajuda e selo de base temporal — o único jeito de mostrar KPI (T1).",
    estados: [
      { nome: "padrão", descricao: "Valor formatado, selo de base temporal e ajuda no ícone." },
      { nome: "vazio", descricao: "Nulo honesto: — com o motivo do nulo no tooltip, nunca zero falso." },
      { nome: "carregando", descricao: "Skeleton do bloco inteiro (page-skeleton) até o dado chegar." },
      { nome: "erro/atenção", descricao: "Delta negativo/positivo com cor semântica de status-meta." },
      { nome: "desabilitado/limite", descricao: "Sem permissão de campo, o card não renderiza (02 §5.4) — ausência é o estado." },
    ],
  },
  {
    componente: "MobileCards",
    arquivo: "src/components/ui/record-card.tsx",
    papel: "A tabela em cartões no celular — cada linha vira um cartão com campos nomeados.",
    estados: [
      { nome: "padrão", descricao: "Cartão com título, aside (badge) e Fields rotulados." },
      { nome: "vazio", descricao: "MobileEmpty com texto de próximo passo." },
      { nome: "carregando", descricao: "Skeleton da lista (page-skeleton)." },
      { nome: "erro/atenção", descricao: "Badge semântica no aside (vencido, crítico) — nunca cor crua." },
      { nome: "desabilitado/limite", descricao: "Ações somem sem permissão; o cartão continua legível." },
    ],
  },
  {
    componente: "AlertDialog (confirmAction/askReason)",
    arquivo: "src/components/ui/confirm-dialog.tsx",
    papel: "Toda confirmação e todo motivo obrigatório — alert/confirm nativo é proibido (T3).",
    estados: [
      { nome: "padrão", descricao: "Título, descrição e o par cancelar/confirmar." },
      { nome: "vazio", descricao: "askReason com motivo abaixo do mínimo mantém o confirmar bloqueado." },
      { nome: "carregando", descricao: "Botão de confirmar desabilitado durante a transição." },
      { nome: "erro/atenção", descricao: "Variante destrutiva para gesto irreversível." },
      { nome: "desabilitado/limite", descricao: "Fecha por Esc e por clique fora — nunca prende o foco para sempre." },
    ],
  },
  {
    componente: "EmptyState",
    arquivo: "src/components/empty-state.tsx",
    papel: "Tela vazia que ensina o próximo passo — com a prop `passo` ligando ao setup (T4).",
    estados: [
      { nome: "padrão", descricao: "Ícone, título e descrição com o próximo passo." },
      { nome: "vazio", descricao: "É o próprio estado vazio do sistema — este componente É o estado." },
      { nome: "carregando", descricao: "Não se aplica: EmptyState só entra depois de o dado chegar vazio." },
      { nome: "erro/atenção", descricao: "Nunca usado para erro — erro tem mensagem própria, vazio não é falha." },
      { nome: "desabilitado/limite", descricao: "Com `passo`, aponta o item do checklist de primeiros passos." },
    ],
  },
  {
    componente: "PageHeader",
    arquivo: "src/components/page-header.tsx",
    papel: "Título e pergunta de cabeçalho de toda tela (02: tela declara gabarito).",
    estados: [
      { nome: "padrão", descricao: "Título curto + descrição que responde 'o que eu faço aqui'." },
      { nome: "vazio", descricao: "Descrição é obrigatória por convenção — header sem pergunta reprova em revisão." },
      { nome: "carregando", descricao: "Renderiza imediato (é estático) — âncora visual do skeleton." },
      { nome: "erro/atenção", descricao: "Não carrega estado de erro; erro mora no conteúdo." },
      { nome: "desabilitado/limite", descricao: "Ações do header somem sem permissão." },
    ],
  },
  {
    componente: "undo-toast",
    arquivo: "src/components/undo-toast.tsx",
    papel: "Host ÚNICO de toast com desfazer — o u do teclado global chama requestUndo.",
    estados: [
      { nome: "padrão", descricao: "Mensagem curta com ação de desfazer e tempo de vida." },
      { nome: "vazio", descricao: "Sem toast na fila, nada renderiza — host silencioso." },
      { nome: "carregando", descricao: "Não se aplica: o toast só nasce depois da ação concluída." },
      { nome: "erro/atenção", descricao: "Mensagem de erro usa o MESMO host — nunca um segundo sistema de toast." },
      { nome: "desabilitado/limite", descricao: "Ação sem undo mostra só a mensagem, sem botão falso." },
    ],
  },
  {
    componente: "status-meta (língua de status)",
    arquivo: "src/lib/status-meta.ts",
    papel: "A língua única: verde Pago/Estável; âmbar A vencer/Pausado; vermelho Vencido/Churn; cinza Cancelado; azul Novo.",
    estados: [
      { nome: "padrão", descricao: "Badge com rótulo de gente (nunca o enum) e cor semântica." },
      { nome: "vazio", descricao: "Sem status conhecido: cinza com —, nunca inventa um." },
      { nome: "carregando", descricao: "Não se aplica: status chega junto com a linha." },
      { nome: "erro/atenção", descricao: "Semânticas nunca são fundo de CTA (02 §245)." },
      { nome: "desabilitado/limite", descricao: "ROW_* pintam a linha inteira — dependem do scan de src/lib no tailwind." },
    ],
  },
  {
    componente: "MonthNav + escopo",
    arquivo: "src/components/month-nav.tsx",
    papel: "A barra de contexto das telas-planilha: mês, escopo, busca, filtros salvos.",
    estados: [
      { nome: "padrão", descricao: "Mês atual com ‹ › e atalhos [ ] do teclado global." },
      { nome: "vazio", descricao: "Sem competências anteriores, a seta recua até onde há dado." },
      { nome: "carregando", descricao: "Troca de mês usa transição — a barra nunca some." },
      { nome: "erro/atenção", descricao: "Competência fechada mostra o period-badge ao lado (F2.1)." },
      { nome: "desabilitado/limite", descricao: "Escopo além da permissão nem aparece no seletor (S8)." },
    ],
  },
  {
    componente: "Tabela responsiva",
    arquivo: "src/components/ui/table.tsx",
    papel: "Tabela densa com o wrapper de scroll PRÓPRIO (sticky header depende dele).",
    estados: [
      { nome: "padrão", descricao: "Densa, com foco rotativo do table-keyboard (F3.12)." },
      { nome: "vazio", descricao: "Linha única de vazio com link do próximo passo, colSpan correto." },
      { nome: "carregando", descricao: "Skeleton de linhas (page-skeleton)." },
      { nome: "erro/atenção", descricao: "Linha pintada por ROW_OVERDUE/ROW_SOON — cor semântica, nunca crua." },
      { nome: "desabilitado/limite", descricao: "No celular, ou vira MobileCards (T2) ou rola dentro do próprio wrapper." },
    ],
  },
  {
    componente: "SavedView",
    arquivo: "src/components/saved-views.tsx",
    papel: "Filtro salvo com nome — a visão é da pessoa, o relatório é do sistema.",
    estados: [
      { nome: "padrão", descricao: "Barra com as visões da pessoa e a ativa marcada." },
      { nome: "vazio", descricao: "Sem visões: só o botão de salvar a atual." },
      { nome: "carregando", descricao: "Aplicar visão é navegação — usa a transição da rota." },
      { nome: "erro/atenção", descricao: "Visão apontando para chave de relatório extinta avisa em vez de quebrar." },
      { nome: "desabilitado/limite", descricao: "Sem permissão da tela, a barra não aparece." },
    ],
  },
  {
    componente: "Gráfico (ChartCard/combinado)",
    arquivo: "src/components/charts.tsx",
    papel: "Dataviz nos padrões de 02 §7.4: linhas 2px, grade só horizontal, UM eixo.",
    estados: [
      { nome: "padrão", descricao: "Séries com traço próprio (cheio/tracejado/pontilhado) — cor nunca é o único canal." },
      { nome: "vazio", descricao: "emptyText explica o que alimentaria o gráfico." },
      { nome: "carregando", descricao: "charts-lazy adia o bundle — skeleton no lugar." },
      { nome: "erro/atenção", descricao: "Série negativa usa o vermelho semântico, com rótulo." },
      { nome: "desabilitado/limite", descricao: "Teto de 3 gráficos por home (02 §5.5) — o quarto não entra." },
    ],
  },
  {
    componente: "Modo Fila (gabarito 3)",
    arquivo: "src/app/fila/modo-fila.tsx",
    papel: "Um item em foco, ações por tecla, progresso n de m, pular sem culpa.",
    estados: [
      { nome: "padrão", descricao: "Item em foco + contexto ao lado + teclas j/k/Enter/p/s." },
      { nome: "vazio", descricao: "EmptyState 'Nada na fila hoje' — zerar a fila é o objetivo." },
      { nome: "carregando", descricao: "Ação em transição desabilita os botões do item." },
      { nome: "erro/atenção", descricao: "Suprimidas aparecem COM o motivo — nada some em silêncio." },
      { nome: "desabilitado/limite", descricao: "Sem permissão de cobrar, as ações não renderizam; a leitura fica." },
    ],
  },
];
