# FASE 4: Guia de Testes Manuais

**Objetivo:** Validar performance, responsividade, cache, e funcionalidade de forma interativa.

---

## 1. Performance Baseline (Chrome DevTools Lighthouse)

### 1a. Medir LCP, FCP, CLS

**Local Setup:**
```bash
npm run dev
# Abre em http://localhost:3000
```

**Medir Performance:**
1. Abrir `/clientes` (lista master)
2. Abrir Chrome DevTools (F12)
3. Ir para aba **Lighthouse**
4. Clicar **Generate report**
5. Aguardar conclusão (~30s)
6. Anotar métricas:

| Métrica | Target | Atual | Status |
|---------|--------|-------|--------|
| LCP (Largest Contentful Paint) | < 2.5s | ____ | [ ] |
| FCP (First Contentful Paint) | < 1.8s | ____ | [ ] |
| CLS (Cumulative Layout Shift) | < 0.1 | ____ | [ ] |
| TTFB (Time to First Byte) | < 0.6s | ____ | [ ] |

**Repetir para:**
- `/clientes/[id]` (layout + header)
- `/clientes/[id]?tab=recebimentos` (com tab lazy-loaded)

---

### 1b. Network Performance (DevTools Network Tab)

**Setup:**
1. Chrome DevTools → Network tab
2. Throttle: `Slow 3G` + `4x CPU throttle`
3. Disable cache (checkbox "Disable cache")

**Teste de Load:**
1. Carregar `/clientes` 
   - **Expected:** Load time < 1.5s
   - **Actual:** ____

2. Clicar em um cliente → `/clientes/[id]`
   - **Expected:** Load time < 2s (com layout + header)
   - **Actual:** ____

3. Navegar para aba `/clientes/[id]?tab=recebimentos`
   - **Expected:** Load time < 1.5s (lazy-loaded)
   - **Actual:** ____

---

## 2. Smoke Tests (Funcionalidade)

### 2a. Dados Principais

- [ ] Abrir `/clientes/[id]?tab=dados-principais`
- [ ] Verificar que renderiza nome, status, CNPJ, etc.
- [ ] Editar status via dropdown (ClientStatusSelect)
  - [ ] Status muda imediatamente
  - [ ] Página recarrega com novo valor (cache revalida)
- [ ] Verificar que contatos renderizam (se houver)

**Exemplo de Cliente Ativo:**
- ID: `cmrh6di6t00036bhiy1ugll9g` (God Me Free)
- Status: ACTIVE
- Deve editar status → INACTIVE → ACTIVE

---

### 2b. Contratos

- [ ] Abrir `/clientes/[id]?tab=contratos`
- [ ] Verificar tabela renderiza (deve ter 3 contratos no DB)
- [ ] Validar colunas: Título, Status, Mensal (BRL), Total (BRL), Datas
- [ ] Verificar valores formatados em BRL (ex: R$ 1.000,00)
- [ ] Verificar status badges com cores (ACTIVE = verde)

**Dados de Teste:**
- Título: "Contrato UMBURGUI — TCV" (status: ACTIVE)
- Mensal: Deve exibir valor em BRL formatado

---

### 2c. Recebimentos

- [ ] Abrir `/clientes/[id]?tab=recebimentos`
- [ ] Tabela renderiza com billings (116 no DB)
- [ ] Verificar colunas: Descrição, Competência (mês/ano), Vencimento, Valores, Status
- [ ] Validar status badges:
  - [ ] PENDING = amarelo
  - [ ] PARTIAL = laranja
  - [ ] PAID = verde
  - [ ] OVERDUE = vermelho
- [ ] Valores formatados em BRL

**Dados de Teste:**
- Amostra: "Mensalidade 07/2026 — BOTECO DO JOÃO" (status: OVERDUE)
- Deve mostrar cores corretas

---

### 2d. Pagamentos

