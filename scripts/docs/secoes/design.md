A identidade é o azul institucional `#216FD3` no tema claro e o azul-luz
`#80B4FF` no escuro, sobre tinta `#142B45` e papel `#F5F8FC`. O tema escuro
não é uma inversão automática: é uma paleta própria, com os mesmos papéis
semânticos e valores desenhados para fundo escuro.

## Arquitetura em duas camadas

1. **Escalas primitivas** (`--blue-*`, `--slate-*`) — nunca consumidas pela
   interface. Existem só para os tokens semânticos derivarem delas.
2. **Tokens semânticos** — o que a interface consome, sempre via Tailwind.

Nenhuma cor literal vive num componente. A trava `npm run lint:tokens`
fiscaliza isso com um teto que só pode descer.

## O trio de cada estado

Cada estado (sucesso, atenção, erro, informação) tem **três** papéis que não se
substituem:

| Token | Onde vale |
|---|---|
| `--x` | preenchimento sólido, traço, ícone |
| `--x-soft` | superfície suave de aviso |
| `--x-foreground` | tinta que só vale **sobre o preenchimento sólido** |
| `--x-ink` | tinta de texto sobre `soft`, canvas ou card |

Usar `foreground` fora do preenchimento sólido é o defeito que produziu um
aviso a 1,12:1 de contraste — texto branco sobre âmbar claro. O portão de
acessibilidade agora reprova esse par estruturalmente, além de medir o
contraste dos tokens nos dois temas.

## Números

Todo número financeiro usa a mono tabular: dígitos de largura fixa são o que
deixa uma coluna de valores comparável a olho. Negativo leva **sinal de
menos** e cor semântica, jamais parênteses.

## Vocabulário de estados

Uma tela vazia não é um beco. São sete estados, cada um com causa e próxima
ação:

| Estado | Quando |
|---|---|
| primeiro uso | nunca houve dado aqui |
| nenhum resultado | há dado; o filtro é que não achou |
| não configurado | falta configurar algo para a tela ter o que mostrar |
| não gerado | o dado depende de uma ação que ninguém executou |
| indisponível | a origem está desligada neste ambiente |
| sem permissão | existe, mas este usuário não pode ver |
| erro | falhou ao carregar; dá para tentar de novo |

## Acessibilidade

O alvo é **WCAG 2.2 AA**. O que uma máquina consegue conferir é conferido em
todo commit por `npm run audit:aa`: imagem sem alternativa textual, botão de
ícone sem nome acessível, clique sem alcance de teclado, contraste dos pares
de token nos dois temas e tinta de estado usada fora do lugar.

O que a máquina **não** cobre continua sendo validação com gente: sessão com
leitor de tela e navegação completa por teclado de ponta a ponta.
