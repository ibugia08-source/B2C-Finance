"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { B2CDateRangePicker } from "@/components/b2c-date-range-picker";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Columns3, Download, Printer, X } from "lucide-react";
import { renewalCompetenceOptions } from "@/lib/renewal-expectation";
import { SEM_NICHO, SEM_NICHO_LABEL } from "@/lib/niches";

type Opt = { id: string; name: string };
type VL = { value: string; label: string };

export type ReportControlsConfig = {
  reportKey: string;
  /** Sem relatorios.exportar os botões CSV/XLSX nem aparecem (a rota de
   *  export responderia 403 em JSON cru — auditoria 2026-08-13). */
  canExport?: boolean;
  filterFields: string[];
  columns: { key: string; label: string }[];
  groupOptions: { key: string; label: string }[];
  statusOptions?: VL[];
  tipoOptions?: VL[];
  clients: Opt[];
  services: Opt[];
  contracts: Opt[];
  categories: Opt[];
  /** Nomes já cadastrados (colaboradores + responsáveis gravados em clientes). */
  responsaveis?: string[];
  segmentos?: string[];
  origens?: string[];
  ufs?: string[];
};

const FILTER_PARAM_KEYS = [
  "cliente", "servico", "contrato", "status", "categoria", "responsavel",
  "tipo", "valorMin", "valorMax", "vencDe", "vencAte", "competencia", "pago", "situacao",
  "modalidade", "segmento", "origem", "uf", "mesRenovacao",
];

/**
 * Painel de personalização do relatório: filtros + colunas + agrupamento +
 * ordenação + totais/gráficos + exportação. Tudo via searchParams.
 */
