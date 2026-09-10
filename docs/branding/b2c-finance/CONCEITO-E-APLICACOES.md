# B2C Finance — Clareza em movimento

Uma marca de produto que transforma complexidade financeira em uma experiência organizada, próxima e legível.

## O conceito

O símbolo reúne dois caminhos arredondados que sugerem a letra F e um fluxo contínuo. A repetição das curvas constrói a linguagem de banners, ilustrações e carregamento. O azul mantém a conexão visual com a agência; o desenho aberto e a tipografia menos condensada dão ao produto uma presença própria.

**Marca principal:** B2C Finance. **Assinatura institucional:** “Um produto B2C Gestão”. **Assistente:** “Assistente B2C”. A assinatura institucional deve ser texto separado em rodapés, e-mails e documentos, sem reduzir a logo para acomodar um slogan.

Este é um conceito novo para o produto, baseado na referência da agência e no estudo fornecido. Não é uma reprodução vetorial da logomarca antiga. A proposta não altera os arquivos da agência nem o sistema em produção.

## Comece por aqui

- `00-conceito.png`: prancha da identidade, com uma aplicação conceitual da interface.
- `00-catalogo.png`: catálogo das imagens raster de apoio.
- `01-marca/`: logos em curvas, transparentes, prontas para aplicação.
- `manifest.json`: inventário dos ativos de produção e suas dimensões.
- `11-integracao/`: variáveis CSS e exemplo de manifesto PWA.

Os arquivos `light` são para fundos claros; os `dark`, para fundos escuros. Nas logos, isso identifica o **fundo de destino**, não a cor do arquivo. Banners, cards e painéis de acesso têm fundo próprio. Logos, símbolos e ilustrações 4:3 têm fundo transparente. Avatares e ícones de aplicativo possuem fundo.

## Paleta

| Papel | Claro | Escuro |
|---|---|---|
| Marca / ação | #216FD3 | #80B4FF |
| Texto principal | #142B45 | #F2F6FD |
| Texto secundário | #60738B | #A4B6CE |
| Fundo da página | #F5F8FC | #0B192B |
| Superfície | #FFFFFF | #10253E |
| Área ilustrada suave | #E9F1FC | #172F4E |
| Linha decorativa | #B4CDED | #365477 |

O azul institucional proposto foi harmonizado visualmente com a referência fornecida. Para botões claros, usar texto branco no azul; no tema escuro, texto #0B192B no azul luz. As linhas suaves das ilustrações são decorativas: bordas de campos e controles usam tokens de maior contraste no CSS.

Verde indica recebido/concluído, vermelho indica atraso/erro e âmbar indica atenção. Sempre combinar cor com rótulo, ícone ou outra informação textual. Não usar o azul para substituir esses significados. Gráficos categóricos podem usar azuis e violeta; valores positivos/negativos preservam sua semântica.

## Tipografia e componentes

A assinatura foi desenhada a partir de Avenir Next Demi Bold e convertida em curvas. Seus SVGs não dependem da instalação de fontes. Para a interface, usar a pilha nativa `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`: não é necessário distribuir uma fonte. Textos na prancha são ilustrativos.

Títulos: 24–32 px, peso 600, entrelinha 1,2. Subtítulos: 18–20 px. Corpo: 14–16 px, entrelinha 1,5. Rótulos auxiliares: 12–14 px. Valores monetários: algarismos tabulares, alinhados à direita em tabelas. Não truncar títulos necessários para entender um indicador.

Usar escala de espaçamento 4/8/12/16/24/32/48 px. Campos e botões: raio 8 px; cards: 12 px; painéis ilustrados: 20–24 px. Ícones funcionais: grade 24 px, traço 1,7 px. Alvos de toque propostos: pelo menos 44 × 44 px. Manter foco de teclado visível.

## Regras da marca

