import Link from "next/link";
import {
  Ban,
  CircleSlash,
  FileQuestion,
  Lock,
  Search,
  Settings2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * VOCABULÁRIO DE ESTADOS — DS-14 e DA-02 da auditoria de 11/09/2026.
 *
 * O relatório encontrou dois problemas irmãos:
 *
 *   DS-14 · o funil tinha ilustração, explicação e ação; o resto do produto
 *           tinha "Nenhum registro com os filtros aplicados" — inclusive em
 *           telas SEM filtro restritivo, onde a frase não explica nada.
 *
 *   DA-02 · o que não existe aparecia como ZERO. DRE com o razão desligado,
 *           folha não gerada e caixa sem conta cadastrada produziam R$ 0,00,
 *           e zero em tela financeira lê como "está tudo certo, não há nada
 *           a pagar" — o oposto do que acontecia.
 *
 * Os dois se resolvem com o mesmo vocabulário: cada ausência tem um MOTIVO e
 * cada motivo tem uma próxima ação. Zero fica reservado para a medida que
 * realmente deu zero.
 *
 * Os sete estados:
 *   primeiro-uso     nunca houve dado aqui; o caminho é criar o primeiro
 *   sem-resultado    há dado, o filtro é que não achou; o caminho é limpar
 *   nao-configurado  falta configurar algo para a tela ter o que mostrar
 *   nao-gerado       o dado depende de uma ação que ninguém executou ainda
 *   indisponivel     a origem está desligada ou fora do ar neste ambiente
 *   sem-permissao    existe, mas este usuário não pode ver
 *   erro             falhou ao carregar; dá para tentar de novo
 */

export type TipoDeEstado =
  | "primeiro-uso"
  | "sem-resultado"
  | "nao-configurado"
  | "nao-gerado"
  | "indisponivel"
  | "sem-permissao"
  | "erro";

const ICONE: Record<TipoDeEstado, LucideIcon> = {
  "primeiro-uso": FileQuestion,
  "sem-resultado": Search,
  "nao-configurado": Settings2,
  "nao-gerado": CircleSlash,
  indisponivel: Ban,
  "sem-permissao": Lock,
  erro: TriangleAlert,
};

/** Tom do estado: o que é pendência de configuração NÃO é erro. */
const TOM: Record<TipoDeEstado, string> = {
  "primeiro-uso": "text-muted-foreground",
  "sem-resultado": "text-muted-foreground",
  "nao-configurado": "text-warning-ink",
  "nao-gerado": "text-warning-ink",
  indisponivel: "text-muted-foreground",
  "sem-permissao": "text-muted-foreground",
  erro: "text-danger-ink",
};

/**
 * Texto curto que nomeia a ausência no lugar do número.
 * NUNCA devolve "0" — é esse o ponto da DA-02.
 */
export const ROTULO_CURTO: Record<TipoDeEstado, string> = {
  "primeiro-uso": "Sem dados ainda",
  "sem-resultado": "Nenhum resultado",
  "nao-configurado": "Não configurado",
  "nao-gerado": "Não gerado",
  indisponivel: "Não disponível",
  "sem-permissao": "Sem acesso",
  erro: "Falhou ao carregar",
};

/**
 * VALOR AUSENTE — o substituto do zero enganoso em célula e KPI.
 *
 * Mostra o travessão com o motivo ao lado (ou no title, quando o espaço é de
 * tabela). Um leitor de tela ouve o motivo junto, e não só "traço".
 */
export function ValorAusente({
  tipo = "indisponivel",
  motivo,
  compacto = false,
  className,
}: {
  tipo?: TipoDeEstado;
  /** Por que não há número aqui. Obrigatório quando não é óbvio pelo tipo. */
  motivo?: string;
  /** Só o travessão, com o motivo no title (colunas estreitas de tabela). */
  compacto?: boolean;
  className?: string;
}) {
  const texto = motivo ?? ROTULO_CURTO[tipo];
  if (compacto) {
    return (
      <span
        className={cn("text-muted-foreground", className)}
        title={texto}
        aria-label={texto}
      >
        —
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className={cn("text-caption", TOM[tipo])}>{texto}</span>
    </span>
  );
}

/**
 * ESTADO DA TELA — o bloco que ocupa o lugar da lista/tabela vazia.
 *
 * Todo estado explica a causa e oferece a próxima ação possível (aceite da
 * DS-14). `acao` aceita um link pronto ou qualquer nó — um botão de limpar
 * filtro, por exemplo, que é a ação certa de "sem-resultado".
 */
export function EstadoDaTela({
  tipo,
  titulo,
  descricao,
  acao,
  acaoHref,
  acaoLabel,
  className,
}: {
  tipo: TipoDeEstado;
  titulo: string;
  descricao?: React.ReactNode;
  acao?: React.ReactNode;
  acaoHref?: string;
  acaoLabel?: string;
  className?: string;
}) {
  const Icone = ICONE[tipo];
  return (
    <div className={cn("px-6 py-10 text-center", className)}>
      <div
        className={cn(
          "mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full",
          tipo === "erro"
            ? "bg-danger-soft"
            : tipo === "nao-configurado" || tipo === "nao-gerado"
              ? "bg-warning-soft"
              : "bg-muted"
        )}
      >
        <Icone className={cn("h-5 w-5", TOM[tipo])} aria-hidden />
      </div>
      <p className="text-body font-medium text-foreground">{titulo}</p>
      {descricao && (
        <p className="mx-auto mt-1 max-w-md text-dense text-muted-foreground">
          {descricao}
        </p>
      )}
      {acao ? (
        <div className="mt-4 flex justify-center">{acao}</div>
      ) : acaoHref && acaoLabel ? (
        <div className="mt-4 flex justify-center">
          <Link
            href={acaoHref}
            className="inline-flex h-9 min-h-touch-sm items-center gap-1.5 rounded-input bg-brand px-3.5 text-dense font-medium text-brand-foreground transition-colors duration-fast hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {acaoLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
