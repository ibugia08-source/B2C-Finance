"use client";
import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { linkPersonToUser } from "@/lib/actions/users";
import { Link as LinkIcon, Unlink } from "lucide-react";

export function LinkUserPicker({
  personId,
  currentUserId,
  users,
}: {
  personId: string;
  currentUserId: string | null;
  users: { id: string; name: string; email: string; role: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        defaultValue={currentUserId ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(() =>
            linkPersonToUser(personId, e.target.value || null)
          )
        }
        className="h-9 text-sm w-full sm:w-[260px]"
      >
        <option value="">— sem usuário vinculado</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {u.email} ({u.role})
          </option>
        ))}
      </Select>
      {currentUserId && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => start(() => linkPersonToUser(personId, null))}
          title="Desvincular"
        >
          <Unlink className="h-3.5 w-3.5" />
        </Button>
      )}
      {!currentUserId && (
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <LinkIcon className="h-3 w-3" /> nenhum usuário
        </span>
      )}
    </div>
  );
}
