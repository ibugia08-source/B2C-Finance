# Plano de Contas Gerencial — B2C Finance (proposta · 2026-07-20)

Resultado da auditoria contábil: o que existe hoje, o que falta, e o plano de
contas proposto para organizar lançamentos. **Nada disto foi implementado ainda**
— este documento é a base de decisão (§11-12 da auditoria).

## 1. O que existe hoje (6 eixos paralelos e desconectados)

| Eixo | Onde | Estado |
|---|---|---|
| `Category` (model, árvore parent/children, cor) | Transaction.categoryId?, Income.categoryId?, CategorizationRule | **Órfã do fluxo principal**: o form de Despesas NÃO tem campo categoria; relatórios não agrupam por ela; é GLOBAL (sem ownerId, name @unique global) |
| `Transaction.expenseType` (enum: FIXED, VARIABLE, PAYROLL, TAX, TOOL, ADS, LOAN, CARD, OTHER) | Despesas | **É o plano de contas de fato para saídas** — fechado (só migration edita), plano, sem hierarquia |
| `Billing/Income.revenueType` (enum: MRR, TCV, ONE_TIME, SETUP, RECOVERY, OTHER) | Receitas | Plano de contas de fato para entradas |
| `CashBox.type` (string: PERSONAL, EMERGENCY, INVESTMENT, COMPANY, GOAL, OTHER) | Caixa | Classifica reservas |
| `belongsTo` (pessoal/empresa/terceiro/familiar) + `origin` (pix/cartão/…) | Transaction | Eixos ortogonais |
| `Service.category` (string livre) | Serviços | Livre, sem padrão |

- **CostCenter foi REMOVIDO** (migration 20260706 remove_cost_center).
- **Não existe** ChartOfAccounts / ManagementAccount.
- Seed de Category: 16 categorias globais que misturam eixos (Pessoal/Empresa =
  belongsTo; Carro/Ferramentas = natureza; Reserva = destino) — precisa limpeza.
- Casos frágeis: folha vira despesa via string (`expenseType:"PAYROLL"`,
  `status:"pago"`); a Rotina detecta despesa crítica por regex no texto
  (`/imposto|folha|das|fgts|inss/`), não por conta.

## 2. Diagnóstico

1. Duplicadas: Category("Tráfego Pago") ≈ expenseType ADS; Category("Ferramentas")
   ≈ TOOL; Category("Investimentos") ≈ CashBox INVESTMENT.
2. Ambíguas: "Pessoal/Empresa/Família/Terceiros" como Category (é belongsTo);
   "Reembolsável"/"Dívida a Receber" como Category (é status/fluxo).
3. Renomear/extinguir no seed: as 6 acima saem do plano de contas.
4. Faltam: impostos detalhados (DAS/ISS/contab.), administrativas (aluguel/
   energia/internet), marketing próprio vs verba repassada, comissões, pró-labore,
   retiradas/distribuição, ajustes/estornos/transferências.

## 3. Plano de contas gerencial proposto (nível agência, simples)

