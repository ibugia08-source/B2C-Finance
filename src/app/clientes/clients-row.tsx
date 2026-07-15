"use client";
import Link from "next/link";
import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineSelect } from "./inline-select";
import { DelinquencyCell } from "./clients-actions";
import { ClientActions } from "./row-actions";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  CLIENT_MODALITIES,
  CLIENT_MODALITY_LABEL,
  MONTHS,
  clientStatusPill,
  modalityPill,
} from "./_meta";
import {
  setClientStatus,
  setClientModality,
  setClientRenewalMonth,
} from "@/lib/actions/clients";
import type { ClientRow } from "./clients-table";

const STATUS_OPTIONS = CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => ({
  value: s,
  label: CLIENT_STATUS_LABEL[s],
}));
const MODALITY_OPTIONS = CLIENT_MODALITIES.map((m) => ({
  value: m,
  label: CLIENT_MODALITY_LABEL[m],
}));
const MONTH_OPTIONS = MONTHS.map((m) => ({ value: String(m.value), label: m.label }));

export function ClientRowDesktop({
  client,
  selected,
  onToggle,
  onStatusDone,
}: {
  client: ClientRow;
  selected: boolean;
  onToggle: () => void;
  onStatusDone: (c: ClientRow) => (value: string) => void;
}) {
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`Selecionar ${client.name}`}
          checked={selected}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell className="font-medium">
        <Link href={`/clientes/${client.id}`} className="hover:underline">
          {client.name}
        </Link>
        {client.segment && (
          <p className="text-xs text-muted-foreground">{client.segment}</p>
        )}
      </TableCell>
      <TableCell>
        <InlineSelect
          ariaLabel={`Status de ${client.name}`}
          value={client.status}
          options={STATUS_OPTIONS}
          pillClass={clientStatusPill}
          action={(v) => setClientStatus(client.id, v)}
          onDone={onStatusDone(client)}
        />
      </TableCell>
      <TableCell>
        <InlineSelect
          ariaLabel={`Modalidade de ${client.name}`}
          value={client.modality ?? ""}
          options={MODALITY_OPTIONS}
          pillClass={modalityPill}
          allowEmpty
          emptyLabel="— definir —"
          action={(v) => setClientModality(client.id, v || null)}
        />
      </TableCell>
      <TableCell>
        <DelinquencyCell client={client} />
      </TableCell>
      <TableCell>
        <InlineSelect
          ariaLabel={`Mês de renovação de ${client.name}`}
          value={client.renewalMonth != null ? String(client.renewalMonth) : ""}
          options={MONTH_OPTIONS}
          allowEmpty
          emptyLabel="— definir —"
          action={(v) => setClientRenewalMonth(client.id, v ? parseInt(v, 10) : null)}
        />
      </TableCell>
      <TableCell className="text-sm">{client.salesOwner ?? "—"}</TableCell>
      <TableCell className="text-right">
        <ClientActions client={client} />
      </TableCell>
    </TableRow>
  );
}
