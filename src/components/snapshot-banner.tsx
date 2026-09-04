import { Camera } from "lucide-react";
import { formatDateBR, monthLabel } from "@/lib/format";

/**
 * FAIXA DE FOTOGRAFIA (F2.4 · ref. 02 §7.8).
 *
 * "Faixa superior fixa âmbar-suave com selo Fotografia + competência +
 * versão + quem fechou; canvas com tintura de papel 2% mais quente;
 * controles de edição AUSENTES (não desabilitados)."
 *
 * A regra que mais importa é a do parêntese: controle desabilitado ainda
 * promete que a ação existe e vai ser possível — a pessoa clica, não
 * acontece nada, e ela tenta de novo. Em mês fechado o gesto simplesmente
 * NÃO ESTÁ LÁ, e a faixa explica por quê. É a diferença entre uma tela que
 * frustra e uma tela que informa.
 */
export function SnapshotBanner({
  competence,
  versao,
  fechadoPor,
  fechadoEm,
  precisaRevalidar,
  origem = "NATIVA",
}: {
  competence: string;
  versao: number;
  fechadoPor: string | null;
  fechadoEm: Date | null;
  precisaRevalidar?: boolean;
  /** IMPORTADA = fotografia reconstruída pela Importação Total (F1.14). */
  origem?: "NATIVA" | "IMPORTADA";
}) {
  const [ano, mes] = competence.split("-").map(Number);
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-warning/30 bg-warning-soft px-3.5 py-2.5"
    >
      <span className="inline-flex items-center gap-1.5 text-dense font-semibold text-warning-foreground">
        <Camera className="h-3.5 w-3.5" aria-hidden />
        Fotografia
      </span>
      <span className="text-dense text-warning-foreground/90">
        {monthLabel(new Date(ano, mes - 1, 1))} · versão {versao}
        {fechadoPor ? ` · fechado por ${fechadoPor}` : ""}
        {fechadoEm ? ` em ${formatDateBR(fechadoEm)}` : ""}
      </span>
      {origem === "IMPORTADA" ? (
        <span className="rounded-pill border border-warning/40 px-2 py-0.5 text-caption font-medium text-warning-foreground">
          origem: importação de planilha
        </span>
      ) : null}
      <span className="text-caption text-warning-foreground/80">
        {origem === "IMPORTADA"
          ? "Retrato reconstruído a partir da planilha importada. Um fechamento nativo deste mês, quando houver, passa a valer no lugar."
          : "Este mês está fechado: os números são os do fechamento e não mudam mais. Para alterá-los é preciso reabrir a competência."}
      </span>
      {precisaRevalidar ? (
        <span className="ml-auto rounded-pill bg-warning px-2 py-0.5 text-caption font-medium text-warning-foreground">
          um mês anterior foi reaberto — reconferir
        </span>
      ) : null}
    </div>
  );
}

/**
 * Coluna que não existia no período retratado (02 §7.8).
 *
 * Uma coluna nova aplicada a um mês antigo mostraria vazio, e vazio ali
 * significaria "o dado era zero" — quando na verdade a pergunta nem existia
 * quando aquele mês fechou.
 */
export function NaoExistiaNoPeriodo({ desde }: { desde?: string }) {
  return (
    <span
      className="text-caption text-text-faint"
      title={
        desde
          ? `Esta informação passou a ser registrada em ${desde}; o mês retratado é anterior.`
          : "Esta informação não era registrada quando este mês foi fechado."
      }
    >
      não existia neste período
    </span>
  );
}