```
1. Receitas operacionais            → já coberto por RevenueType
   1.1 Receita MRR                     (MRR)
   1.2 Receita TCV                     (TCV)
   1.3 Setup / implantação             (SETUP)
   1.4 Serviço pontual / avulso        (ONE_TIME)
   1.5 Recuperação de inadimplência    (RECOVERY)
   1.6 Receita de upsell               (módulo Upsell)
2. Receitas extras manuais          → ExtraRevenue MANUAL + Income avulsa
   2.1 Receita extra avulsa · 2.2 Reembolso recebido · 2.3 Ajuste positivo
3. Custos diretos de operação
   3.1 Verba de tráfego repassada · 3.2 Criativos terceirizados · 3.3 Freelancer
   3.4 Comissão comercial · 3.5 Comissão de renovação/upsell
4. Folha de pagamento               → Payroll/PayrollItem (ponte p/ despesa)
   4.1 Salários · 4.2 Pró-labore · 4.3 Ajuda de custo · 4.4 Comissões equipe
   4.5 Bonificações · 4.6 Encargos · 4.7 Benefícios
5. Ferramentas e softwares
   5.1 CRM · 5.2 Automação · 5.3 WhatsApp/API · 5.4 Hospedagem · 5.5 Domínios
   5.6 IA · 5.7 Design · 5.8 Gestão de projetos · 5.9 Contabilidade/financeiro
6. Marketing e vendas da agência
   6.1 Tráfego próprio · 6.2 Captação de leads · 6.3 Conteúdo · 6.4 Eventos
7. Despesas administrativas
   7.1 Aluguel · 7.2 Energia · 7.3 Internet · 7.4 Telefone · 7.5 Escritório
   7.6 Transporte · 7.7 Alimentação · 7.8 Outras
8. Impostos e contabilidade
   8.1 DAS/Simples · 8.2 ISS · 8.3 IRPJ/CSLL · 8.4 PIS/COFINS
   8.5 Honorários contábeis · 8.6 Taxas bancárias · 8.7 Multas e juros
9. Financeiro e dívidas
   9.1 Empréstimos · 9.2 Parcelamentos · 9.3 Juros · 9.4 Fatura de cartão
   9.5 Tarifas · 9.6 Antecipações
10. Caixa e reservas                → CashBox
   10.1 Caixa operacional · 10.2 Reserva de emergência · 10.3 Reserva impostos
   10.4 Reserva folha · 10.5 Investimento · 10.6 Retirada de sócios
   10.7 Distribuição de lucro
11. Investimentos da empresa        → Asset (hoje quase sem uso)
   11.1 Equipamentos · 11.2 Treinamentos · 11.3 Consultorias · 11.4 Software
12. Ajustes e transferências
   12.1 Transferência entre contas · 12.2 Ajuste +/− · 12.3 Estorno
   12.4 Reembolso pago · 12.5 Reclassificação
```

## 4. Modelagem sugerida (fase futura — NÃO criar sem aprovação)

Aproveitar a infraestrutura hierárquica que a `Category` já tem, em vez de criar
model paralelo — MAS resolvendo multi-tenant e o vínculo com o fluxo real:

**Opção A (recomendada): evoluir `Category` para conta gerencial**
1. Adicionar a Category: `ownerId String?` (+ trocar `@unique(name)` por
   `@@unique([ownerId, name])`), `code String?` ("5.4"), `accountType` (enum com
   os 12 grupos acima), `isActive`.
2. Seed por owner com o plano acima (backfill: duplicar p/ cada usuário e
   re-apontar transações; remover as 6 categorias-eixo do seed antigo).
3. Ligar ao fluxo real: campo categoria no form de **Despesas** (obrigatório, com
   default por `expenseType` → mapa expenseType→conta), em **Receita Extra** e
   opcional em Billing. Relatório "Despesas por conta gerencial" no registry.
4. Manter `expenseType`/`revenueType` como estão (viram o "grupo" da conta; sem
   migration destrutiva).

**Opção B: model novo `ManagementAccount`** (como no spec §11) — mais limpo
porém exige migrar Category → nova tabela e re-apontar FKs. Só vale se quisermos
aposentar Category de vez.

## 5. Como as contas alimentam os módulos

- **Despesas**: select de conta no form; card e tabela agrupáveis por conta.
- **Receitas/Receita Extra**: conta default por revenueType; extra manual escolhe.
- **Dashboard**: "Despesas por categoria" passa a agrupar por conta gerencial.
- **Caixa**: CashBox.type mapeado ao grupo 10.
- **Relatórios**: novo relatório DRE gerencial (grupos 1-9 → resultado).
- **Rotina**: prioridade "crítica" por conta (grupos 4 e 8) em vez de regex.

## 6. Riscos de migração (por que não fazer automático)

1. Category é global: dar ownerId exige duplicar categorias por usuário e
   re-apontar Transaction/Income/Rule existentes.
2. Float→Decimal pendente no núcleo (Transaction/Income/CashBox) — o plano de
   contas soma dessas tabelas; ideal migrar tipos antes/junto.
3. FK obrigatória em dados legados → precisa conta "Não classificado" + job de
   reclassificação (aproveitar CategorizationRule).
4. Ponte folha→despesa por string: mudar convenções quebra o reconhecimento.
5. Models mortos (Loan/ImportTemplate/ExportReport/FinancialAlert) devem sair
   ANTES para não poluir a migração.
