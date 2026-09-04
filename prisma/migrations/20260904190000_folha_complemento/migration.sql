-- FOLHA: lançamentos POSTERIORES ao pagamento (comissões fecham no mês
-- seguinte). Cada item registra QUANDO foi coberto por um pagamento; item
-- sem carimbo numa folha paga é complemento A PAGAR.
ALTER TABLE "PayrollItem" ADD COLUMN "settledAt" TIMESTAMPTZ(3);

-- Legado: em folha já PAGA, todos os itens existentes foram cobertos pela
-- despesa criada no pagamento original.
UPDATE "PayrollItem" pi
SET "settledAt" = COALESCE(p."paidAt", p."updatedAt")
FROM "Payroll" p
WHERE pi."payrollId" = p."id" AND p."status" = 'PAID';
