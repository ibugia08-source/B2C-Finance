## Os cinco portões

`npm run verify` roda todos, nesta ordem:

| Portão | Comando | O que pega |
|---|---|---|
| Lint | `npm run lint` | erro de estilo e padrão do Next |
| Tokens | `npm run lint:tokens` | cor literal escapando para um componente |
| Acessibilidade | `npm run audit:aa` | contraste, nome acessível, alcance de teclado |
| Build | `npm run build:ci` | tipos e empacotamento de produção |
| Testes | `npm test` | regressão de regra |

A ordem importa: os três primeiros são rápidos e pegam a maioria dos deslizes;
o build é lento e fica depois.

**O build pega o que nenhum outro pega.** Um módulo de server actions só pode
exportar função assíncrona — exportar uma constante dali compila, passa no
lint e passa em todos os testes, e só o `next build` reprova. Portão que não
roda não protege.

## O que um teste guarda aqui

A suíte não persegue cobertura. Ela guarda **regra que já quebrou** ou que
custaria caro quebrar. Um teste bom neste repositório:

- reproduz o defeito com o dado real que o revelou — a data de renovação que
  aparecia como 29/09 num lugar e 30/09 em outro está lá, com esses números;
- explica **no próprio teste** por que o valor esperado é aquele, não só qual
  é. Quem ler daqui a um ano precisa entender a aritmética sem reabrir a
  discussão;
- falha por um motivo só.

## Prova de que o portão enxerga

Um portão que passa sem detectar nada é pior que nenhum: dá confiança falsa.
Ao criar ou alterar uma trava, o procedimento é reintroduzir o defeito de
propósito, confirmar que o portão reprova, e só então restaurar.

Foi assim que se descobriu que a auditoria de acessibilidade conferia apenas
seis pares de contraste e por isso deixou passar um aviso a 1,12:1.