- [ ] Abrir `/clientes/[id]?tab=pagamentos`
- [ ] Tabela renderiza com payment history (7 payments no DB)
- [ ] Verificar colunas: Data, Referência, Método, Conta, Valor
- [ ] Valores em verde com "+" (ex: +R$ 500,00)
- [ ] Métodos exibem corretamente (PIX, TRANSFER, BOLETO, CARD, etc)

---

### 2e. Abas Stub

- [ ] `/clientes/[id]?tab=documentos` renderiza (placeholder OK)
- [ ] `/clientes/[id]?tab=notas` renderiza (placeholder OK)
- [ ] `/clientes/[id]?tab=dados-fiscais` renderiza (placeholder OK)
- [ ] `/clientes/[id]?tab=historico` renderiza (placeholder OK)

---

### 2f. Headers & Navigation

- [ ] ClientHeader renderiza com:
  - [ ] Nome do cliente como título
  - [ ] 4 métricas (Mensal, Receita, Aberto, Renovação)
  - [ ] Buttons de ação (Status, Gerar contrato, etc)
- [ ] TabsNavigation renderiza com 8 abas
- [ ] Tab atual destaca corretamente (baseado em ?tab=)
- [ ] Contadores exibem se > 0 (ex: "Contratos (3)")

**Teste de Clique:**
- [ ] Clicar em aba "Contratos" → URL muda para `?tab=contratos`
- [ ] Clicar em aba "Recebimentos" → URL muda para `?tab=recebimentos`

---

## 3. Responsividade

### 3a. Mobile (iPhone SE, 375px)

**Setup:**
1. Chrome DevTools → Toggle device toolbar (Ctrl+Shift+M)
2. Selecionar iPhone SE (375px wide)

**Testes:**
- [ ] `/clientes` renderiza com scroll (tabela ou cards)
- [ ] `/clientes/[id]`
  - [ ] ClientHeader renderiza (métricas em 2x2 grid ou stack)
  - [ ] TabsNavigation scrollável horizontalmente
  - [ ] Aba content renderiza
- [ ] Tabelas com `overflow-x-auto` (scroll horizontal se necessário)
- [ ] Buttons acessíveis (tap targets > 44px)
- [ ] Dialogs responsivos

---

### 3b. Tablet (iPad, 768px)

**Setup:**
1. Chrome DevTools → Toggle device toolbar
2. Selecionar iPad (768px wide)

**Testes:**
- [ ] Layout 2-3 colunas renderiza corretamente
- [ ] TabsNavigation renderiza em 1-2 linhas (sem scroll necessário)
- [ ] Tabelas legíveis
- [ ] Métricas grid renderiza (2x2 ou 1x4)

---

### 3c. Desktop (1920px+)

**Setup:**
1. Chrome DevTools → Toggle device toolbar off
2. ou redimensionar browser para 1920px

**Testes:**
- [ ] Layout full-width OK
- [ ] TabsNavigation renderiza 8 abas em 1 linha (sem scroll)
- [ ] Métricas grid renderiza em 1x4 ou 1x5
- [ ] Tabelas com espaço confortável

---

## 4. Cache Tags Validation

### 4a. Verificar Cache Hit/Miss

**Setup:**
1. Chrome DevTools → Network tab
2. F12 → Response headers

**Teste:**
1. Carregar `/clientes/[id]` 
   - [ ] Response header `x-nextjs-cache: HIT` ou `MISS` (depende se é primeira vez)

2. Editar um campo (ex: status do cliente)
   - [ ] Request POST → response `Cache-Control: no-store` (não cachear)
   - [ ] Página recarrega com novo valor

3. Recarregar página F5
   - [ ] Pode mostrar `x-nextjs-cache: HIT` (se server revalidou)

**Tags Esperadas:**
- `CACHE_TAGS.CLIENT_ID(id)` — invalida quando cliente muda
- `CACHE_TAGS.CLIENTS` — lista master revalida
- `CACHE_TAGS.BILLING_CYCLE_MONTH(month, year)` — billings de um mês

---

### 4b. Cache Storage (Application Tab)

**Chrome DevTools → Application → Cache Storage**

