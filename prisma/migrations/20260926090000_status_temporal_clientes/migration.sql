-- STATUS DO CLIENTE COM VIGÊNCIA (26/09/2026).
--
-- O problema: Client.status era um campo só. Mudar o cliente para Inativo
-- olhando outubro reescrevia setembro, agosto e todo o passado, porque todo
-- relatório histórico lia o status de HOJE.
--
-- A correção: ClientStatusHistory vira a FONTE TEMPORAL OFICIAL. Cada linha é
-- um intervalo de datas civis [effectiveFrom, effectiveTo] (inclusivo, nulo =
-- em diante), sem sobreposição por cliente. Client.status continua existindo
-- como o status VIGENTE HOJE, materializado — nunca o de um mês futuro.
--
-- Nada aqui é destrutivo: nenhuma coluna sai, nenhum cliente, contrato,
-- cobrança ou pagamento é tocado. Documentação: docs/STATUS_TEMPORAL_CLIENTES.md.

-- ============================================================================
-- 1) Tabela
-- ============================================================================
CREATE TABLE "ClientStatusHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT,
    "changedById" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'USUARIO',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientStatusHistory_pkey" PRIMARY KEY ("id"),
    -- Fim antes do começo não existe.
    CONSTRAINT "ClientStatusHistory_vigencia_check"
      CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE INDEX "ClientStatusHistory_clientId_effectiveFrom_idx" ON "ClientStatusHistory"("clientId", "effectiveFrom");
CREATE INDEX "ClientStatusHistory_ownerId_idx" ON "ClientStatusHistory"("ownerId");
CREATE INDEX "ClientStatusHistory_status_idx" ON "ClientStatusHistory"("status");

ALTER TABLE "ClientStatusHistory" ADD CONSTRAINT "ClientStatusHistory_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientStatusHistory" ADD CONSTRAINT "ClientStatusHistory_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- F1.12: toda tabela nasce com RLS ligado (sem policy = só o dono da tabela).
ALTER TABLE "ClientStatusHistory" ENABLE ROW LEVEL SECURITY;

-- Dois status válidos na mesma data: o banco recusa. EXCLUDE com daterange
-- precisa de btree_gist (texto com "="); DEFERRABLE porque reorganizar a
-- linha do tempo encurta um intervalo e abre outro na mesma transação.
-- Sem a extensão (ambiente que não a permita), cai para as duas garantias
-- que índice comum dá: um começo por dia e um único intervalo em aberto.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'btree_gist indisponível: usando índices únicos no lugar do EXCLUDE';
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    EXECUTE 'ALTER TABLE "ClientStatusHistory" ADD CONSTRAINT "ClientStatusHistory_sem_sobreposicao"
      EXCLUDE USING gist ("clientId" WITH =, daterange("effectiveFrom", "effectiveTo", ''[]'') WITH &&)
      DEFERRABLE INITIALLY DEFERRED';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX "ClientStatusHistory_clientId_from_key" ON "ClientStatusHistory"("clientId", "effectiveFrom")';
    EXECUTE 'CREATE UNIQUE INDEX "ClientStatusHistory_um_em_aberto" ON "ClientStatusHistory"("clientId") WHERE "effectiveTo" IS NULL';
  END IF;
END $$;

-- ============================================================================
-- 2) Datas civis
-- ============================================================================
-- Data civil de um timestamptz, na convenção do sistema: data civil gravada
-- à meia-noite UTC (legado) se lê pelo dia UTC; qualquer outro horário é um
-- instante e se lê no fuso do negócio (America/Bahia). Assim 01/10 nunca
-- vira 30/09 por conversão de fuso.
CREATE OR REPLACE FUNCTION b2c_civil_date(ts TIMESTAMPTZ) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN ts IS NULL THEN NULL
    WHEN (ts AT TIME ZONE 'UTC')::time = '00:00:00' THEN (ts AT TIME ZONE 'UTC')::date
    ELSE (ts AT TIME ZONE 'America/Bahia')::date
  END
$$;

CREATE OR REPLACE FUNCTION b2c_today() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Bahia')::date $$;

-- ============================================================================
-- 3) Núcleo da vigência (fonte ÚNICA do algoritmo — o TypeScript chama estas)
-- ============================================================================

