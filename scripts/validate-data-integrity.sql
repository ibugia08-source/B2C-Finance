-- FASE 4: Validação de Integridade de Dados
-- Script para verificar que nenhum dado foi perdido ou corrompido durante Fases 1-3
-- Execute no Supabase SQL Editor

-- ===== 1. Contadores Totais (comparar com backup) =====
SELECT 'CLIENTES' as tabela, COUNT(*) as total FROM clients
UNION ALL
SELECT 'CONTRATOS', COUNT(*) FROM contracts
UNION ALL
SELECT 'BILLINGS', COUNT(*) FROM billings
UNION ALL
SELECT 'PAYMENTS', COUNT(*) FROM payments
UNION ALL
SELECT 'COLLECTION_HISTORY', COUNT(*) FROM "collectionHistory"
UNION ALL
SELECT 'CLIENT_CONTACTS', COUNT(*) FROM "clientContacts"
UNION ALL
SELECT 'CLIENT_DOCUMENTS', COUNT(*) FROM "clientDocuments"
UNION ALL
SELECT 'CLIENT_NOTES', COUNT(*) FROM "clientNotes"
ORDER BY tabela;

-- ===== 2. Verificar Referências Órfãs =====

-- Contratos sem cliente válido
SELECT COUNT(*) as orphan_contracts
FROM contracts
WHERE "clientId" IS NULL OR "clientId" NOT IN (SELECT id FROM clients);

-- Billings sem cliente válido
SELECT COUNT(*) as orphan_billings
FROM billings
WHERE "clientId" IS NULL OR "clientId" NOT IN (SELECT id FROM clients);

-- Payments sem billing válido
SELECT COUNT(*) as orphan_payments
FROM payments
WHERE "billingId" IS NULL OR "billingId" NOT IN (SELECT id FROM billings);

-- ClientContacts sem cliente válido
SELECT COUNT(*) as orphan_contacts
FROM "clientContacts"
WHERE "clientId" NOT IN (SELECT id FROM clients);

-- ClientDocuments sem cliente válido
SELECT COUNT(*) as orphan_documents
FROM "clientDocuments"
WHERE "clientId" NOT IN (SELECT id FROM clients);

-- ClientNotes sem cliente válido
SELECT COUNT(*) as orphan_notes
FROM "clientNotes"
WHERE "clientId" NOT IN (SELECT id FROM clients);

-- CollectionHistory sem cliente válido
SELECT COUNT(*) as orphan_history
FROM "collectionHistory"
WHERE "clientId" NOT IN (SELECT id FROM clients);

-- ===== 3. Verificar Campos Obrigatórios =====

-- Clientes sem nome
SELECT COUNT(*) as clients_no_name
FROM clients
WHERE name IS NULL OR name = '';

-- Contratos sem clientId
SELECT COUNT(*) as contracts_no_client
FROM contracts
WHERE "clientId" IS NULL;

-- Billings sem clientId
SELECT COUNT(*) as billings_no_client
FROM billings
WHERE "clientId" IS NULL;

-- Payments sem billingId
SELECT COUNT(*) as payments_no_billing
FROM payments
WHERE "billingId" IS NULL;

-- ===== 4. Verificar Soft Delete =====

-- Clientes marcados como deletados (archivedAt preenchido)
SELECT COUNT(*) as archived_clients
FROM clients
WHERE "archivedAt" IS NOT NULL;

-- ===== 5. Verificar Dados de Exemplo =====

-- Clientes ativos
SELECT COUNT(*) as active_clients
FROM clients
WHERE "archivedAt" IS NULL AND status = 'ACTIVE';

-- Contratos ativos
SELECT COUNT(*) as active_contracts
FROM contracts
WHERE status = 'ACTIVE';

-- Billings em aberto
SELECT COUNT(*) as open_billings
FROM billings
WHERE status IN ('PENDING', 'PARTIAL', 'OVERDUE');

-- ===== 6. Relatório de Integridade =====

-- Resumo final: se todas as queries retornam 0 ou valores esperados, data integrity OK
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '✅ INTEGRIDADE OK'
    ELSE '❌ DADOS CORROMPIDOS'
  END as status
FROM (
  SELECT 1 WHERE (
    -- Nenhum órfão esperado
    (SELECT COUNT(*) FROM contracts WHERE "clientId" NOT IN (SELECT id FROM clients)) = 0
    AND (SELECT COUNT(*) FROM billings WHERE "clientId" NOT IN (SELECT id FROM clients)) = 0
    AND (SELECT COUNT(*) FROM payments WHERE "billingId" NOT IN (SELECT id FROM billings)) = 0
  )
) as checks;
