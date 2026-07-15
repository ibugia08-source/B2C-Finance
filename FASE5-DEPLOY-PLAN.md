# FASE 5: Deploy + Comunicação — Plano

**Duração:** 1-2 dias  
**Data Estimada:** 15-16/07/2026  
**Status:** 📅 Planejado  

---

## Objetivo

Colocar a reorganização B2C Finance em produção e comunicar as mudanças para os usuários finais.

---

## Timeline

### Dia 1 (15/07) — Deploy & Smoke Test

#### Manhã: Preparação
- [ ] Backup de produção (Supabase snapshot)
- [ ] Preparar rollback plan (se necessário)
- [ ] Confirmar migrations estão deployadas
- [ ] Verificar variáveis de ambiente (NEXT_PUBLIC_*, DATABASE_URL)

#### Tarde: Deploy
- [ ] Deploy para produção (Vercel)
  ```bash
  git push origin main
  # Vercel auto-deploys via webhook
  ```
- [ ] Aguardar build + deployment (5-10 min)
- [ ] Verificar que deploy foi bem-sucedido
  ```bash
  curl https://b2c-finance.vercel.app/api/health
  # Expected: 200 OK
  ```

#### Noite: Smoke Tests em Produção
- [ ] Acessar https://b2c-finance.vercel.app/clientes
  - [ ] Tabela de clientes renderiza
  - [ ] Contadores corretos (58 clientes)
- [ ] Clicar em um cliente → /clientes/[id]
  - [ ] ClientHeader renderiza
  - [ ] TabsNavigation renderiza (8 tabs)
- [ ] Navegar por cada aba
  - [ ] dados-principais renderiza ✅
  - [ ] contratos renderiza ✅
  - [ ] recebimentos renderiza ✅
  - [ ] pagamentos renderiza ✅
  - [ ] documentos renderiza (placeholder) ✅
  - [ ] notas renderiza (placeholder) ✅
  - [ ] dados-fiscais renderiza (placeholder) ✅
  - [ ] historico renderiza (placeholder) ✅
- [ ] Testar navegação cruzada
  - [ ] /inadimplencia → "Ver recebimentos" → /clientes/[id]?tab=recebimentos ✅
  - [ ] /rotina → link cliente → /clientes/[id]?tab=recebimentos ✅
  - [ ] /dashboard → StatCard → /cobrancas (mantém gerencial) ✅

#### Noite: Monitoramento Inicial
- [ ] Verificar Sentry/error logs (se configurado)
  - [ ] 0 new errors após deploy
- [ ] Verificar Vercel Analytics
  - [ ] LCP < 2.5s
  - [ ] FCP < 1.8s
  - [ ] CLS < 0.1
- [ ] Verificar response times
  - [ ] /clientes < 1.5s
  - [ ] /clientes/[id] < 2s

---

### Dia 2 (16/07) — Comunicação & Monitoramento

#### Manhã: Comunicado para Usuários

**Email para: b2cgestao@gmail.com + team**

Assunto: **B2C Finance Reorganizado — Novo padrão "Dossiê do Cliente"**

Corpo:
```
Prezados,

A plataforma B2C Finance foi reorganizada com sucesso!

🎯 O QUE MUDOU:

1. NOVO MÓDULO "CLIENTES" (unificado)
   - Lista única de clientes
   - Clique em qualquer cliente → Dossiê completo

2. DOSSIÊ DO CLIENTE (8 abas)
   - Dados Principais: cadastro, contatos
   - Contratos: histórico de contratos ativos
   - Recebimentos: billings com status
   - Pagamentos: histórico de pagamentos
   - Documentos: (em breve)
   - Notas: (em breve)
   - Dados Fiscais: (em breve)
   - Histórico: (em breve)

3. NAVEGAÇÃO MELHORADA
   - /inadimplencia → "Ver recebimentos" leva direto ao cliente
   - /rotina → links cliente agora abrem dossiê
   - Deep-linking com ?tab=recebimentos

4. DADOS PRESERVADOS
   - ✅ Nenhum cliente foi deletado
   - ✅ Nenhum contrato foi perdido
   - ✅ Nenhum billing foi perdido
   - ✅ Nenhum pagamento foi perdido
   - Total: 225 registros intactos

📍 COMO USAR:

1. Abrir https://b2c-finance.vercel.app/clientes
2. Clicar em um cliente para abrir dossiê
3. Navegar pelas 8 abas
4. Editar status, contatos, etc (funciona igual antes)

❓ DÚVIDAS?

- O módulo /cobrancas ainda existe (view gerencial de billings)
- Módulo antigo funcionava igual, só reorganizado
- Nenhuma funcionalidade foi removida

Feedback? Contate suporte.

---
Claude Assistente
B2C Finance Team
```

