---
rag: true
titulo: Status do cliente com vigência
categoria: status-de-clientes
atualizado_em: 2026-09-28
dados_atuais: nao
---

# Status do cliente com vigência (status temporal)

Implantado em 26/09/2026. Código central: `src/lib/clients/status-history.ts`.
Migration: `prisma/migrations/20260926090000_status_temporal_clientes`.

## 1. O problema original

O status do cliente era um campo só, `Client.status`, e todo número histórico lia o status de **hoje**.

Exemplo: em Setembro/2026 o cliente Alpha está Ativo. Alguém abre Outubro/2026 e muda Alpha para Inativo. A partir desse momento:

- Setembro, Agosto e todo o passado passavam a mostrar Alpha como Inativo.
- Os "clientes ativos" e o MRR dos meses passados mudavam, e a lista da carteira também.
- Os relatórios de meses já fechados passavam a dizer outra coisa.

Havia exceções parciais, mas elas não resolviam o problema:

- O MRR de meses passados usava as datas de entrada e saída, sem histórico de pausa.
- `churnedAt` era apagado na reativação.

## 2. A regra nova

**O status tem vigência.** Toda mudança registra:

- o cliente e o novo status;
- o início da vigência, e o fim quando houver;
- quem registrou e quando;
- o motivo (opcional);
- o dono dos dados (`ownerId`).

Uma mudança em Outubro não reescreve Setembro.

| Conceito | Definição |
|---|---|
| **Status atual** | O intervalo que cobre **hoje**, no calendário da Bahia. |
| **Status histórico** | O intervalo que cobre a data consultada. |
| **Status da competência** | O status no **encerramento** do mês (último dia). Na competência em curso, o de **hoje**, porque o fim do mês ainda não chegou. |
| **Status futuro (programado)** | Um intervalo que começa depois de hoje. Não altera o status atual, a Rotina, o Dashboard de hoje, o MRR vigente nem a contagem de clientes de hoje. Aparece só em projeções e nos meses futuros. |

Exemplo de linha do tempo com reativação:

- Ativo de 10/01/2026 até 30/09/2026
- Inativo de 01/10/2026 até 31/10/2026
- Ativo a partir de 01/11/2026

Resultado por competência: Agosto e Setembro contam Ativo, Outubro conta Inativo, Novembro e Dezembro contam Ativo.

Mudança real no meio do mês (Ativo até 15/10, Perdido desde 16/10):

- A linha do tempo guarda a data exata.
- O encerramento de Outubro conta Perdido.
- Os fatos financeiros de Outubro continuam todos lá.

## 3. Fontes de verdade

| Estrutura | Papel | Mutável? |
|---|---|---|
| `ClientStatusHistory` | **Fonte temporal oficial.** São intervalos de datas civis `[effectiveFrom, effectiveTo]`, inclusivos. `effectiveTo` nulo significa "em diante". | Só pela camada central e pelos gatilhos. |
| `Client.status` | **Status vigente hoje, materializado.** Nunca é o status de um mês futuro. Continua existindo porque dezenas de telas de "hoje" o leem. | Pela transição do status atual. |
| `Snapshot` (fotografia do fechamento) | Fotografia imutável da competência fechada, formato 3. A área "carteira" traz o status de cada cliente na competência. | Não. É gerada no fechamento. |
| `ClientLoss` | O **fato** da perda: data, valor perdido, motivo e renovação frustrada. É gravado na data de vigência da saída. | Não é fonte de status. |
| `AuditLog` | Trilha de auditoria, com os campos `status_vigencia`, `status_programado` e `status_programado_cancelado`. | Só recebe novas linhas (append-only). |

Não foi criado um modelo de snapshot mensal por cliente. A fotografia de fechamento que já existia (`Snapshot`) passou a guardar o status da competência. Criar outro modelo seria manter duas fotografias concorrentes.

