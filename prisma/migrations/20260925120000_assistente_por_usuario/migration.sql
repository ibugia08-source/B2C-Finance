-- ASSISTENTE PRIVADO POR USUÁRIO (25/09/2026).
--
-- AIConversation e AIMemory eram escopadas só pelo ownerId — que é o DONO do
-- workspace, compartilhado por toda a equipe. Resultado: qualquer membro com
-- acesso ao Assistente abria a última conversa de outro colega, lia (e
-- apagava) as memórias dele, e continuava a conversa alheia por id.
--
-- O userId registra QUEM conversou/escreveu. Linhas antigas ficam com null
-- (legado): não há como saber de quem eram, então só o ADMIN as enxerga.
-- Excluir o usuário leva junto o histórico privado dele (CASCADE).

ALTER TABLE "AIConversation" ADD COLUMN "userId" TEXT;
ALTER TABLE "AIMemory" ADD COLUMN "userId" TEXT;

CREATE INDEX "AIConversation_userId_idx" ON "AIConversation"("userId");
CREATE INDEX "AIMemory_userId_idx" ON "AIMemory"("userId");

ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIMemory" ADD CONSTRAINT "AIMemory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