A logo horizontal possui prancheta 4:1. Não esticar, reordenar, inclinar ou mudar os caminhos internos. Manter área livre externa mínima equivalente a 1/4 da altura da prancheta. Usar `object-fit: contain` e preservar a proporção.

Desktop: logo completa a 160 × 40 px; menu até 180 × 45 px. Mobile: a versão compacta usa **símbolo + B2C**, com nome acessível “B2C Finance”, dentro de 112 × 28 px. Ela é uma assinatura curta, não uma redução da composição inteira. No menu mobile, usar a logo completa a 160 × 40 px.

Símbolo isolado: 28–40 px. Favicons têm versões próprias para 16/32/48 px. Para fundo azul institucional, usar `logo-branco`; para fundo escuro neutro, usar `logo-horizontal-dark`. Não colocar a marca diretamente sobre detalhes da ilustração.

## Entregáveis e dimensões

| Pasta / aplicação | Produção | Exibição sugerida |
|---|---|---|
| Logo horizontal e monocromática | SVG + PNG 640 × 160 | 160 × 40; menu 180 × 45 |
| Logo compacta | SVG + PNG 448 × 112 | 112 × 28 |
| Símbolo | SVG + PNG 512 × 512 | 28–40 px |
| Favicons | SVG automático, PNG 16/32/48 e ICO | 16/32 px |
| Aplicativo | PNG 180, 192, 512; maskable SVG/PNG 512 | Conforme plataforma |
| Estados vazios e páginas de sistema | SVG + WebP 800 × 600 | 240 × 180 ou 160 × 120 |
| Avatar IA | SVG + PNG 256 × 256 | 48–64 ou 40–48 px |
| Abertura do assistente | SVG + WebP 800 × 600 | 240 × 180 ou 160 × 120 |
| Boas-vindas desktop | SVG + WebP 2400 × 400 | 1200 × 200 |
| Boas-vindas mobile | SVG + WebP 1080 × 360 | 342 × 114 |
| Faixa de e-mail | SVG + PNG + WebP 1200 × 400 | 600 × 200 ou 324 × 108 |
| Login/recuperação desktop | SVG + WebP 1200 × 1500 | Painel 4:5 |
| Login/recuperação mobile | SVG + WebP 1080 × 360 | Painel opcional 3:1 |
| Cards ajuda/apresentação | SVG + WebP 960 × 540 | 320 × 180 ou largura disponível |
| Usuário e cliente — placeholders | SVG + PNG + WebP 256 × 256 | 32–64 px |
| Ícones funcionais | 18 desenhos × 2 temas, SVG 24 × 24 | 20–24 px |
| Carregamento | SVG animado 112 × 112 | 28–40 px |
| Prévia de link | SVG + PNG 1200 × 630 | Open Graph |

Todas as famílias de ilustração, banner, card, avatar e acesso possuem temas claro e escuro. O ícone do aplicativo e a prévia social têm uma aplicação institucional única. O carregamento respeita a preferência de movimento reduzido.

## Como aplicar por ambiente

