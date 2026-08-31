import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { passoPorId, type PassoId } from "@/lib/setup-meta";

/**
 * Empty state padrão do sistema: ícone suave + título + descrição + ação.
 *
 * T4 + F1.20 (02 §3: "estados vazios de todas as telas apontam para o passo
 * correspondente"). Passe `passo` e a tela vazia deixa de ser um beco:
 *
 *   <EmptyState title="Nenhum cliente ainda" passo="clientes" />
 *
 * A diferença é o que o dono vê num sistema recém-instalado. Sem isto, com o
 * banco vazio (decisão 19.32), ele abre sete telas em branco e nenhuma diz o
 * que fazer — cada uma parece um erro. Com isto, cada tela vazia é o começo
 * de um caminho, e o caminho é sempre o mesmo do checklist da home.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  passo,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Passo do setup guiado que preenche esta tela. */
  passo?: PassoId;
  className?: string;
}) {
  const p = passo ? passoPorId(passo) : null;
  const Ilustra = Icon ?? p?.icon;

  return (
    <div className={cn("py-12 px-6 text-center", className)}>
      {Ilustra && (
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          <Ilustra className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {(description ?? p?.descricao) && (
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {description ?? p?.descricao}
        </p>
      )}
      {action ? (
        <div className="mt-4 flex justify-center">{action}</div>
      ) : p ? (
        <div className="mt-4 flex justify-center">
          <Link
            href={p.href}
            className="inline-flex h-9 items-center gap-1.5 rounded-input bg-brand px-3.5 text-sm font-medium text-brand-foreground transition-colors duration-fast hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {p.cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}
      {p ? (
        <p className="mt-2 text-caption text-muted-foreground">
          Passo {p.numero} de 5 · cerca de {p.minutos} min
        </p>
      ) : null}
    </div>
  );
}