-- Junta intervalos vizinhos com o mesmo status (ex.: Ativo até 30/09 +
-- Ativo desde 01/10 = Ativo contínuo). Mantém a linha mais antiga.
CREATE OR REPLACE FUNCTION b2c_status_merge(p_client TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  cur       RECORD;
  v_has     BOOLEAN := false;
  v_id      TEXT;
  v_status  "ClientStatus";
  v_to      DATE;
BEGIN
  FOR cur IN
    SELECT * FROM "ClientStatusHistory" WHERE "clientId" = p_client ORDER BY "effectiveFrom"
  LOOP
    IF v_has AND v_status = cur."status" AND v_to IS NOT NULL AND v_to = cur."effectiveFrom" - 1 THEN
      DELETE FROM "ClientStatusHistory" WHERE "id" = cur."id";
      UPDATE "ClientStatusHistory"
         SET "effectiveTo" = cur."effectiveTo",
             "needsReview" = "needsReview" OR cur."needsReview",
             "updatedAt" = now()
       WHERE "id" = v_id;
      v_to := cur."effectiveTo";
    ELSE
      v_has := true;
      v_id := cur."id";
      v_status := cur."status";
      v_to := cur."effectiveTo";
    END IF;
  END LOOP;
END $$;

-- Aplica "status S a partir de D": o intervalo que cobre D é encerrado em
-- D-1 e S vale de D até a PRÓXIMA mudança já registrada (que é preservada)
-- ou em diante. Mudança no mesmo dia de outra substitui aquela. Mesmo status
-- do intervalo vigente em D = nada a fazer.
CREATE OR REPLACE FUNCTION b2c_status_apply(
  p_client TEXT, p_status "ClientStatus", p_from DATE,
  p_reason TEXT, p_by TEXT, p_origin TEXT, p_review BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_owner TEXT;
  r       RECORD;
  v_next  DATE;
BEGIN
  IF p_client IS NULL OR p_from IS NULL OR p_status IS NULL THEN
    RAISE EXCEPTION 'b2c_status_apply: cliente, status e início da vigência são obrigatórios';
  END IF;
  -- Duas abas mudando o mesmo cliente não se atropelam.
  PERFORM pg_advisory_xact_lock(hashtext('client_status:' || p_client));
  SELECT "ownerId" INTO v_owner FROM "Client" WHERE "id" = p_client;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'b2c_status_apply: cliente % não existe', p_client;
  END IF;

  SELECT * INTO r FROM "ClientStatusHistory"
   WHERE "clientId" = p_client AND "effectiveFrom" <= p_from
     AND ("effectiveTo" IS NULL OR "effectiveTo" >= p_from);

  IF FOUND THEN
    IF r."status" = p_status THEN
      RETURN;
    END IF;
    IF r."effectiveFrom" = p_from THEN
      UPDATE "ClientStatusHistory"
         SET "status" = p_status, "reason" = p_reason, "changedById" = p_by,
             "origin" = p_origin, "needsReview" = p_review, "updatedAt" = now()
       WHERE "id" = r."id";
    ELSE
      UPDATE "ClientStatusHistory" SET "effectiveTo" = p_from - 1, "updatedAt" = now()
       WHERE "id" = r."id";
      INSERT INTO "ClientStatusHistory"
        ("id", "clientId", "status", "effectiveFrom", "effectiveTo", "reason", "changedById",
         "origin", "needsReview", "ownerId")
      VALUES ('csh_' || replace(gen_random_uuid()::text, '-', ''), p_client, p_status, p_from,
              r."effectiveTo", p_reason, p_by, p_origin, p_review, v_owner);
    END IF;
  ELSE
    -- D cai antes do primeiro registro ou num trecho sem histórico: vale até
    -- a próxima mudança registrada.
    SELECT min("effectiveFrom") INTO v_next FROM "ClientStatusHistory"
     WHERE "clientId" = p_client AND "effectiveFrom" > p_from;
    INSERT INTO "ClientStatusHistory"
      ("id", "clientId", "status", "effectiveFrom", "effectiveTo", "reason", "changedById",
       "origin", "needsReview", "ownerId")
    VALUES ('csh_' || replace(gen_random_uuid()::text, '-', ''), p_client, p_status, p_from,
            CASE WHEN v_next IS NULL THEN NULL ELSE v_next - 1 END,
            p_reason, p_by, p_origin, p_review, v_owner);
  END IF;

  PERFORM b2c_status_merge(p_client);
END $$;

-- Cancela a mudança que começa em D (a programada): a linha sai e o
-- intervalo anterior, se encostado nela, volta a cobrir o período dela.
CREATE OR REPLACE FUNCTION b2c_status_cancel(p_client TEXT, p_from DATE) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  r    RECORD;
  prev RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('client_status:' || p_client));
  SELECT * INTO r FROM "ClientStatusHistory" WHERE "clientId" = p_client AND "effectiveFrom" = p_from;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM "ClientStatusHistory" WHERE "id" = r."id";
  SELECT * INTO prev FROM "ClientStatusHistory"
   WHERE "clientId" = p_client AND "effectiveTo" = p_from - 1;
  IF FOUND THEN
    UPDATE "ClientStatusHistory" SET "effectiveTo" = r."effectiveTo", "updatedAt" = now()
     WHERE "id" = prev."id";
  END IF;
  PERFORM b2c_status_merge(p_client);
  RETURN true;
END $$;

-- ============================================================================
-- 4) Gatilhos: nenhum caminho de escrita fica sem histórico
-- ============================================================================
-- Cliente novo nasce com linha do tempo: status desde a data de entrada (ou
-- hoje). Perdido/Inativo com data de saída: Ativo até a véspera, depois o
-- status. É a mesma regra do cadastro e da importação.
CREATE OR REPLACE FUNCTION b2c_client_status_on_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_start DATE := b2c_civil_date(NEW."startedAt");
  v_exit  DATE := b2c_civil_date(NEW."churnedAt");