Também não foi criado um modelo de competência: o fechamento já existe em `ClosingPeriod`, com os estados OPEN, SOFT_CLOSED, CLOSED e REOPENED, versão e motivo de reabertura.

## 4. Integridade garantida pelo banco

- `CHECK (effectiveTo IS NULL OR effectiveTo >= effectiveFrom)`: um intervalo não pode terminar antes de começar.
- `EXCLUDE USING gist (clientId WITH =, daterange(effectiveFrom, effectiveTo, '[]') WITH &&) DEFERRABLE INITIALLY DEFERRED`: dois status válidos no mesmo dia não existem. Isso depende da extensão `btree_gist`.
  - Sem a extensão, a migration cria no lugar um índice único por (cliente, início) e um único intervalo em aberto por cliente.
- `clientId` é obrigatório e apagado em cascata junto com o cliente. `ownerId` é copiado do cliente.
- A tabela tem RLS ligado e está em `OWNED_MODELS`, de modo que as leituras pelo Prisma já saem filtradas por dono.
- Leitura em lote que encontre dois intervalos no mesmo dia registra um erro e deixa aquele cliente **sem status**. A leitura unitária (`statusAtDate`) lança `StatusTimelineConflictError`. Em nenhum caso o sistema escolhe um dos dois intervalos.

## 5. Escrita: um algoritmo, um lugar

O algoritmo de vigência mora **uma vez**, no banco:

- **`b2c_status_apply(cliente, status, D, ...)`**: aplica "status S a partir de D".
  1. O intervalo que cobre D é encerrado em D−1.
  2. S vale de D até a véspera da próxima mudança já registrada, que é preservada; se não houver próxima, vale em diante.
  3. Uma mudança no mesmo dia de outra substitui aquela.
  4. Intervalos vizinhos com o mesmo status são juntados.
  5. Um advisory lock por cliente impede que duas abas se atropelem.
- **`b2c_status_cancel(cliente, D)`**: remove a mudança que começa em D, e o intervalo anterior volta a cobrir o período dela.

Exemplo de reorganização: a linha do tempo é Ativo desde 01/01/2026, com Inativo programado para 01/10/2026. Depois se informa Pausado a partir de 01/09/2026. O resultado é:

- Ativo de 01/01 até 31/08
- Pausado de 01/09 até 30/09
- Inativo a partir de 01/10

A camada TypeScript (`changeClientStatus`) cuida do resto do fluxo, nesta ordem:

1. Valida a data e as permissões. Vigência **futura** exige `clientes.programar_status`. Vigência **retroativa**, antes do mês corrente, exige `clientes.alterar_status_retroativo`.
2. Verifica se a mudança atinge alguma **competência fechada**. O alcance vai de D até a véspera da próxima mudança; o futuro nunca está fechado.
3. Em **uma transação**: aplica a vigência, confere a integridade e grava a auditoria. Se algo falhar, a transação é desfeita por inteiro.
4. Se o **status vigente hoje** mudou, acompanha a transição com `sincronizarStatusAtual`: registra a perda, encerra ou reativa a relação e o termo, cancela as mensalidades futuras não pagas e atualiza `Client.status`. A data desses efeitos é o **início da vigência**, então uma perda retroativa a 01/09 é perda de Setembro.

### Caminhos antigos de escrita

Os gatilhos em `Client` garantem que nenhum caminho de escrita fique sem histórico:

- **Na inclusão:** o cliente nasce com linha do tempo. O status vale a partir da data de entrada, ou de hoje se não houver. Se for Perdido ou Inativo com data de saída, fica Ativo até a véspera da saída.
- **Numa troca de status** que não veio da camada central: a troca vale **a partir de hoje**. Se veio junto com a data de saída (`churnedAt`), vale a partir dessa data, limitada a hoje.
  - Isso cobre as ações do dossiê (pausar, retomar, reativar), a renovação e a importação.
  - A camada central marca a própria transação com `b2c.status_manual=1`, para o gatilho não duplicar o que ela já registrou.