| Ambiente | Direção |
|---|---|
| Cabeçalho, menu e navegação | Marca no topo; seção ativa em azul. Preservar ícones funcionais na navegação inferior. |
| Visão geral | Faixa opcional com texto HTML à esquerda e grafismo à direita. Omitir no celular se atrasar a chegada aos indicadores. |
| Dia/semana | Componentes e títulos consistentes; `rotina-concluida` somente quando não houver pendências. |
| Carteira, avaliação e retenção | Sem imagens entre filtros e tabelas; placeholders de cliente apenas onde houver suporte a avatar. |
| Ficha/cadastro | Foto/logo real do cliente; placeholder quando ausente. Não adicionar ilustração ao formulário mobile. |
| Recebimentos, fila, inadimplência, contas e folha | Valores e vencimentos prioritários; `sem-dados` apenas em estado realmente vazio. |
| Fechamento, fotografia do mês, histórico, fluxo, DRE, impostos, rateio e conciliação | Usar títulos, legendas, ícones e cores consistentes. Fotografia do mês é um retrato dos dados. |
| Comercial, leads, upsell e renovações | `funil` e `leads` em áreas vazias; sem ilustração de fundo nos quadros preenchidos. |
| Contratos, serviços e planos | Logo nos documentos; `contratos` em vazio. Card 16:9 apenas em futura apresentação por cards. |
| Assistente | Avatar nas respostas; `assistente-inicial` na abertura. Texto explica a ação possível. |
| Relatórios | Cabeçalho com logo, título e período; rodapé com produto e página. Sem imagem atrás de tabelas. CSV permanece textual. |
| Configurações/importação/notificações | `importacao`, `notificacoes` e `sem-dados` conforme o estado. |
| E-mails | Logo PNG transparente, botão azul, faixa opcional e assinatura “B2C Finance · Um produto B2C Gestão”. |
| Login/recuperação | Logo acima do formulário. Painel 4:5 no desktop; mobile 3:1 opcional. |
| Erro/acesso/manutenção | Usar as ilustrações correspondentes com título, explicação e ação em HTML. |

Os 18 ícones são categorias visuais baseadas nos ambientes citados. Não são uma afirmação de correspondência individual com os 18 relatórios existentes, cujos nomes completos não foram fornecidos. Mapear cada relatório real ao ícone adequado durante a integração.

## Textos de apoio propostos

- Funil vazio: “Seu próximo negócio começa aqui.” Ação: “Adicionar oportunidade”.
- Leads: “Organize suas próximas conversas.” Ação: “Adicionar lead”.
- Contratos: “Seus contratos, reunidos em um só lugar.” Ação: “Criar contrato”.
- Reservas: “Planeje os próximos passos.” Ação: “Criar reserva”.
- Relatórios agendados: “Receba a visão certa, na hora certa.” Ação: “Agendar relatório”.
- Assistente: “Como posso ajudar com seu financeiro hoje?”
- Acesso negado: “Você não tem acesso a esta área.” Ação: “Voltar”.
- Manutenção: “Estamos preparando tudo para você voltar.” Evitar prometer horário sem previsão real.

Esses textos são sugestões editoriais. Usar apenas ações realmente disponíveis no produto. Títulos, botões e instruções permanecem fora das imagens. A prévia de link contém somente a marca como elemento gráfico.

## Integração e verificação

1. Copiar os ativos necessários para a pasta pública da aplicação. Evitar carregar todo o pacote.
2. Trocar variantes ao mudar o tema. Nas imagens de e-mail, preferir PNG e fundo de cabeçalho explicitamente claro; incluir texto alternativo “B2C Finance”.
3. Logos e ilustrações usam `contain`; banners já possuem composições independentes por proporção. No banner, manter texto no primeiro 40% da largura, com margem de 24 px no desktop e 16 px no celular. Limitar a uma chamada curta no mobile.
4. Ilustrações decorativas recebem `alt=""`. Estado vazio deve ser descrito em texto. O loader precisa de mensagem `role="status"` no HTML. Não usar somente o desenho para transmitir erro, êxito ou permissão.
5. Em relatórios/PDF/DOCX, aplicar a logo sem distorção. No rodapé, usar “B2C Finance · Um produto B2C Gestão” e paginação. Este pacote fornece a identidade e imagens; não inclui modelos de documentos preenchidos.
6. Validar a integração real em 360, 390, 768, 1024 e 1440 px, incluindo teclado, temas, títulos, tabelas e formulários. As telas não foram acessadas neste trabalho; a prancha é uma aplicação conceitual, e não prova de integração.

Os arquivos raster foram verificados quanto a abertura e dimensões; as logos foram inspecionadas também em tamanho de uso. O registro técnico está em `VERIFICACAO.json`. O estudo fornecido orientou o escopo, mas não foi tratado como acesso ao sistema.
