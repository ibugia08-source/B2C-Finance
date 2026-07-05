"use client";
import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { setClientStatus } from "@/lib/actions/clients";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL } from "./_meta";

/** Troca rápida de status (ativo/pausado/cancelado/inadimplente/renovação). */
export function ClientStatusSelect({
  clientId,
  status,
  className,
}: {
  clientId: string;
  status: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Select
        className={className ?? "h-8 w-auto text-xs"}
        value={status}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            setError(null);
            const res = await setClientStatus(clientId, e.target.value);
            if (!res.ok) setError(res.error);
          })
        }
      >
        {CLIENT_STATUSES.filter((s) => s !== "LEAD" || s === status).map((s) => (
          <option key={s} value={s}>
            {CLIENT_STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