### Alteração futura

- A alteração é registrada, mas não mexe no status atual.
- Quando a data chega, o **job diário** faz a troca:
  - A rota é `GET /api/cron/status-programado`, agendada no `vercel.json` para 03:10 UTC (00:10 na Bahia).
  - A função é `materializarStatusProgramados`, que é idempotente.
  - Ela roda a transição e atualiza `Client.status`.
- **Nada é gravado durante a leitura de uma página.**
- Se o job atrasar, as telas que leem a linha do tempo continuam certas. Só as telas que leem `Client.status` ficam um dia defasadas.
- Reserva manual: o botão "Aplicar alterações programadas vencidas", em Clientes → Histórico de status a revisar, aplica só os clientes do dono logado.
- Autenticação da rota:
  - Com a variável `CRON_SECRET` configurada, exige `Authorization: Bearer`, que é o que a Vercel envia.
  - Sem ela, aceita só requisições com o user-agent do cron da Vercel. **Recomendado configurar `CRON_SECRET`.**

### Cancelamento

- Só é possível antes da vigência: `cancelScheduledStatusChange`, ou o link "cancelar" no detalhe do cliente.
- O cancelamento fica registrado na auditoria (`status_programado_cancelado`).
- Exemplo: Ativo desde 01/01 com Inativo programado para 01/10. Cancelado em Setembro, volta a ser Ativo desde 01/01, em diante.

### Competência fechada

- A mudança é bloqueada com a mensagem: "Esta competência está encerrada. Para alterar informações históricas, é necessário reabrir o período."
- O fechamento é o que já existe: `ClosingPeriod`, com o evento `CLIENT_STATUS_CHANGED` classificado como ECONÔMICO em `src/lib/periods/events.ts`.
- Para alterar, é preciso reabrir o período com `fechamento.reabrir` e um motivo. A reabertura registra quem, quando, a competência e a versão. Com o período reaberto, a mudança passa.

### Permissões

As permissões usam o RBAC existente (`src/lib/permissions.ts`), sem sistema paralelo. O ADMIN continua com acesso total (`*`).

| Permissão pedida | Implementação |
|---|---|
| `clientes.alterar_status` | Já existia. |
| `clientes.programar_status` | **Nova.** Concedida por padrão a quem já tinha `alterar_status`. |
| `clientes.alterar_status_retroativo` | **Nova e sensível.** Por padrão, só GESTOR (e ADMIN). |
| `competencias.visualizar`, `competencias.fechar`, `competencias.reabrir` | Equivalem às permissões existentes `fechamento.*`. Não foram duplicadas. |

Usuários com lista de permissões personalizada não ganham as permissões novas automaticamente. Elas são concedidas em Configurações → Usuários.

## 6. Leitura: sempre em lote

Todas as leituras abaixo estão em `status-history.ts`:

| Função | O que faz |
|---|---|
| `getClientStatusAtDate` | Status de um cliente numa data. |
| `getClientStatusForCompetence` | Status de um cliente numa competência. |
| `getCurrentClientStatus` | Status atual de um cliente. |
| `getClientStatusTimeline` | Linha do tempo completa de um cliente. |
| `getStatusesAtDate` | Status de todos os clientes numa data, em uma consulta. |
| `getClientStatusesForCompetence` | Status de todos os clientes numa competência. |
| `getStatusesForCompetences` | Status numa janela de competências, em uma consulta para a janela toda. |
| `getActiveClientsForCompetence` e `getActiveClientsByCompetences` | Clientes ativos numa ou em várias competências. |
| `getClientsByStatusForCompetence` | Clientes agrupados por status numa competência. |
| `getNextScheduledStatusChange` e `getScheduledStatusChanges` | Próxima alteração programada, de um ou de vários clientes. |

"Ativo" é o status que gera receita: Ativo, Em renovação ou Inadimplente (`REVENUE_ACTIVE_STATUSES`).

