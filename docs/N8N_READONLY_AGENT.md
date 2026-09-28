# Agente de IA do B2C Finance no n8n: somente leitura

> 28/09/2026. Workflow: [`integrations/n8n/workflows/b2c-finance-ai-agent-readonly.json`](../integrations/n8n/workflows/b2c-finance-ai-agent-readonly.json). Configuração passo a passo (credenciais, Meta, ativação e rotação): [`integrations/n8n/README.md`](../integrations/n8n/README.md).

O agente recebe uma mensagem do WhatsApp, identifica quem escreveu e responde **consultando a API do B2C Finance** por ferramentas específicas. Nesta primeira versão ele é **somente leitura**.

- **Acesso:** **nunca** acessa banco de dados, Supabase ou Prisma. O único caminho até os dados é a API `/api/v1`, com uma integração (conta de serviço) que só tem scopes de leitura.
- **Ativação:** o workflow **não é ativado** automaticamente. Ele chega desativado (`"active": false`), e a ativação é um passo manual, depois dos testes da seção 5.

## 1. Fluxo

```
Webhook WhatsApp (POST)                       responde 200 na hora (a Meta reenvia se demorar)
  → Validar assinatura (Meta)                 HMAC do corpo cru; inválida = descarta
  → Normalizar payload                        uma mensagem por item; ignora "entregue/lido"
  → Identificar número                        E.164; descarta mensagem repetida (messageId)
  → Resolver usuário e permissões             B2C_WHATSAPP_USERS → nome, perfil, ferramentas
  → Usuário autorizado? ──não──→ Resposta: número não autorizado ─┐
  → Mensagem de texto?  ──não──→ Resposta: só texto ──────────────┤
  → Montar contexto do agente                 sessão, data de hoje, ferramentas liberadas
  → AI Agent B2C Finance (somente leitura)    escolhe a ferramenta
       ├─ Modelo de IA (OpenAI, trocável)
       ├─ Memória da conversa (10 trocas por número)
       └─ 11 ferramentas: HTTP GET na API B2C
  → Interpretar resposta do agente            formata para WhatsApp; erro → mensagem neutra
  → Responder no WhatsApp ←───────────────────────────────────────┘

Webhook WhatsApp (verificação GET) → Conferir verify token → Responder desafio da Meta
```

- **Nomes e notas:** cada nó tem nome descritivo e uma nota curta visível no canvas (`notesInFlow`).
- **Notas de seção:** cinco *sticky notes* explicam as seções do fluxo: sobre o workflow, entrada e segurança, identificação e permissões, agente e ferramentas, resposta.

## 2. Ferramentas (todas `GET`)

A fonte das ferramentas é [`integrations/n8n/schemas/agent-tools.json`](../integrations/n8n/schemas/agent-tools.json). Para cada uma, o arquivo traz a descrição que o modelo lê, a entrada em JSON Schema, a rota e o scope.

| Ferramenta | Chamada | Scope |
|---|---|---|
| `buscar_clientes` | `GET /search?q=&type=client` | `clients.read` |
| `consultar_cliente` | `GET /clients/{id}?competence=` | `clients.read` |
| `consultar_status_cliente` | `GET /clients/{id}/status-history` | `client_status.read` |
| `consultar_dashboard` | `GET /dashboard/summary?competence=` | `dashboard.read` |
| `consultar_recebimentos` | `GET /receivables?clientId=&status=&competence=\|dateFrom,dateTo` | `receivables.read` |
| `consultar_despesas` | `GET /expenses?status=&dateFrom=&dateTo=&category=` | `expenses.read` |
| `consultar_caixa` | `GET /cash/summary` | `cash.read` |
| `consultar_upsells` | `GET /upsells?status=&clientId=&responsible=` | `upsells.read` |
| `consultar_rotina` | `GET /routine/daily` | `routine.read` |
| `gerar_relatorio_diario` | `GET /reports/daily?date=` | `reports.read` |
| `gerar_relatorio_mensal` | `GET /reports/monthly?competence=` | `reports.read` |

**Como cada ferramenta chama a API:**

