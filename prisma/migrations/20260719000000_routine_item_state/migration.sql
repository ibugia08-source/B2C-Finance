-- Estado dos itens da Rotina diária (remoções do dia + ações concluídas)
CREATE TABLE IF NOT EXISTS "RoutineItemState" (
    "id" TEXT NOT NULL,
    "routineDate" TIMESTAMP(3) NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "actorName" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutineItemState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RoutineItemState_routineDate_itemType_itemKey_idx"
    ON "RoutineItemState"("routineDate", "itemType", "itemKey");
CREATE INDEX IF NOT EXISTS "RoutineItemState_ownerId_idx"
    ON "RoutineItemState"("ownerId");

ALTER TABLE "RoutineItemState"
    ADD CONSTRAINT "RoutineItemState_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
