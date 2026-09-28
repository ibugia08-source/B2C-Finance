# Relatórios diários do B2C Finance por WhatsApp (n8n)

> 28/09/2026. Workflows:
> - [`integrations/n8n/workflows/daily-morning-report.json`](../integrations/n8n/workflows/daily-morning-report.json) (manhã)
> - [`integrations/n8n/workflows/daily-evening-report.json`](../integrations/n8n/workflows/daily-evening-report.json) (noite)
>
> Credenciais, importação e WhatsApp: [`integrations/n8n/README.md`](../integrations/n8n/README.md).
>
> **Telegram (canal principal, 29/09/2026):** `telegram-daily-morning-report.json` e `telegram-daily-evening-report.json` usam a mesma consolidação, mas com destinatários pela preferência de cada vínculo e um relatório por pessoa, com o RBAC dela. Ver [`docs/TELEGRAM.md`](TELEGRAM.md) §12. Os relatórios por WhatsApp continuam disponíveis como canal opcional.

Dois workflows **somente leitura** mandam, no horário configurado, um resumo pelo WhatsApp:

- **Manhã:** o que vence e o que está atrasado.
- **Noite:** o que aconteceu no dia e o que ficou pendente.

Eles só consultam a API `/api/v1`. **Nunca** acessam banco, Supabase ou Prisma. Os dois chegam **desativados**.

## 1. Fluxo

```
Agendamento (cron por variável)   ┐
Executar agora (teste)            ┘→ Preparar data e destinatários
  → API: … (GETs; falha vira "não consegui consultar", nunca zero)
  → Consolidar dados          monta a MENSAGEM PADRÃO só com o que a API trouxe
  → IA organiza a mensagem    reescreve a padrão; temperatura 0
  → Validar mensagem          todo R$ citado pela IA precisa existir nos dados; senão → padrão
  → Um envio por destinatário → Enviar WhatsApp (texto ou modelo aprovado)
```

| Relatório | Chamadas | Seções (só quando houver dado) |
|---|---|---|
| **Manhã** | `GET /reports/daily?date=hoje` · `GET /routine/daily` · `GET /dashboard/summary?competence=mês` | Recebimentos previstos hoje · Recebido (hoje e no mês) · Vencidos · Despesas vencendo · MRR atual · Renovações do mês · Churn do mês · Prioridades de hoje |
| **Noite** | `GET /reports/daily?date=hoje` · `GET /routine/daily` | Ações executadas · Recebimentos · Despesas pagas · Clientes cadastrados · Status alterados · Upsells · Pendências |

## 2. Sem dado inventado

Três travas garantem isso:

1. **Mensagem padrão.** O nó "Consolidar dados" monta a mensagem **só** com o que a API devolveu.
   - Seção sem dado não aparece, sem "zero" e sem "nenhum".
   - Chamada que falhou vira "Não consegui consultar: …".
   - Seção sem permissão vira "Sem acesso a: …".
2. **Prioridades e recomendações só vêm dos dados.** As prioridades são as **ações da rotina** que a API calculou (`GET /routine/daily`). Sem ações, não há seção de prioridades, e o prompt da IA proíbe recomendações próprias.
3. **Validação do texto da IA.** A IA só **reorganiza** a mensagem padrão. O nó "Validar mensagem" extrai todo valor em R$ do texto dela e confere com os valores que existem nos dados.
   - Um valor desconhecido, uma falha da IA ou um texto longo demais faz o workflow enviar a **mensagem padrão**.
   - O motivo fica registrado na execução.

O relatório funciona **sem IA**: se o modelo estiver indisponível, a mensagem padrão sai do mesmo jeito.

## 3. Configuração

Todas as variáveis estão em [`integrations/n8n/ENV.example`](../integrations/n8n/ENV.example):

| Variável | Para quê | Padrão |
|---|---|---|
| `B2C_REPORT_RECIPIENTS` | Quem recebe (E.164 sem `+`, separados por vírgula). **Obrigatória**: vazia, a execução falha com mensagem clara e não envia nada. | — |
| `B2C_MORNING_REPORT_CRON` | Horário da manhã (cron) | `0 7 * * 1-6` (07:00, de segunda a sábado) |
| `B2C_EVENING_REPORT_CRON` | Horário da noite (cron) | `0 19 * * 1-5` (19:00, de segunda a sexta) |
| `B2C_REPORT_TIMEZONE` | Fuso da **data** do relatório ("hoje") | `America/Bahia` |
| `WHATSAPP_REPORT_MODE` | `text` ou `template` | `text` |
| `WHATSAPP_REPORT_TEMPLATE` / `_LANG` | Nome e idioma do modelo aprovado | — / `pt_BR` |

As outras variáveis são as mesmas do agente:

- `B2C_FINANCE_API_URL`, `WHATSAPP_API_URL`, `WHATSAPP_PHONE_NUMBER_ID`;
- as credenciais "B2C Finance API", "WhatsApp API" e "OpenAI".

**Scopes da integração:** `reports.read`, `routine.read`, `dashboard.read`, `receivables.read`, `expenses.read`, `clients.read` e `upsells.read`. Seção sem scope aparece como "Sem acesso a: …".