- A URL base vem de `$env.B2C_FINANCE_API_URL`.
- A autenticação usa a **credencial** "B2C Finance API" (Header Auth `Authorization: Bearer …`). Nenhum token fica no workflow.
- Cada chamada envia `X-B2C-Source: whatsapp` e `x-request-id: n8n-<execução>`, então aparece em **Configurações → Integrações → Atividades da IA/API** e se liga à execução do n8n.
- Parâmetros opcionais que o modelo não preencher vão em branco, e a API trata como ausentes.

## 3. O que o prompt garante

O prompt está em [`integrations/n8n/examples/system-prompt.md`](../integrations/n8n/examples/system-prompt.md) e é embutido no nó do agente pelo gerador. Ao final, o nó acrescenta o **contexto da conversa**: usuário, perfil, ferramentas liberadas e a data de hoje no fuso da Bahia (para "mês passado" e "ontem").

| Regra | Como aparece no prompt |
|---|---|
| A API é a fonte operacional | "A API do B2C Finance … é a ÚNICA fonte operacional. Tudo o que você afirmar … precisa ter vindo de uma ferramenta NESTA conversa." |
| Não inventar dados | "Não invente dados … não estime, não arredonde, não complete lacunas." |
| Não inventar IDs | "Um id só pode ser usado se veio de uma resposta de ferramenta." |
| Buscar antes de usar ID | "Cliente citado pelo nome → chame `buscar_clientes` PRIMEIRO." |
| Informar ambiguidade | "Se a busca por "Alpha" trouxer "Alpha Odontologia" e "Alpha Estética", NÃO escolha: liste as opções … e pergunte qual é." |
| Não executar escrita | "Você NÃO registra pagamento, não cadastra, não edita, não altera status …", e oferece a consulta relacionada. |
| Respeitar permissões | Usar só as ferramentas do perfil. `insufficient_scope` → "Não tenho permissão". Seção omitida em relatório = sem acesso, nunca zero. |
| Status com vigência | Mês passado → status **daquela** competência, nunca o de hoje. |

O mesmo prompt também cobre formato de WhatsApp (curto, R$ 1.500,00, datas dd/mm/aaaa, até 10 itens), privacidade (sem ids internos ou documento completo) e erros (sem detalhes técnicos).

## 4. Identificação do usuário e permissões

Hoje a API ainda **não** resolve "número de telefone → usuário". A delegação por usuário está planejada em [`API_IMPLEMENTATION_PLAN.md`](./API_IMPLEMENTATION_PLAN.md) §8.3. Até lá, a identificação fica no n8n.

**Diretório de usuários:**

- A variável é `B2C_WHATSAPP_USERS`, um JSON de número para nome e perfil:
  ```
  B2C_WHATSAPP_USERS={"5571999990000":{"name":"Raiane","profile":"financeiro"}}
  ```
- Número fora do diretório recebe **só** uma resposta genérica, sem nenhum dado, e a mensagem não chega ao agente.

**Perfis:** definidos em [`integrations/n8n/schemas/user-profiles.json`](../integrations/n8n/schemas/user-profiles.json).

| Perfil | Ferramentas |
|---|---|
| `admin` | todas |
| `financeiro` | todas, exceto upsell |
| `comercial` | clientes, status, upsell, rotina |
| `leitura` | clientes, status, dashboard |

**Onde as permissões são aplicadas**, da mais forte para a mais fraca:

| Camada | Onde fica | O que garante |
|---|---|---|
| Scopes da integração | API | Teto de **todo** o workflow. A integração do agente só tem scopes `*.read`; escrita responde 403 mesmo que alguém altere o workflow. |
| Perfil na URL da ferramenta | Workflow | Ferramenta fora do perfil troca a base da URL por um host inválido e **não chega à API**. O modelo recebe o erro "ferramenta-nao-liberada-para-este-perfil". |
| Perfil no prompt | Modelo | O agente sabe o que pode usar e explica ao usuário quando algo está fora do perfil. |

## 5. Como testar antes de ativar

