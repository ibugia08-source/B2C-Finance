"use client";
import { useRouter } from "next/navigation";
import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientActions } from "./row-actions";
import type { ClientColumn, ColumnCtx } from "./columns";
import type { ClientRow } from "./clients-table";

/** Célula interativa: cliques não abrem a área do cliente (edição inline). */
function stop(e: React.MouseEvent) {
  e.stopPropagation();
}

export function ClientRowDesktop({
  client,
  selected,
  onToggle,
  columns,
  ctx,
}: {
  client: ClientRow;
  selected: boolean;
  onToggle: () => void;
  columns: ClientColumn[];
  ctx: ColumnCtx;
}) {
  const router = useRouter();
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className="cursor-pointer"
      onClick={() => router.push(`/clientes/${client.id}`)}
      title="Abrir a área do cliente"
    >
      <TableCell onClick={stop}>
        <Checkbox
          aria-label={`Selecionar ${client.name}`}
          checked={selected}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell className="font-medium">
        <span className="hover:underline">{client.name}</span>
      </TableCell>
      {columns.map((col) => (
        <TableCell
          key={col.key}
          className={col.tdClass}
          onClick={col.interactive ? stop : undefined}
        >
          {col.render(client, ctx)}
        </TableCell>
      ))}
      <TableCell className="text-right" onClick={stop}>
        <ClientActions client={client} />
      </TableCell>
    </TableRow>
  );
}