- [ ] Ver se há entries para `/clientes`
- [ ] Ver se entries têm `x-nextjs-cache` header

---

## 5. Cross-Module Navigation

### 5a. Inadimplência → Recebimentos

1. Abrir `/inadimplencia`
2. Clicar em "Ver recebimentos" para um cliente
   - [ ] Deve ir para `/clientes/[id]?tab=recebimentos`
   - [ ] Aba de recebimentos renderiza corretamente

---

### 5b. Rotina → Cliente

1. Abrir `/rotina`
2. Clicar em link de cliente
   - [ ] Deve ir para `/clientes/[id]?tab=recebimentos`
   - [ ] Aba renderiza

---

### 5c. Dashboard → Cobranças

1. Abrir `/dashboard`
2. Clicar em StatCard "Cobranças"
   - [ ] Deve ir para `/cobrancas` (view gerencial, não cliente individual)

---

## 6. Resumo Esperado de Resultados

**Fase 4 será COMPLETA quando:**

✅ **Integridade:** 225 registros, 0 orphans (DONE)
✅ **Navegação:** 10/10 fluxos (DONE)
✅ **Build:** 32/32 pages, 0 errors (DONE)
⏳ **Performance:** LCP < 2.5s, FCP < 1.8s (MANUAL)
⏳ **Smoke Tests:** Todas as 25+ funcionalidades OK (MANUAL)
⏳ **Responsividade:** Mobile + Tablet + Desktop OK (MANUAL)
⏳ **Cache:** Tags revalidam corretamente (MANUAL)

---

## 7. Reporting Results

### Quando completar todos os testes:

**Preencher e enviar:**
1. Métricas de performance (LCP, FCP, CLS, TTFB)
2. Checklist de smoke tests (✅/❌)
3. Screenshots de responsividade (mobile, tablet, desktop)
4. Cache hits/misses confirmados
5. Fluxos de navegação confirmados

**Commit Final (Fase 4 - Commit 3):**
```bash
git add FASE4-VALIDACAO.md
git commit -m "test(fase4-final): todas as validações concluídas

✅ Integridade: 225 registros, 0 orphans
✅ Navegação: 10/10 fluxos
✅ Build: 32/32 pages
✅ Performance: LCP [XXs], FCP [XXs]
✅ Smoke Tests: 25/25 OK
✅ Responsividade: Mobile+Tablet+Desktop OK
✅ Cache: Tags revalidam corretamente

Fase 4 COMPLETA — Pronto para Fase 5: Deploy
"
```

---

## 8. Notas Técnicas

- **Advisory Lock:** PostgreSQL advisory lock (LOCK_ID = 1337) evita race conditions em billing-cycle-maintenance
- **Soft Delete:** Cliente com `archivedAt != null` não aparece em listas
- **Cache TTL:** 5 min padrão para dados, 1h para agregados
- **Lazy-loading:** Cada tab carrega sob demanda (não no layout.tsx)
- **Deep-linking:** URL `?tab=xxx` preservado ao recarregar página

---

## 9. Troubleshooting

### Performance baixa (LCP > 3s)
- [ ] Verificar Network tab → há requests bloqueando?
- [ ] Verificar se há imagens grandes não otimizadas
- [ ] Verificar se CSS/JS está sendo carregado em paralelo

### Responsividade quebrada (mobile)
- [ ] Tabelas devem ter `overflow-x-auto` (scroll horizontal)
- [ ] Métricas devem fazer stack em grid 2x2 (mobile)
- [ ] Botões precisam ter tap targets > 44px

### Cache não revalidando
- [ ] Verificar se `revalidateTag()` foi chamado na ação
- [ ] Verificar se tag está em `CACHE_TAGS`
- [ ] Verificar se há múltiplas instâncias de revalidação conflitando

---

## 10. Timeline

- **Hoje:** Executar Performance + Smoke Tests
- **Amanhã:** Responsive + Cache validation
- **Depois:** Fase 4 Final Commit
- **Próximo:** Fase 5 - Deploy (1 dia)