BEGIN
  IF current_setting('b2c.status_manual', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IN ('CHURNED', 'INACTIVE') AND v_exit IS NOT NULL THEN
    -- Ativo da entrada até a véspera da saída; sem entrada, só a saída.
    IF v_start IS NOT NULL AND v_exit > v_start THEN
      PERFORM b2c_status_apply(NEW."id", 'ACTIVE', v_start, NULL, NULL, 'SISTEMA');
    END IF;
    PERFORM b2c_status_apply(NEW."id", NEW."status", v_exit, NULL, NULL, 'SISTEMA');
  ELSE
    PERFORM b2c_status_apply(NEW."id", NEW."status", COALESCE(v_start, b2c_today()), NULL, NULL, 'SISTEMA');
  END IF;
  RETURN NEW;
END $$;

-- Qualquer troca de Client.status que NÃO veio da camada central
-- (src/lib/clients/status-history.ts marca a transação com
-- b2c.status_manual=1) vale "a partir de hoje". Os meses anteriores ficam
-- como estavam — é exatamente o que o campo único não fazia.
-- Saída (Perdido/Inativo) gravada JUNTO com a data de saída (churnedAt):
-- a data informada é a evidência real e vale no lugar de "hoje" (nunca
-- depois de hoje — futuro é alteração programada, só pela camada central).
CREATE OR REPLACE FUNCTION b2c_client_status_on_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_from DATE := b2c_today();
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND COALESCE(current_setting('b2c.status_manual', true), '') <> '1' THEN
    IF NEW."status" IN ('CHURNED', 'INACTIVE') AND NEW."churnedAt" IS NOT NULL THEN
      v_from := LEAST(b2c_civil_date(NEW."churnedAt"), b2c_today());
    END IF;
    PERFORM b2c_status_apply(NEW."id", NEW."status", v_from, NULL,
      NULLIF(current_setting('b2c.actor', true), ''), 'SISTEMA');
  END IF;
  RETURN NEW;
END $$;

-- ============================================================================
-- 5) Reconstrução do histórico existente (backfill conservador)
-- ============================================================================
-- NÃO INVENTA DATA. Evidências, da mais forte para a mais fraca:
--   COMPROVADO: trilha de auditoria (lifecycleStatus da relação, status do
--     cliente), perdas registradas (ClientLoss.lostAt), data de saída
--     (Client.churnedAt), data da pausa (relação.pausedAt), termo de
--     reativação/retomada (CommercialTerm.validFrom).
--   INFERIDO: Ativo desde a data de entrada até a primeira mudança conhecida.
--   INDETERMINADO: o status de hoje sem data de início conhecida — vale a
--     partir da data desta migração e a linha fica marcada para revisão.
--     O período anterior fica SEM status (não conta como ativo em nenhum mês),
--     exatamente como já não contava quando se lia o status de hoje.
CREATE OR REPLACE FUNCTION b2c_status_backfill_client(p_client TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  c         RECORD;
  ev        RECORD;
  v_start   DATE;
  v_today   DATE := b2c_today();
  v_first   DATE;
  v_perdas  INT;
  v_atual   "ClientStatus";
  v_review  BOOLEAN;
  v_bill_first DATE;
  v_bill_next  DATE;
BEGIN
  IF EXISTS (SELECT 1 FROM "ClientStatusHistory" WHERE "clientId" = p_client) THEN
    RETURN;
  END IF;
  SELECT * INTO c FROM "Client" WHERE "id" = p_client;
  IF NOT FOUND THEN RETURN; END IF;
  v_start := b2c_civil_date(c."startedAt");

  CREATE TEMP TABLE IF NOT EXISTS _b2c_ev (d DATE, s "ClientStatus", o TEXT, ts TIMESTAMPTZ, rv BOOLEAN DEFAULT false) ON COMMIT DROP;
  DELETE FROM _b2c_ev;

  -- Auditoria do ciclo de vida da relação (pausa, saída, volta).
  INSERT INTO _b2c_ev
  SELECT b2c_civil_date(a."createdAt"),
         CASE a."newValue"
           WHEN 'ACTIVE' THEN 'ACTIVE' WHEN 'ONBOARDING' THEN 'ACTIVE'
           WHEN 'PAUSED' THEN 'PAUSED' WHEN 'CHURNED' THEN 'CHURNED'
           WHEN 'INACTIVE' THEN 'INACTIVE'
         END::"ClientStatus",
         'BACKFILL_COMPROVADO', a."createdAt"
    FROM "AuditLog" a
    JOIN "ClientAgencyRelationship" r ON r."id" = a."entityId"
   WHERE a."entity" = 'ClientAgencyRelationship' AND a."field" = 'lifecycleStatus'
     AND r."clientId" = p_client
     AND a."newValue" IN ('ACTIVE', 'ONBOARDING', 'PAUSED', 'CHURNED', 'INACTIVE');

  -- Auditoria do próprio status do cliente, quando houver.
  INSERT INTO _b2c_ev
  SELECT b2c_civil_date(a."createdAt"), a."newValue"::"ClientStatus", 'BACKFILL_COMPROVADO', a."createdAt"
    FROM "AuditLog" a
   WHERE a."entity" = 'Client' AND a."entityId" = p_client AND a."field" = 'status'
     AND a."newValue" IN ('LEAD','PROSPECT','ACTIVE','INACTIVE','PAUSED','RENEWAL','DELINQUENT','CHURNED');

  -- Perdas registradas.
  INSERT INTO _b2c_ev
  SELECT b2c_civil_date(l."lostAt"), 'CHURNED', 'BACKFILL_COMPROVADO', l."lostAt"
    FROM "ClientLoss" l WHERE l."clientId" = p_client;
  SELECT count(*) INTO v_perdas FROM "ClientLoss" WHERE "clientId" = p_client;

  -- Voltas registradas no termo comercial (reativação/retomada).
  INSERT INTO _b2c_ev
  SELECT b2c_civil_date(t."validFrom"), 'ACTIVE', 'BACKFILL_COMPROVADO', t."validFrom"
    FROM "CommercialTerm" t
    JOIN "ClientAgencyRelationship" r ON r."id" = t."relationshipId"
   WHERE r."clientId" = p_client
     AND (t."reason" ILIKE 'Reativação%' OR t."reason" ILIKE 'Retomada%');

  -- Saída / pausa com data no cadastro atual.
  IF c."status" IN ('CHURNED', 'INACTIVE') AND c."churnedAt" IS NOT NULL THEN
    INSERT INTO _b2c_ev VALUES (b2c_civil_date(c."churnedAt"), c."status", 'BACKFILL_COMPROVADO', c."churnedAt");
  END IF;
  IF c."status" = 'PAUSED' THEN
    INSERT INTO _b2c_ev
    SELECT b2c_civil_date(max(r."pausedAt")), 'PAUSED', 'BACKFILL_COMPROVADO', max(r."pausedAt")
      FROM "ClientAgencyRelationship" r
     WHERE r."clientId" = p_client AND r."pausedAt" IS NOT NULL
    HAVING max(r."pausedAt") IS NOT NULL;
  END IF;

  -- Saiu/pausou SEM data em lugar nenhum, mas tem cobranças: as cobranças
  -- provam que era cliente nos meses cobrados. Ativo até o fim do último mês
  -- cobrado e o status atual a partir do mês seguinte — a MESMA inferência
  -- que a Importação Total já faz para churn sem data. INFERIDO + revisão.
  IF c."status" IN ('CHURNED', 'INACTIVE', 'PAUSED')
     AND NOT EXISTS (SELECT 1 FROM _b2c_ev WHERE s = c."status") THEN
    SELECT make_date(min("competenceYear" * 100 + "competenceMonth") / 100, min("competenceYear" * 100 + "competenceMonth") % 100, 1),
           (make_date(max("competenceYear" * 100 + "competenceMonth") / 100, max("competenceYear" * 100 + "competenceMonth") % 100, 1)
              + interval '1 month')::date
      INTO v_bill_first, v_bill_next
      FROM "Billing"
     WHERE "clientId" = p_client AND "status" <> 'CANCELED' AND "revenueType" IN ('MRR', 'TCV');
    IF v_bill_next IS NOT NULL AND v_bill_next <= v_today THEN
      INSERT INTO _b2c_ev VALUES
        (LEAST(COALESCE(v_start, v_bill_first), v_bill_first), 'ACTIVE', 'BACKFILL_INFERIDO', '-infinity', true),
        (v_bill_next, c."status", 'BACKFILL_INFERIDO', 'infinity', true);
    END IF;
  END IF;

  DELETE FROM _b2c_ev WHERE d IS NULL OR s IS NULL OR d > v_today;
  SELECT min(d) INTO v_first FROM _b2c_ev;

  -- Início: Ativo desde a entrada (INFERIDO), se a entrada vem antes de tudo.
  -- Prospect/Lead sem evento nenhum: o status de hoje desde a entrada.
  -- Perdido/Inativo/Pausado SEM nenhum evento: o fim desse "ativo" seria
  -- inventado — o trecho fica sem status (e o de hoje, para revisão).
  IF v_start IS NOT NULL AND v_start <= v_today AND (v_first IS NULL OR v_start < v_first)
     AND (v_first IS NOT NULL OR c."status" IN ('ACTIVE', 'RENEWAL', 'DELINQUENT', 'LEAD', 'PROSPECT')) THEN
    PERFORM b2c_status_apply(p_client,
      CASE WHEN c."status" IN ('LEAD', 'PROSPECT') AND v_first IS NULL THEN c."status" ELSE 'ACTIVE' END,
      v_start, 'Reconstruído: ativo desde a data de entrada', NULL, 'BACKFILL_INFERIDO', v_perdas > 1);
  END IF;

  -- Eventos em ordem; no mesmo dia vale o último.
  FOR ev IN
    SELECT DISTINCT ON (d) d, s, o, rv FROM _b2c_ev ORDER BY d, ts DESC
  LOOP
    PERFORM b2c_status_apply(p_client, ev.s, ev.d,
      CASE WHEN ev.o = 'BACKFILL_INFERIDO' THEN 'Reconstruído das cobranças: ativo nos meses cobrados — conferir a data de saída'
           ELSE 'Reconstruído da trilha do sistema' END,
      NULL, ev.o, ev.rv);
  END LOOP;

  -- O status de hoje tem de bater com o cadastro. Não bateu (ou não havia
  -- nada): o status atual passa a valer a partir de hoje — nunca "desde
  -- sempre" — e a linha fica para revisão.
  SELECT "status" INTO v_atual FROM "ClientStatusHistory"
   WHERE "clientId" = p_client AND "effectiveFrom" <= v_today
     AND ("effectiveTo" IS NULL OR "effectiveTo" >= v_today);
  IF v_atual IS DISTINCT FROM c."status" THEN
    -- Ativo hoje, sem entrada nem evento: ativo desde o cadastro no sistema
    -- (INFERIDO, mas marcado: falta a data de entrada).
    v_review := true;
    IF v_atual IS NULL AND v_first IS NULL AND v_start IS NULL
       AND c."status" IN ('ACTIVE', 'RENEWAL', 'DELINQUENT', 'LEAD', 'PROSPECT') THEN
      PERFORM b2c_status_apply(p_client, c."status", LEAST(b2c_civil_date(c."createdAt"), v_today),
        'Reconstruído: sem data de entrada — ativo desde o cadastro no sistema', NULL,
        'BACKFILL_INFERIDO', true);
    ELSE
      PERFORM b2c_status_apply(p_client, c."status", v_today,
        'Reconstruído: data de início deste status não encontrada — revisar', NULL,
        'BACKFILL_INDETERMINADO', v_review);
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  cid TEXT;
BEGIN
  PERFORM set_config('b2c.status_manual', '1', true);
  FOR cid IN SELECT "id" FROM "Client" LOOP
    PERFORM b2c_status_backfill_client(cid);
  END LOOP;
  PERFORM set_config('b2c.status_manual', '', true);
END $$;

CREATE TRIGGER "Client_status_history_insert"
  AFTER INSERT ON "Client"
  FOR EACH ROW EXECUTE FUNCTION b2c_client_status_on_insert();

CREATE TRIGGER "Client_status_history_update"
  AFTER UPDATE OF "status" ON "Client"
  FOR EACH ROW EXECUTE FUNCTION b2c_client_status_on_update();
