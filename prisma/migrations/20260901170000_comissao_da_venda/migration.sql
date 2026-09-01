-- F4.7 — a comissão passa a saber de qual VENDA ela veio (ref. 01 §4.8).
--
-- DECIDIDO 19.14: o valor é DIGITADO À MÃO. Não existe regra de comissão
-- versionada nem gatilho que calcule sozinho — e esta coluna não muda isso:
-- ela guarda PROVENIÊNCIA, não fórmula. O que ela permite é responder "esta
-- venda já foi comissionada?" sem ninguém ter de lembrar.



-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "opportunityId" TEXT;

-- CreateIndex
CREATE INDEX "Commission_opportunityId_idx" ON "Commission"("opportunityId");

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

