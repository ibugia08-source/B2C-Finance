"use client";
import Link from "next/link";
import { ArrowLeft, FileSignature, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { formatBRL, formatDateBR } from "@/lib/format";
import type { ClientRiskProfile } from "@/lib/services/client-metrics";
import { ClientStatusSelect } from "../status-select";
import { ClientDialog } from "../client-dialog";
import {
  AttachDocumentDialog,
  NoteDialog,
} from "./dossier-dialogs";

export interface ClientHeaderProps {
  client: {
    id: string;
    name: string;
    legalName: string | null;
    segment: string | null;
    city: string | null;
    state: string | null;
    status: string;
  };
  summary: {
    activeContracts: number;
    nextRenewal: Date | null;
    totalRevenue: number;
    openAmount: number;
    overdueAmount: number;
  };
  monthly: number;
  risk: ClientRiskProfile;
}

const RISK_BADGE: Record<ClientRiskProfile["riskLevel"], any> = {
  baixo: "success",
  medio: "warning",
  alto: "destructive",
  sem_historico: "secondary",
};

export function ClientHeader({ client, summary, monthly, risk }: ClientHeaderProps) {
  const onTimePct =
    risk.onTimeRate != null ? Math.round(risk.onTimeRate * 100) : null;
  return (
    <>
      <div className="mb-4">
        <Link
          href="/clientes"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar para clientes
        </Link>
      </div>

      <PageHeader
        title={client.name}
        description={[
          client.legalName,
          client.segment,
          client.city && `${client.city}/${client.state ?? ""}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <ClientStatusSelect clientId={client.id} status={client.status} />
            <ClientDialog
              initial={{
                ...client,
              }}
              trigger={<Button variant="outline">Editar</Button>}
            />
          </div>
        }
      />

      {/* Atalhos rápidos */}
      <div className="flex flex-wrap items-center gap-2 mb-5 print:hidden">
        <Button size="sm" asChild>
          <Link href={`/contratos?para=${client.id}`}>
            <FileSignature className="h-3.5 w-3.5 mr-1" /> Gerar contrato
          </Link>
        </Button>
        <AttachDocumentDialog clientId={client.id} />
        <NoteDialog clientId={client.id} />
        <Button size="sm" variant="outline" asChild>
          <Link href={`/clientes/${client.id}?tab=cobrancas`}>
            <HandCoins className="h-3.5 w-3.5 mr-1" /> Nova cobrança
          </Link>
        </Button>
      </div>

      {/* Mini-dashboard do cliente */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard
          title="Mensal contratado"
          value={monthly > 0 ? formatBRL(monthly) : "—"}
          hint={
            summary.activeContracts > 0
              ? `${summary.activeContracts} contrato(s) ativo(s)`
              : "valor de referência do cadastro"
          }
        />
        <StatCard
          title="Total recebido (LTV)"
          value={summary.totalRevenue > 0 ? formatBRL(summary.totalRevenue) : "—"}
          intent="positive"
          hint="tudo que este cliente já pagou"
        />
        <StatCard
          title="Tempo de casa"
          value={
            risk.monthsActive != null
              ? `${risk.monthsActive} ${risk.monthsActive === 1 ? "mês" : "meses"}`
              : "—"
          }
          hint="ativo na base desde a entrada"
        />
        <StatCard
          title="Em aberto"
          value={summary.openAmount > 0 ? formatBRL(summary.openAmount) : "R$ 0,00"}
          intent={summary.overdueAmount > 0 ? "negative" : "default"}
          hint={
            summary.overdueAmount > 0
              ? `${formatBRL(summary.overdueAmount)} vencido`
              : undefined
          }
        />
        <StatCard
          title="Próxima renovação"
          value={summary.nextRenewal ? formatDateBR(summary.nextRenewal) : "—"}
        />
        {/* Perfil de pagamento / risco de inadimplência individual */}
        <div className="rounded-xl border bg-card p-4 flex flex-col justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Perfil de pagamento
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge variant={RISK_BADGE[risk.riskLevel]} className="text-sm">
              {risk.payerLabel}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {onTimePct != null
              ? `${onTimePct}% pagas no prazo · ${risk.paidCount} quitada(s)`
              : "sem pagamentos registrados"}
            {risk.overdueCount > 0 ? ` · ${risk.overdueCount} vencida(s)` : ""}
          </p>
        </div>
      </div>
    </>
  );
}
