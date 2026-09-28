import Link from "next/link";
import { Activity } from "lucide-react";
import type { ActivityKind, ActivityResult, ActivitySource } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/viewer";
import { domainContextFor } from "@/lib/auth/domain-session";
import { listarAtividades } from "@/lib/services/api-activities";
import { RESULT_LABEL, RETENCAO_DIAS, SOURCE_LABEL, actionLabel } from "@/lib/api/activity-meta";
import { formatBRL, formatInstantTimeBR } from "@/lib/format";
import { IntegracoesTabs } from "../tabs";

/**
 * CONFIGURAÇÕES → INTEGRAÇÕES → ATIVIDADES DA IA/API (28/09/2026).
 *
 * Uma linha por chamada das integrações: quando, qual integração, de onde
 * (n8n, WhatsApp…), o quê, sobre quem e como terminou. Filtros por URL
 * (funcionam sem JavaScript e dá para mandar o link).
 */
export const dynamic = "force-dynamic";

const SOURCES: ActivitySource[] = ["API", "N8N", "TELEGRAM", "WHATSAPP", "WEB", "SYSTEM"];
const RESULTS: ActivityResult[] = ["SUCCESS", "ERROR", "DENIED", "REPLAYED"];
const POR_PAGINA = 50;

const RESULT_CLASS: Record<ActivityResult, string> = {
  SUCCESS: "bg-success-soft text-success-ink",
  ERROR: "bg-danger-soft text-danger-ink",
  DENIED: "bg-warning-soft text-warning-ink",
  REPLAYED: "bg-info-soft text-info-ink",
};

type SP = { integracao?: string; origem?: string; resultado?: string; tipo?: string; pagina?: string };

const umDe = <T extends string>(v: string | undefined, lista: readonly T[]) =>
  v && (lista as readonly string[]).includes(v) ? (v as T) : undefined;

export default async function AtividadesPage({ searchParams }: { searchParams: SP }) {
  const viewer = await requirePagePermission("integracoes.visualizar", "/configuracoes/integracoes/atividades");
  const ctx = await domainContextFor(viewer);
  const page = Math.max(1, Number.parseInt(searchParams.pagina ?? "1", 10) || 1);
  const tipo = umDe<ActivityKind>(searchParams.tipo === "acoes" ? "WRITE" : searchParams.tipo === "consultas" ? "READ" : undefined, ["READ", "WRITE"]);
  const r = await listarAtividades(ctx, {
    serviceAccountId: searchParams.integracao || undefined,
    source: umDe(searchParams.origem, SOURCES),
    result: umDe(searchParams.resultado, RESULTS),
    kind: tipo,
    page,
    pageSize: POR_PAGINA,
  });
  const totalPaginas = Math.max(1, Math.ceil(r.total / POR_PAGINA));
  const link = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "pagina") u.set(k, v);
    if (p > 1) u.set("pagina", String(p));
    const s = u.toString();
    return `/configuracoes/integracoes/atividades${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Integrações · API"
        description="O que as integrações (n8n, agente de WhatsApp) consultaram e fizeram no B2C Finance."
      />
      <IntegracoesTabs ativa="atividades" />

      <form method="get" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Filtrar atividades">
        <select name="integracao" defaultValue={searchParams.integracao ?? ""} aria-label="Integração"
          className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
          <option value="">Todas as integrações</option>
          {r.integracoes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select name="origem" defaultValue={searchParams.origem ?? ""} aria-label="Origem"
          className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
          <option value="">Todas as origens</option>
          {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
        <select name="resultado" defaultValue={searchParams.resultado ?? ""} aria-label="Resultado"
          className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
          <option value="">Todos os resultados</option>
          {RESULTS.map((s) => <option key={s} value={s}>{RESULT_LABEL[s]}</option>)}
        </select>
        <select name="tipo" defaultValue={searchParams.tipo ?? ""} aria-label="Tipo"
          className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
          <option value="">Ações e consultas</option>
          <option value="acoes">Só ações (escritas)</option>
          <option value="consultas">Só consultas</option>
        </select>
        <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          Filtrar
        </button>
      </form>

      {r.linhas.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nenhuma atividade"
          description="Quando uma integração chamar a API, cada chamada aparece aqui — com a origem, a ação e o resultado."
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Integração</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.linhas.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatInstantTimeBR(l.createdAt)}</TableCell>
                    <TableCell>{l.integracao ?? "—"}</TableCell>
                    <TableCell>{SOURCE_LABEL[l.source] ?? l.source}</TableCell>
                    <TableCell>
                      {actionLabel(l.action)}
                      {l.kind === "READ" && <span className="ml-1 text-caption text-muted-foreground">(consulta)</span>}
                    </TableCell>
                    <TableCell>
                      {l.label ?? (l.entityId ? <span className="font-mono text-caption">{l.entityId}</span> : "—")}
                      {l.amount != null && <span className="block tabular-nums text-muted-foreground">{formatBRL(l.amount)}</span>}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-caption font-medium ${RESULT_CLASS[l.result]}`}
                        title={`HTTP ${l.httpStatus}${l.errorCode ? ` · ${l.errorCode}` : ""} · requestId ${l.requestId}`}
                      >
                        {RESULT_LABEL[l.result]}
                      </span>
                      {l.errorCode && <span className="ml-1 font-mono text-caption text-muted-foreground">{l.errorCode}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <p>
          {r.total} registro(s). Consultas ficam {RETENCAO_DIAS.READ} dias; ações, {RETENCAO_DIAS.WRITE} dias.
        </p>
        {totalPaginas > 1 && (
          <nav aria-label="Paginação" className="flex items-center gap-3">
            {page > 1 && <Link className="underline hover:text-foreground" href={link(page - 1)}>Anterior</Link>}
            <span>Página {page} de {totalPaginas}</span>
            {page < totalPaginas && <Link className="underline hover:text-foreground" href={link(page + 1)}>Próxima</Link>}
          </nav>
        )}
      </div>
    </div>
  );
}
