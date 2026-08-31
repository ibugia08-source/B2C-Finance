"use client";
import { showUndoToast } from "@/components/undo-toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { UserDialog } from "./user-dialog";
import { deleteUser } from "@/lib/actions/users";

export function UserRowActions({
  user,
  people,
  canEdit,
  canDelete,
  canManagePermissions,
}: {
  user: any;
  people: any[];
  canEdit: boolean;
  canDelete: boolean;
  canManagePermissions: boolean;
}) {
  const [pending, start] = useTransition();
  if (!canEdit && !canDelete) return null;
  return (
    <div className="flex justify-end gap-1">
      {canEdit && (
        <UserDialog
          people={people}
          initial={user}
          canManagePermissions={canManagePermissions}
          trigger={
            <Button variant="ghost" size="icon" title="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          onClick={async () => {
            if (!(await confirmAction({ title: `Excluir o usuário ${user.name}?`, destructive: true }))) return;
            start(async () => {
              const res = await deleteUser(user.id);
              if (res && !res.ok) showUndoToast({ message: String(res.error) });
            });
          }}
          title="Excluir"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}