### Horário e fuso

Há **dois** fusos, e os dois vêm configurados para **America/Bahia** (UTC−3, sem horário de verão). É o mesmo fuso que a API usa para dias e competências.

| Fuso | Onde se configura | O que decide |
|---|---|---|
| Do **agendamento** | **Workflow → Settings → Timezone** (no JSON, `settings.timezone`) | Quando o cron dispara |
| Da **data do relatório** | `B2C_REPORT_TIMEZONE` | Qual é o "hoje" consultado na API |

- **Mantenha os dois iguais ao fuso do negócio.** Com fusos diferentes, o relatório das 07:00 poderia consultar o dia errado.
- **Se não houver fuso no workflow,** o n8n usa `GENERIC_TIMEZONE` da instância. Por isso ele vem definido no próprio workflow.
- **O cron segue o formato padrão:** `minuto hora dia-do-mês mês dia-da-semana`. Por exemplo, `30 7 * * 1-5` é 07:30 de segunda a sexta.

### WhatsApp: janela de 24 h

A Meta só entrega **mensagem livre** (`text`) a quem falou com o número da empresa nas **últimas 24 horas**. Para o relatório diário chegar sempre:

1. Crie na Meta um **modelo** de categoria *Utility*, com uma variável no corpo. Por exemplo: "Resumo do B2C Finance: {{1}}".
2. Aguarde a aprovação.
3. Defina `WHATSAPP_REPORT_MODE=template` e `WHATSAPP_REPORT_TEMPLATE=<nome do modelo>`.

A Meta não aceita quebra de linha em variável. No modo `template`, o workflow junta as linhas com " | " e limita o texto a 1000 caracteres.

## 4. Testar e ativar

1. **Importe os workflows e ligue as credenciais** (README §1–§4).
2. **Execute pelo gatilho manual.** Clique em **Execute workflow** a partir de **"Executar agora (teste)"**; não é preciso esperar o horário. Confira:
   - "Consolidar dados": a mensagem padrão e as seções;
   - "Validar mensagem": o campo `origem` vale `ia`, ou `padrao` com o motivo;
   - a mensagem que chegou no WhatsApp.
3. **Ative o workflow** (toggle **Active**). O cron passa a valer.

As execuções bem-sucedidas **não são salvas** (`saveDataSuccessExecution: none`), porque trazem dados financeiros. Só as com erro ficam, para diagnóstico.

## 5. De onde vem cada dado

- **Recebimentos previstos hoje:** cobranças com vencimento hoje e saldo em aberto.
- **Recebido:** pagamentos confirmados hoje e `recebido_competencia` do mês (motor de métricas).
- **Vencidos e prioridades:** a mesma fila da tela Rotina (`montarRotinaDoDia`).
- **Despesas vencendo:** pagamentos vencidos e dos próximos dias, também da rotina.
- **MRR e churn:** os indicadores oficiais do Dashboard (`computePeriodMetrics`).
- **Renovações:** as renovações pendentes do mês, também da rotina.
- **Despesas pagas no dia:** a despesa não guarda data de pagamento, então o dado vem da **trilha de auditoria** (status → pago, gravado pelo motor ao pagar).
- **Status alterados:** alterações **registradas** no dia, com a data de vigência de cada uma. O primeiro registro de um cliente cadastrado no mesmo dia é o status inicial do cadastro e não conta como alteração.
- **Clientes cadastrados:** clientes criados no sistema no dia.
- **Upsells:** oportunidades criadas e vendidas no dia.

## 6. Validação executada (28/09/2026)

**Checagens estáticas:**

- `npm run n8n:validate`: tipos de nó, versões, parâmetros e credenciais dos dois workflows conferem com as definições reais do **n8n 1.123.82**.
- `tests/integracao-n8n.test.ts`:
  - estrutura (cron por variável, fuso, só GET, desativado, notas);
  - execução do **código real** dos nós: consolidação da manhã e da noite, validação da IA, envio em texto e em modelo, e falta de destinatário.

**Execução num n8n real** (CLI + servidor local), contra a API local, com o modelo e o WhatsApp simulados:

| Cenário | Resultado |
|---|---|
| Manhã | As três chamadas responderam, a mensagem foi enviada aos dois destinatários e as seções sem dado foram omitidas. |
| Manhã com a IA **inventando** um valor (R$ 99.999,99) | A validação trocou pela mensagem padrão (`valores_nao_encontrados_nos_dados: 99.999,99`). |
| Noite | Seções de ações executadas, recebimentos, despesas pagas, clientes cadastrados, status alterados (vigência 01/10), upsells e pendências, com dados reais do dia. |
| Modo `template` | Payload de modelo aprovado numa linha só. |
| Sem `B2C_REPORT_RECIPIENTS` | Erro claro e nada enviado. |
| Agendamento ativo com o cron vindo da variável | O n8n disparou sozinho e enviou as mensagens. |

**Bug corrigido durante o teste:** `GET /routine/daily` respondia **500 a partir da segunda chamada**. A causa era que dado vindo de cache chega com a data como texto, e o serializador da API esperava um objeto de data. A correção vale também para o agente de WhatsApp.
