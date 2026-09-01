-- F1.12: RLS em toda tabela privada. SEM FORCE (o Prisma conecta como dona
-- da tabela); o alvo é a API pública do Supabase. Mesmo padrão da 20260831190000.
ALTER TABLE "GatewayCharge" ENABLE ROW LEVEL SECURITY;
