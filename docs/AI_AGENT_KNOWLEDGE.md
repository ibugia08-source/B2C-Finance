# Base de conhecimento do Agente B2C Finance (RAG)

Este guia explica **o que entra** na base de conhecimento do agente, **como indexar** no n8n e **como manter**.

## 1. O princípio

> **RAG = conhecimento e documentação.**
> **API = dados atuais e verdade operacional.**

A base de conhecimento responde "o que é", "como funciona", "por que foi recusado" e "qual é a regra". Ela **nunca** é fonte de:

- saldo atual;
- MRR atual;
- cliente ativo hoje;
- recebimentos;
- despesas;
- status atual;
- inadimplência.

Esses valores vêm **sempre** das ferramentas de consulta da API.

O princípio é garantido em quatro camadas:

| Camada | Como garante |
|---|---|
| **Documentos** | Só entra documento com o cabeçalho `rag: true` e `dados_atuais: nao`. O gerador recusa o resto, e documentos com números reais de uma data estão na lista `neverIndex`. |
| **Trechos** | Cada trecho começa com `[Conhecimento B2C Finance — conceito/regra, não dado atual]`, seguido do documento e da seção. |
| **Ferramenta** | A descrição de `consultar_conhecimento` diz ao modelo que ela nunca serve para número ou situação atual. |
| **Prompt** | Os princípios 2 e 3 de [`AI_AGENT_SYSTEM_PROMPT.md`](AI_AGENT_SYSTEM_PROMPT.md) separam as duas fontes. Se parecerem divergir sobre um número, vale a API. |

## 2. O que é indexado

A lista fica em `integrations/n8n/knowledge/manifest.json`:

| Documento | Conteúdo | Seções excluídas |
|---|---|---|
| [`AI_AGENT.md`](AI_AGENT.md) | O que o agente faz, as duas fontes, confirmação de escrita, limites | — |
| [`METRICAS_FINANCEIRAS.md`](METRICAS_FINANCEIRAS.md) | Fórmulas oficiais das métricas | Funções legadas, divergências conhecidas (nota interna de desenvolvimento) |
| [`REGRAS_MRR_TCV.md`](REGRAS_MRR_TCV.md) | MRR, TCV, outros tipos de receita, totais do mês, renovação | — |
| [`ARQUITETURA_FINANCEIRA.md`](ARQUITETURA_FINANCEIRA.md) | De onde vem cada número | Divergências conhecidas |
| [`STATUS_TEMPORAL_CLIENTES.md`](STATUS_TEMPORAL_CLIENTES.md) | Status do cliente com vigência | Migração (backfill) e testes |
| [`PLANO_DE_CONTAS.md`](PLANO_DE_CONTAS.md) | Plano de contas vigente e como os fatos viram lançamentos | — |
| [`POLITICAS_INTERNAS.md`](POLITICAS_INTERNAS.md) | Regras que o sistema aplica: fechamento, status, pagamentos, despesas, upsell, permissões, privacidade | — |
| [`API.md`](API.md) | Contrato da API, filtros, escritas, identidade | Implementação |

**Nunca indexados** (`neverIndex`):

- **Números reais de uma data:** diagnóstico e auditorias.
- **Proposta substituída:** `PLANO_DE_CONTAS_GERENCIAL.md`.
- **O próprio prompt do agente.**
- **Este guia.**
- **Autenticação e ambientes.**

O motivo é o mesmo em todos: o agente os leria como fato atual.

## 3. Como o pacote é gerado

```
npm run n8n:build
```

1. `integrations/n8n/scripts/build-knowledge.mjs` lê o manifesto e cada documento.
   - Confere o cabeçalho de cada um.
   - Divide por seção (`##` e `###`), com no máximo 1800 caracteres por trecho.
   - Tabela longa é quebrada repetindo o cabeçalho.
   - Recusa trecho com cara de segredo, usando os mesmos padrões do `n8n:check`.
2. Grava `integrations/n8n/knowledge/b2c-finance-knowledge.json`.
   - Traz os documentos (com sha256), os trechos (texto + metadados) e uma **versão**.
   - A versão muda sempre que qualquer trecho muda.
3. Os workflows são gerados com a mesma coleção, o mesmo modelo de embedding e as mesmas dimensões do pacote.

O teste `tests/integracao-n8n.test.ts` falha se o pacote versionado estiver diferente do que o gerador produz. Documento editado sem rodar o build **não passa no CI**.

O pacote é servido pela API em **`GET /api/v1/knowledge/documents`** (scope `knowledge.read`). É a mesma documentação para qualquer workspace: nenhum dado de cliente passa por aqui.

## 4. Mecanismo escolhido no n8n: Qdrant