Os helpers de competência ficam em `src/lib/competence.ts`:

- `getCompetenceKey`, `getStartOfCompetence`, `getEndOfCompetence`, `getPreviousCompetence`, `getNextCompetence`;
- `competenceReferenceDate`, `todayKey`, `addDays`.

As datas de vigência são a string `YYYY-MM-DD` (coluna `@db.Date`), sem hora e sem fuso. Por isso 01/10/2026 nunca vira 30/09/2026.

**Custo medido** (consultas por página, antes → depois; banco local com 266 clientes):

| Página | Antes | Depois |
|---|---|---|
| Clientes | 20 | 22 |
| Dashboard | 24 | 24 |
| Rotina | 18 | 18 |
| Recebimentos | 31 | 32 |
| Relatórios / Clientes | 21 | 22 |
| Projeções | 16 | 19 |

O custo é constante e não cresce com o número de clientes (sem N+1).

## 7. Integração por módulo

- **Clientes (`/clientes?mes=`):**
  - A lista, a coluna Status, o filtro de status e os KPIs usam o status **da competência**.
  - "Clientes ativos" são os ativos no encerramento. "Novos" são contados pela data de entrada; reativação não conta como novo. "Perdidos" são as perdas registradas com saída no mês (`ClientLoss`, a mesma fonte do Dashboard); quem hoje está Perdido não entra por isso.
  - A célula de status abre o diálogo "Alterar status", com novo status, início da vigência e motivo. A mensagem é "Esta alteração passará a valer a partir de Outubro/2026. Os períodos anteriores serão preservados."
    - Na competência em curso, a escolha entre "a partir de hoje" e "a partir do início da competência" é explícita.
    - Olhando outro mês, o diálogo sugere o dia 1º daquele mês.
  - Um cliente com alteração programada mostra a indicação "Programado: Inativo em 01/10/2026".
  - A ação em massa usa o mesmo diálogo, com a confirmação "Esta alteração será aplicada a N clientes…".
  - A edição do cadastro não troca mais o status.
- **Detalhe do cliente:**
  - Seção **Histórico de status**, com a linha do tempo, o status atual e a próxima alteração (que pode ser cancelada).
  - Aviso quando o histórico foi reconstruído sem data suficiente.
  - O seletor de status do cabeçalho virou o diálogo com vigência.
- **Dashboard:**
  - Clientes ativos, pausados, perdidos, MRR/TCV ativos, Pago/Devendo, ticket médio, custo por cliente e churn rate usam a carteira do **encerramento do período** (`getClientsBlock(period)`, `computePeriodMetrics`).
  - O MRR (card, série anual e pop-up) vem de `getActiveClientsByCompetences`.
  - Nos meses futuros da série, o MRR é **projetado** com as alterações programadas.
- **MRR:** são ativos na competência × mensalidade.
  - **Limitação conhecida:** o **valor** ainda é a mensalidade atual (`Client.monthlyValue`). O histórico de valor existe em `CommercialTerm`, mas trocar a fonte do valor é outra tarefa. O risco é um reajuste mudar o MRR de meses passados. O status, não.
- **TCV:** a regra não mudou. O TCV entra cheio no mês de entrada, fechamento ou renovação, pelas cobranças TCV da competência. Uma mudança posterior de status não o apaga.
- **Recebimentos:**
  - A geração das mensalidades do mês (`ensureMonthlyBillings`) e a lista de "sem cobrança" usam os ativos **da competência**.
  - Cobranças que já existem, vencidas, pagas depois ou de meses anteriores, aparecem sempre. Status não esconde nem apaga fatos financeiros.
- **Rotina diária:** usa o status vigente **hoje** (`Client.status`). Uma alteração programada não aparece antes da data.
- **Relatórios:**
  - O relatório Clientes (coluna e filtro de status) e o Executivo (clientes ativos e inadimplentes) usam o status no encerramento do período.
  - O checklist de fechamento, a grade de avaliações e a fotografia do fechamento usam a carteira da competência.