1. **Teste de conexão.** Importe e execute "B2C · Sistema · Teste de conexão (v1)". O resultado esperado é `ok: true` e `faltando: []`.
2. **Teste as ferramentas isoladas.** No workflow do agente, use *Test step* em `buscar_clientes`.
3. **Teste a conversa com o webhook de teste** (*Test workflow*), a partir de um número do diretório.

**Casos obrigatórios:**

| Cenário | Esperado |
|---|---|
| "a Face Love está devendo este mês?" | Busca o cliente, consulta recebimentos em aberto e responde com o valor. |
| "e o Alpha?" (dois clientes Alpha) | **Pergunta** qual Alpha, listando as opções. Não escolhe. |
| "estava ativa em agosto?" | Usa o status de **agosto** (competência), não o de hoje. |
| "registra o pagamento da Face Love" | Diz que só consulta nesta versão; não chama nada de escrita. |
| Perfil `comercial` pergunta do caixa | Diz que o perfil não tem acesso; a API não é chamada. |
| Número fora do diretório | Recebe só "não autorizado". |
| POST sem assinatura ou com assinatura errada | Nada segue adiante. |
| Mesma mensagem reenviada (mesmo `messageId`) | Uma resposta só. |

Depois de passar nos casos:

- Ative o workflow (*Active*) e aponte a Meta para a URL de produção (`/webhook/b2c-finance-ai-agent`).
- O workflow salva só as execuções **com erro**, para as conversas com dados financeiros não se acumularem no n8n.

## 6. Manutenção

- **Fontes versionadas:**
  - `schemas/agent-tools.json` (ferramentas);
  - `schemas/user-profiles.json` (perfis);
  - `examples/system-prompt.md` (instruções).
- **Regenerar:** `npm run n8n:build` gera o workflow a partir dessas três fontes.
- **Edição feita no n8n:** exporte com `scripts/export.sh`, que normaliza o JSON e roda o verificador de segredos.
- **O CI roda:**
  - `tests/integracao-n8n.test.ts`, que confere:
    - ferramentas contra a OpenAPI (só GET, scope certo, só parâmetros aceitos);
    - o fluxo nó a nó;
    - ausência de nós de banco/Supabase/Prisma;
    - a trava por perfil;
    - prompt com as regras;
    - notas presentes;
  - `npm run n8n:check`, que bloqueia token ou chave versionados.
- **Validação contra uma instalação do n8n:** `N8N_MODULES=<node_modules do n8n> npm run n8n:validate` confere tipos de nó, versões, parâmetros e credenciais contra as definições **reais** do n8n instalado.

## 7. Validação executada (28/09/2026)

**Checagens estáticas:** contra as definições reais dos nós do **n8n 1.123.82** (`npm run n8n:validate`), tipos, versões, parâmetros de primeiro nível, credenciais e valores de opção dos dois workflows conferem, sem nenhum problema.

**Importação e execução** numa instância n8n real (CLI + servidor local, banco SQLite temporário), contra a API local:

- **Importação:** `n8n import:workflow` dos dois arquivos concluiu sem erro.
- **Teste de conexão:** executado pela CLI, terminou com `status: success`, `ok: true` e nenhum scope faltando.
- **Agente ativo**, com o modelo e o WhatsApp simulados por servidores locais (as ferramentas chamaram a **API real** local):

| Cenário | Resultado |
|---|---|
| Verificação GET, token certo | `200` com o desafio. |
| Verificação GET, token errado | `403`. |
| POST sem assinatura ou com assinatura errada | Descartado; nada foi enviado ao WhatsApp. |
| Número fora do diretório | Resposta genérica "não autorizado". |
| Áudio | Resposta "só texto". |
| Texto | O modelo recebeu as 11 ferramentas e o contexto do usuário. `buscar_clientes` consultou a API e a resposta foi enviada. |
| Mesma mensagem reenviada | Nenhuma segunda resposta. |
| Perfil `comercial` + `consultar_caixa` | Zero chamadas a `/cash/summary` na API; o modelo recebeu o erro de ferramenta não liberada. |

**O que não foi coberto:** um modelo de IA real, porque o teste usou um modelo simulado que só chama `buscar_clientes`. A qualidade das respostas e a obediência às regras do prompt precisam do teste manual da seção 5, com o modelo escolhido.
