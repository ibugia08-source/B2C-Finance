"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { B2CDateRangePicker } from "@/components/b2c-date-range-picker";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const BILLING_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PARTIAL: "Parcial",
  PAID: "Paga",
  OVERDUE: "Vencida",
  CANCELED: "Cancelada",
};
const REVENUE_TYPE_LABEL: Record<string, string> = {
  MRR: "Recorrente (MRR)",
  TCV: "Contrato fechado (TCV)",
  ONE_TIME: "Avulsa",
  SETUP: "Setup",
  RECOVERY: "Recuperação",
  OTHER: "Outra",
};
const EXPENSE_TYPE_LABEL: Record<string, string> = {
  FIXED: "Fixa",
  VARIABLE: "Variável",
  PAYROLL: "Folha",
  TAX: "Imposto",
  TOOL: "Ferramenta",
  ADS: "Mídia/Ads",
  LOAN: "Empréstimo",
  CARD: "Cartão",
  OTHER: "Outra",
};

const CLIENT_STATUS_LABEL: Record<string, string> = {
  PROSPECT: "Prospecção",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  RENEWAL: "Em renovação",
  DELINQUENT: "Inadimplente",
  CHURNED: "Perdido",
  INACTIVE: "Inativo",
};

const ENTITY_PARAMS = [
  "cliente", "servico", "status", "treceita", "tdespesa",
  "modalidade", "responsavel", "segmento", "statuscliente",
] as const;

type Opt = { id: string; name: string };

/** Filtro global do dashboard executivo: período + cliente/serviço/status/tipos. */
export function DashboardFilters({
  clients,
  services,
  owners = [],
  segments = [],
}: {
  clients: Opt[];
  services: Opt[];
  owners?: string[];
  segments?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    const params = new URLSearchParams(sp.toString());
    ENTITY_PARAMS.forEach((p) => params.delete(p));
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasEntityFilter = ENTITY_PARAMS.some((p) => sp.get(p));

  const selectCls = "h-8 text-xs min-w-[130px]";

  return (
    <div className="space-y-3">
      <B2CDateRangePicker />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Cliente</Label>
          <Select className={selectCls} value={sp.get("cliente") ?? ""} onChange={(e) => setParam("cliente", e.target.value)}>
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Serviço</Label>
          <Select className={selectCls} value={sp.get("servico") ?? ""} onChange={(e) => setParam("servico", e.target.value)}>
            <option value="">Todos</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status financeiro</Label>
          <Select className={selectCls} value={sp.get("status") ?? ""} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(BILLING_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tipo de receita</Label>
          <Select className={selectCls} value={sp.get("treceita") ?? ""} onChange={(e) => setParam("treceita", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(REVENUE_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tipo de despesa</Label>
          <Select className={selectCls} value={sp.get("tdespesa") ?? ""} onChange={(e) => setParam("tdespesa", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(EXPENSE_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Modalidade</Label>
          <Select className={selectCls} value={sp.get("modalidade") ?? ""} onChange={(e) => setParam("modalidade", e.target.value)}>
            <option value="">Todas</option>
            <option value="MRR">MRR</option>
            <option value="TCV">TCV</option>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Responsável</Label>
          <Select className={selectCls} value={sp.get("responsavel") ?? ""} onChange={(e) => setParam("responsavel", e.target.value)}>
            <option value="">Todos</option>
            {owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Segmento</Label>
          <Select className={selectCls} value={sp.get("segmento") ?? ""} onChange={(e) => setParam("segmento", e.target.value)}>
            <option value="">Todos</option>
            {segments.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status do cliente</Label>
          <Select className={selectCls} value={sp.get("statuscliente") ?? ""} onChange={(e) => setParam("statuscliente", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(CLIENT_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        {hasEntityFilter && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAll}>
            <X className="h-3.5 w-3.5 mr-1" /> Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
