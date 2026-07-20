"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  CLIENT_MODALITIES,
  CLIENT_MODALITY_LABEL,
  MONTHS,
} from "./_meta";

/**
 * Filtros do módulo Clientes — simples e diretos: busca (nome/razão social/
 * CNPJ), Status, Modalidade, Responsável, Inadimplência, Mês de renovação e
 * Segmento. Os filtros só são aplicados ao clicar em FILTRAR; LIMPAR FILTROS
 * restaura a lista padrão.
 */
export function ClientFilters({
  segments,
  owners,
}: {
  segments: string[];
  owners: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  // Estado local: só vai para a URL ao clicar em "Filtrar".
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [modalidade, setModalidade] = useState(sp.get("modalidade") ?? "");
  const [responsavel, setResponsavel] = useState(sp.get("responsavel") ?? "");
  const [inadimplencia, setInadimplencia] = useState(sp.get("inadimplencia") ?? "");
  const [mesRenovacao, setMesRenovacao] = useState(sp.get("mesRenovacao") ?? "");
  const [segmento, setSegmento] = useState(sp.get("segmento") ?? "");

  const hasAny = Array.from(sp.keys()).some((k) => k !== "pagina" && k !== "porPagina");

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams();
    // Preserva o tamanho de página escolhido.
    const porPagina = sp.get("porPagina");
    if (porPagina) params.set("porPagina", porPagina);
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (modalidade) params.set("modalidade", modalidade);
    if (responsavel) params.set("responsavel", responsavel);
    if (inadimplencia) params.set("inadimplencia", inadimplencia);
    if (mesRenovacao) params.set("mesRenovacao", mesRenovacao);
    if (segmento) params.set("segmento", segmento);
    router.push(`/clientes${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function clear() {
    setQ(""); setStatus(""); setModalidade(""); setResponsavel("");
    setInadimplencia(""); setMesRenovacao(""); setSegmento("");
    const porPagina = sp.get("porPagina");
    router.push(`/clientes${porPagina ? `?porPagina=${porPagina}` : ""}`);
  }

  return (
    <form onSubmit={apply} className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 items-end">
        <div className="col-span-2">
          <Label className="text-xs">Buscar</Label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, razão social ou CNPJ/CPF…"
          />
        </div>

        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => (
              <option key={s} value={s}>{CLIENT_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Modalidade</Label>
          <Select value={modalidade} onChange={(e) => setModalidade(e.target.value)}>
            <option value="">Todas</option>
            {CLIENT_MODALITIES.map((m) => (
              <option key={m} value={m}>{CLIENT_MODALITY_LABEL[m]}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Responsável</Label>
          <Select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">Todos</option>
            {owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Inadimplência (mês)</Label>
          <Select value={inadimplencia} onChange={(e) => setInadimplencia(e.target.value)}>
            <option value="">Todos</option>
            <option value="pago">Pago</option>
            <option value="devendo">Devendo</option>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Mês de renovação</Label>
          <Select value={mesRenovacao} onChange={(e) => setMesRenovacao(e.target.value)}>
            <option value="">Todos</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={String(m.value)}>{m.label}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Segmento</Label>
          <Select value={segmento} onChange={(e) => setSegmento(e.target.value)}>
            <option value="">Todos</option>
            {segments.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          <Filter className="h-3.5 w-3.5 mr-1.5" /> Filtrar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clear}
          disabled={!hasAny && !q && !status && !modalidade && !responsavel && !inadimplencia && !mesRenovacao && !segmento}
        >
          <X className="h-3.5 w-3.5 mr-1.5" /> Limpar filtros
        </Button>
      </div>
    </form>
  );
}