| Decisão | Motivo |
|---|---|
| **Vector store: Qdrant** (nó nativo do n8n) | Serviço dedicado, separado de qualquer banco de dados. Funciona com Qdrant Cloud ou self-hosted, ao lado do n8n. |
| **Nunca o banco do B2C Finance, nem o Supabase** | O agente não acessa banco. Misturar a base de conhecimento com a base operacional abriria esse caminho. |
| **Embeddings: OpenAI `text-embedding-3-small`, 1536 dimensões, distância Cosine** | Mesma credencial "OpenAI" que o agente já usa. Indexação e consulta precisam do mesmo modelo e das mesmas dimensões, e os dois workflows saem do mesmo gerador. |
| **Coleção: `b2c_finance_conhecimento`** | Uma coleção só para isto. |
| **Consulta: 4 trechos (topK)**, com metadados | Documento, seção e fonte chegam ao agente junto com o texto. |

Alternativas também suportadas pelo n8n: Pinecone e PGVector num Postgres **dedicado**, que não pode ser o do B2C Finance. Trocar exige ajustar os dois workflows no gerador e os testes.

## 5. Como indexar (passo a passo)

1. **Qdrant:** crie um cluster (Qdrant Cloud) ou suba um Qdrant junto ao n8n. Anote a URL e a API key.
2. **Credencial no n8n:** tipo *Qdrant API*, com o nome **`Qdrant (conhecimento)`**, a URL e a API key.
3. **Variável no n8n:** `QDRANT_URL` com a mesma URL, usada pelo passo que apaga a coleção (ver `integrations/n8n/ENV.example`).
4. **Integração no B2C Finance:** em Configurações → Integrações, marque o scope **`knowledge.read`** na integração usada pelo n8n. O teste de conexão mostra `faltandoParaConhecimento`.
5. **Importe** `integrations/n8n/workflows/knowledge-ingest.json` e ligue as credenciais "B2C Finance API", "OpenAI" e "Qdrant (conhecimento)".
6. **Execute "Reindexar agora"**, que faz nesta ordem:
   1. lê o pacote na API;
   2. confere se o pacote é válido, e só então apaga a coleção (se a API falhar, a coleção atual fica intacta);
   3. grava um ponto por trecho.
7. **Confira o nó "Resumo da indexação":** `gravados` precisa ser igual a `trechosNoPacote`, e `versao` precisa ser a do pacote.
8. **No agente** (`b2c-finance-ai-agent.json`), ligue a credencial "Qdrant (conhecimento)" nos nós `consultar_conhecimento` e "Embeddings (conhecimento)".

> O agente só funciona com a base indexada e a credencial configurada: o n8n carrega todas as ferramentas ao iniciar cada resposta.

## 6. Quando reindexar

- Depois de mudar qualquer documento da lista e fazer o deploy (a versão do pacote muda).
- Depois de trocar o modelo de embedding. Aí gere os workflows de novo com `npm run n8n:build` e reimporte os dois.

Reindexar é sempre completo: apaga e grava de novo, sem risco de duplicar trechos.

## 7. Como incluir um documento novo

1. Escreva o documento **sem dados atuais**: nada de saldo, MRR do mês, nome de cliente real ou valores de uma data. Exemplos numéricos só se forem claramente exemplos.
2. Coloque o cabeçalho:
   ```
   ---
   rag: true
   titulo: …
   categoria: …
   atualizado_em: AAAA-MM-DD
   dados_atuais: nao
   ---
   ```
3. Acrescente o documento em `integrations/n8n/knowledge/manifest.json`, com `excludeSections` se houver notas internas.
4. Rode `npm run n8n:build`, os testes, o commit e o deploy. Depois reindexe no n8n.

## 8. Como testar

Pergunte pelo WhatsApp (ou pela execução manual no n8n):

| Pergunta | Esperado |
|---|---|
| "O TCV é rateado pelos meses do contrato?" | `consultar_conhecimento`; resposta: não, entra cheio no mês da entrada. |
| "Qual a diferença entre vencido e inadimplente?" | `consultar_conhecimento` (políticas). |
| "Por que não consigo lançar em agosto?" | `consultar_conhecimento` (competência fechada) e, se preciso, a API para ver o mês. |
| "Qual o MRR de setembro?" | **`consultar_dashboard`**, nunca a base de conhecimento. |
| "A Face Love está ativa?" | **`buscar_clientes` → `consultar_cliente`**, nunca a base. |
| "Qual a multa por atraso?" | "Isso não está definido no B2C Finance", sem inventar regra. |

## 9. Verificação feita na entrega

Teste de ponta a ponta no n8n 1.123.82 com um Qdrant 1.19 local (IA e embeddings simulados, sem modelo real):

- a indexação gravou os 87 trechos com metadados (1536 dimensões, Cosine);
- a segunda execução manteve 87 (sem duplicar);
- no agente, a pergunta sobre rateio de TCV chamou `consultar_conhecimento`, e o primeiro trecho devolvido foi "TCV — contrato de valor fechado", do documento de regras MRR/TCV.