export function ReportControls(cfg: ReportControlsConfig) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    const params = new URLSearchParams(sp.toString());
    FILTER_PARAM_KEYS.forEach((k) => params.delete(k));
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleColumn(key: string) {
    const all = cfg.columns.map((c) => c.key);
    const current = sp.get("colunas")?.split(",").filter(Boolean) ?? all;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    // mantém a ordem da definição; vazio não é permitido
    const ordered = all.filter((k) => next.includes(k));
    set("colunas", ordered.length === 0 || ordered.length === all.length ? "" : ordered.join(","));
  }

  const selectedCols = sp.get("colunas")?.split(",").filter(Boolean) ?? cfg.columns.map((c) => c.key);
  const has = (f: string) => cfg.filterFields.includes(f);
  const hasFilters = FILTER_PARAM_KEYS.some((k) => sp.get(k));
  const exportQS = sp.toString();
  const selectCls = "h-8 text-xs min-w-[130px]";

  return (
    <div className="space-y-3">
      {has("periodo") && <B2CDateRangePicker />}

      {/* Filtros de entidade */}
      <div className="flex flex-wrap items-end gap-2">
        {has("cliente") && (
          <FilterSelect label="Cliente" value={sp.get("cliente") ?? ""} onChange={(v) => set("cliente", v)} className={selectCls}>
            <option value="">Todos</option>
            {cfg.clients.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </FilterSelect>
        )}
        {has("servico") && (
          <FilterSelect label="Serviço" value={sp.get("servico") ?? ""} onChange={(v) => set("servico", v)} className={selectCls}>
            <option value="">Todos</option>
            {cfg.services.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </FilterSelect>
        )}
        {has("contrato") && (
          <FilterSelect label="Contrato" value={sp.get("contrato") ?? ""} onChange={(v) => set("contrato", v)} className={selectCls}>
            <option value="">Todos</option>
            {cfg.contracts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </FilterSelect>
        )}
        {has("categoria") && (
          <FilterSelect label="Categoria" value={sp.get("categoria") ?? ""} onChange={(v) => set("categoria", v)} className={selectCls}>
            <option value="">Todas</option>
            {cfg.categories.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </FilterSelect>
        )}
        {has("status") && cfg.statusOptions && (
          <FilterSelect label="Status" value={sp.get("status") ?? ""} onChange={(v) => set("status", v)} className={selectCls}>
            <option value="">Todos</option>
            {cfg.statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FilterSelect>
        )}
        {has("tipo") && cfg.tipoOptions && (
          <FilterSelect label="Tipo" value={sp.get("tipo") ?? ""} onChange={(v) => set("tipo", v)} className={selectCls}>
            <option value="">Todos</option>
            {cfg.tipoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FilterSelect>
        )}
        {has("situacao") && (
          <FilterSelect label="Situação" value={sp.get("situacao") ?? ""} onChange={(v) => set("situacao", v)} className={selectCls}>
            <option value="">Todas</option>
            <option value="inadimplente">Inadimplente</option>
            <option value="a_vencer">A vencer</option>
            <option value="vencido">Vencido</option>
          </FilterSelect>
        )}
        {has("pago") && (
          <FilterSelect label="Pagamento" value={sp.get("pago") ?? ""} onChange={(v) => set("pago", v)} className={selectCls}>
            <option value="">Todos</option>
            <option value="sim">Pago</option>
            <option value="nao">Não pago</option>
          </FilterSelect>
        )}
        {has("responsavel") && (
          <FilterSelect label="Responsável" value={sp.get("responsavel") ?? ""} onChange={(v) => set("responsavel", v)} className={selectCls}>
            <option value="">Todos</option>
            {(cfg.responsaveis ?? []).map((nome) => <option key={nome} value={nome}>{nome}</option>)}
          </FilterSelect>
        )}
        {has("modalidade") && (
          <FilterSelect label="Modalidade" value={sp.get("modalidade") ?? ""} onChange={(v) => set("modalidade", v)} className={selectCls}>
            <option value="">Todas</option>
            <option value="MRR">MRR (mensal)</option>
            <option value="TCV">TCV (contrato fechado)</option>
          </FilterSelect>
        )}
        {has("segmento") && (
          <FilterSelect label="Nicho" value={sp.get("segmento") ?? ""} onChange={(v) => set("segmento", v)} className={selectCls}>
            <option value="">Todos</option>
            <option value={SEM_NICHO}>{SEM_NICHO_LABEL}</option>
            {(cfg.segmentos ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
          </FilterSelect>
        )}
        {has("origem") && (
          <FilterSelect label="Origem" value={sp.get("origem") ?? ""} onChange={(v) => set("origem", v)} className={selectCls}>
            <option value="">Todas</option>
            {(cfg.origens ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
          </FilterSelect>
        )}
        {has("uf") && (
          <FilterSelect label="UF" value={sp.get("uf") ?? ""} onChange={(v) => set("uf", v)} className="h-8 text-xs min-w-[80px]">
            <option value="">Todas</option>
            {(cfg.ufs ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
          </FilterSelect>
        )}
        {has("mesRenovacao") && (
          <FilterSelect label="Renovação prevista" value={sp.get("mesRenovacao") ?? ""} onChange={(v) => set("mesRenovacao", v)} className={selectCls}>
            <option value="">Todos</option>
            {renewalCompetenceOptions(sp.get("mesRenovacao"), { back: 6, ahead: 18 }).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FilterSelect>
        )}
        {has("valor") && (
          <>
            <BlurInput label="Valor mín. (R$)" placeholder="0,00" defaultValue={sp.get("valorMin") ?? ""} onCommit={(v) => set("valorMin", v)} narrow />
            <BlurInput label="Valor máx. (R$)" placeholder="0,00" defaultValue={sp.get("valorMax") ?? ""} onCommit={(v) => set("valorMax", v)} narrow />
          </>
        )}
        {has("vencimento") && (
          <>
            <div>
              <Label className="text-xs">Venc. de</Label>
              <Input type="date" className="h-8 text-xs" defaultValue={sp.get("vencDe") ?? ""} onChange={(e) => set("vencDe", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Venc. até</Label>
              <Input type="date" className="h-8 text-xs" defaultValue={sp.get("vencAte") ?? ""} onChange={(e) => set("vencAte", e.target.value)} />
            </div>
          </>
        )}
        {has("competencia") && (
          <div>
            <Label className="text-xs">Competência</Label>
            <Input type="month" className="h-8 text-xs" defaultValue={sp.get("competencia") ?? ""} onChange={(e) => set("competencia", e.target.value)} />
          </div>
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            <X className="h-3.5 w-3.5 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Apresentação + exportação */}
      <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border/60">
        <details className="relative">
          <summary className="list-none cursor-pointer">
            <span className="inline-flex items-center h-8 px-3 rounded-md border border-input bg-background text-xs">
              <Columns3 className="h-3.5 w-3.5 mr-1.5" />
              Colunas ({selectedCols.length}/{cfg.columns.length})
            </span>
          </summary>
          <div className="absolute z-20 mt-1 w-56 rounded-md border bg-popover p-2 shadow-md space-y-1">
            {cfg.columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-xs px-1 py-0.5 rounded hover:bg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedCols.includes(c.key)}
                  onChange={() => toggleColumn(c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </details>

        {cfg.groupOptions.length > 0 && (
          <FilterSelect label="Agrupar por" value={sp.get("agrupar") ?? ""} onChange={(v) => set("agrupar", v)} className={selectCls}>
            <option value="">Sem agrupamento</option>
            {cfg.groupOptions.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </FilterSelect>
        )}
        <FilterSelect label="Ordenar por" value={sp.get("ordenar") ?? ""} onChange={(v) => set("ordenar", v)} className={selectCls}>
          <option value="">Padrão</option>
          {cfg.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </FilterSelect>
        {sp.get("ordenar") && (
          <FilterSelect label="Direção" value={sp.get("dir") ?? "desc"} onChange={(v) => set("dir", v)} className="h-8 text-xs">
            <option value="desc">Maior → menor</option>
            <option value="asc">Menor → maior</option>
          </FilterSelect>
        )}

        <button type="button" onClick={() => set("totais", sp.get("totais") === "0" ? "" : "0")}>
          <Badge variant={sp.get("totais") !== "0" ? "default" : "outline"}>Totais</Badge>
        </button>
        <button type="button" onClick={() => set("grafico", sp.get("grafico") === "0" ? "" : "0")}>
          <Badge variant={sp.get("grafico") !== "0" ? "default" : "outline"}>Gráfico</Badge>
        </button>

        <span className="flex-1" />

        {cfg.canExport !== false && (
          <>
            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
              <a href={`/relatorios/${cfg.reportKey}/export?formato=csv${exportQS ? `&${exportQS}` : ""}`}>
                <Download className="h-3.5 w-3.5 mr-1" /> CSV
              </a>
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
              <a href={`/relatorios/${cfg.reportKey}/export?formato=xlsx${exportQS ? `&${exportQS}` : ""}`}>
                <Download className="h-3.5 w-3.5 mr-1" /> XLSX
              </a>
            </Button>
          </>
        )}
        {/* PDF = documento próprio, não a impressão desta tela. A tela tem
            a tabela num contêiner com rolagem horizontal, e o que rola no
            monitor SOME no papel — foi a causa dos nove relatórios cortados
            na auditoria de 10/09/2026 (P0.1). */}
        <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
          <a
            href={`/relatorios/${cfg.reportKey}/pdf${exportQS ? `?${exportQS}` : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            <Printer className="h-3.5 w-3.5 mr-1" /> PDF
          </a>
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, className, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </div>
  );
}

function BlurInput({
  label, defaultValue, onCommit, placeholder, narrow,
}: {
  label: string;
  defaultValue: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  narrow?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        className={`h-8 text-xs ${narrow ? "w-24" : "w-36"}`}
        placeholder={placeholder}
        defaultValue={defaultValue}
        onBlur={(e) => { if (e.target.value !== defaultValue) onCommit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit((e.target as HTMLInputElement).value);
        }}
      />
    </div>
  );
}