#### Tarde: Acompanhamento
- [ ] Monitorar Sentry/error logs
- [ ] Estar disponível para feedback
- [ ] Documentar issues (se houver)
- [ ] Aplicar hot-fixes se necessário

#### Noite: Consolidação
- [ ] Resumo de performance pós-deploy
- [ ] Nenhum erro crítico? → Fase 5 sucesso
- [ ] Algum bug? → Hot-fix + revert (se necessário)

---

## Deploy Checklist

### Antes de Fazer Push

- [x] Fase 4 completa (db54565)
- [x] Build local limpo (`npm run build`)
- [x] Sem warnings críticos
- [x] Sem TODOs pendentes (apenas stubs esperados)
- [x] Cache tags estruturadas
- [x] Migrations aplicadas

### Deploy Processo

```bash
# 1. Verificar branch
git status
git log --oneline -3

# 2. Push para main (Vercel auto-deploys)
git push origin main

# 3. Monitorar deploy em https://vercel.com/dashboard
# Aguardar "Production Deployment" = ✅

# 4. Verificar deployment URL
https://b2c-finance.vercel.app
```

---

## Rollback Plan

Se algo der errado:

```bash
# 1. Identificar commit anterior bom
git log --oneline | head -5
# Exemplo: f13840f | a5931c7 | dcdf9d3

# 2. Revert (não force-push)
git revert db54565
git push origin main

# 3. Vercel auto-redeploy para commit anterior
# (5-10 min)

# 4. Após rollback, investigar bug e fazer hot-fix
```

---

## Monitoramento Pós-Deploy (24h)

### Métricas a Acompanhar

| Métrica | Target | Alertar se |
|---------|--------|-----------|
| LCP | < 2.5s | > 3s |
| FCP | < 1.8s | > 2.5s |
| CLS | < 0.1 | > 0.15 |
| Error Rate | < 0.1% | > 1% |
| HTTP 500 | 0 | Qualquer 500 |

### Ferramentas

- **Vercel Analytics:** https://vercel.com/dashboard → Performance
- **Sentry:** Error tracking (if configured)
- **Chrome DevTools:** Manual checks

### Actions

- **Se LCP > 3s:**
  - Verificar Network waterfall
  - Pode ser CDN/ISP (não código)
  - Continuar monitorando

- **Se Error Rate > 1%:**
  - Verificar Sentry dashboard
  - Revert se crítico
  - Investigar root cause

- **Se Tudo OK:**
  - Celebrate! 🎉
  - Fase 5 Sucesso
  - Próximo: Fase 6 (future work)

---

## Relatório Pós-Deploy

**Documento:** FASE5-DEPLOY-REPORT.md

Preencher com:
1. Deploy timestamp
2. Build metrics (size, time)
3. Performance baseline (LCP, FCP, CLS)
4. Error rate
5. Smoke tests passed/failed
6. User feedback (if any)
7. Issues encontradas (if any)

---

## Future Work (Fases 6+)

### Fase 6: Migração Completa de Documentos
- [ ] Implementar /clientes/[id]?tab=documentos
- [ ] Upload de arquivos
- [ ] Geração de contratos

### Fase 7: Migração Completa de Notas
- [ ] Implementar /clientes/[id]?tab=notas
- [ ] CRUD para ClientNote
- [ ] Rich text editor (if desired)

### Fase 8: Consolidação de Dados Fiscais
- [ ] Migrar CNPJ, endereço, segmento
- [ ] Separa aba própria (ou integrar em dados-principais)

### Fase 9: Histórico Completo
- [ ] CollectionHistory renderizado
- [ ] Churn info + timeline
- [ ] Activity audit log

### Fase 10: Deprecação de /cobrancas
- [ ] Depois de consolidar todas bulk actions
- [ ] Mover para /clientes bulk UI
- [ ] Remover rota antiga (404 redirect para /clientes)

---

## Notas

- **Zero Downtime:** Vercel faz deployment sem downtime
- **Auto-rollback:** Se build falhar, Vercel mantém version anterior rodando
- **Migrations:** Já estão todas deployadas em Fase 0-4
- **Cache:** Cloudflare/CDN pode servir content stale por 60s (normal)

---

## Commits Esperados

1. ✅ Fase 4 - db54565 (completa)
2. 📅 Fase 5 - Commit 1: Deploy + Comunicado
3. 📅 Fase 5 - Commit 2 (if needed): Hot-fix ou confirmação

---

## Success Criteria

✅ Deploy concluído sem downtime  
✅ Todos os endpoints respondendo  
✅ Todas as 8 abas renderizando  
✅ Deep-linking funcionando  
✅ Navegação cruzada OK  
✅ LCP < 2.5s, FCP < 1.8s  
✅ Error rate < 0.1%  
✅ Sem 500s ou timeouts  
✅ Usuários comunicados  
✅ Monitoramento 24h: verde  

---

**Próximo:** Executar Fase 5 em 15-16/07/2026
