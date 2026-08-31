-- =====================================================================
-- F0.9 — IDEMPOTÊNCIA NO BANCO (ref. 03 §4.3; 01 §3.3, §2.13)
--
-- "Idempotência garantida no banco (unique constraints, idempotency keys);
-- throttle é só economia de trabalho" (01 §2.13). Aqui entram as chaves do
-- pagamento EXTERNO: um webhook de gateway reenvia o mesmo evento, e a trava
-- precisa estar no banco, não na aplicação (cenário S20).
--
-- As colunas ficam NULAS para pagamento lançado à mão. No PostgreSQL, NULL
-- não colide em índice único — então os pagamentos manuais convivem sem
-- chave, e só o pagamento externo é travado.
--
-- ===== INVENTÁRIO DAS CONSTRAINTS DE 03 §4.3 =====
--   [x] geração MRR  → Billing_client_competence_mrr_key (20260813215806).
--                      A forma final da spec (relationship + competence +
--                      kind + generationKey) depende de
--                      ClientAgencyRelationship: migra em F1.1/F1.4.
--   [ ] parcela TCV (installmentGroupId + installmentNumber) → as colunas
--                      nascem em F1.4 (Billing 2.0); a unique vai junto.
--   [x] Payment externalId / idempotencyKey → esta migration.
--   [x] LedgerTransaction → @@unique(workspaceId, idempotencyKey), em F0.8.
--                      NÃO foi criada a unique mais grosseira (source +
--                      eventType) de propósito: com PaymentApplication N:N,
--                      UM pagamento liquida N cobranças e posta N vezes com
--                      a mesma origem — a unique grosseira bloquearia o caso
--                      legítimo. A chave de idempotência é mais precisa e já
--                      garante a regra "o mesmo fato posta uma vez só".
--   [ ] avaliação (relação + competência) → AvaliacaoMensal nasce em F1.1.
--   [ ] CommercialTerm sem sobreposição → o modelo nasce em F1.2.
--   [x] checks debit/credit não negativos e um lado por lançamento → F0.8.
--   [x] Decimal em toda moeda → F0.3.
-- =====================================================================

ALTER TABLE "Payment" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Payment_externalSource_externalId_key"
  ON "Payment"("externalSource", "externalId");

CREATE UNIQUE INDEX "Payment_idempotencyKey_key"
  ON "Payment"("idempotencyKey");