- **Projeções:** a seção "Carteira projetada" mostra o mês em curso (**Realizado**) e os próximos seis meses (**Projetado**, já com as alterações programadas), com clientes ativos, MRR e a quantidade de alterações programadas.
- **Renovações:** uma expectativa pendente só conta se o cliente estava na carteira viva (inclui Pausado) naquela competência.
- **Cache:** `revalidateClientStatus` invalida Agência, Projeções, Relatórios, Retenção, Avaliações, Fechamento e a página de revisão. O cache continua segmentado por dono (`ownerCached`).

## 8. Migração dos dados existentes (backfill)

A função é `b2c_status_backfill_client`, executada uma vez por cliente na migration. **Não inventa data.**

Evidências usadas, da mais forte para a mais fraca:

1. **Comprovado:**
   - a trilha de auditoria (`lifecycleStatus` da relação e o status do cliente);
   - as perdas registradas (`ClientLoss.lostAt`);
   - a data de saída (`Client.churnedAt`);
   - a data da pausa (`relação.pausedAt`);
   - o termo de reativação ou retomada (`CommercialTerm.validFrom`).
2. **Inferido:**
   - Ativo desde a data de entrada até a primeira mudança conhecida.
   - Perdido ou pausado **sem data**, mas com cobranças: ativo até o último mês cobrado e o status atual a partir do mês seguinte. É a mesma inferência que a Importação Total já fazia. Fica **marcado para revisão**.
   - Ativo **sem data de entrada**: ativo desde o cadastro no sistema. Fica **marcado para revisão**.
3. **Não determinável:** o status atual sem início conhecido passa a valer **a partir da data da migração** e fica marcado para revisão.
   - O período anterior fica **sem status** e não conta como ativo em nenhum mês. Para esses clientes isso já acontecia antes, porque o status de hoje era Perdido ou Pausado.

No banco de desenvolvimento, que tem o import real, o resultado foi:

| Grupo | Clientes | Resultado |
|---|---|---|
| Ativos com entrada | 133 | Inferidos, sem pendência. |
| Ativos sem entrada | 66 | Inferidos desde o cadastro, com revisão. |
| Perdidos sem data e sem cobranças | 58 | Não determináveis, com revisão. |
| Pausados sem data | 8 | Não determináveis, com revisão. |

Nenhum cliente ficou divergente do status atual.

**Relatório de revisão:** em `/clientes/historico-status`. A correção é feita no próprio cliente, com "Alterar status" e a data real (exige permissão retroativa e competência aberta).

## 9. Testes

| Arquivo | O que cobre |
|---|---|
| `tests/status-temporal-unitario.test.ts` | Regras puras:<br>• início e fim exatos da vigência;<br>• meses de 28, 29 (bissexto), 30 e 31 dias;<br>• fuso;<br>• mudança futura, retroativa, reativação, pausa, perda no meio do mês;<br>• intervalo intermediário;<br>• ausência de status;<br>• conflito de intervalos. |
| `tests/status-temporal.test.ts` | Fluxo real no banco:<br>• regressão Setembro × Outubro;<br>• programar, reorganizar e cancelar, com auditoria;<br>• integridade (EXCLUDE e CHECK);<br>• gatilho de inclusão;<br>• permissões: sem permissão, programar, retroativo, ADMIN;<br>• isolamento por dono;<br>• competência fechada, depois reaberta;<br>• MRR do mês atual × o seguinte;<br>• TCV preservado;<br>• novo cliente continua contado;<br>• pagamento tardio;<br>• geração de mensalidades;<br>• job diário: perda na data, idempotência;<br>• Rotina sem efeito antecipado;<br>• Dashboard, relatório, projeção e ação em massa;<br>• backfill com e sem evidências. |
