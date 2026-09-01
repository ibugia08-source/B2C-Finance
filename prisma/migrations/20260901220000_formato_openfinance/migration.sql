-- F5.3 — o extrato agora também chega SEM arquivo, pelo Open Finance.
ALTER TABLE "BankStatement" DROP CONSTRAINT "BankStatement_formato_conhecido";
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_formato_conhecido"
    CHECK ("format" IN ('OFX', 'CSV', 'OPENFINANCE'));
