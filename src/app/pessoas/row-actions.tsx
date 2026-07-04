"use client";
import { Button } from "@/components/ui/button";
import { PersonDialog } from "./person-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deletePerson } from "@/lib/actions/people";
import { useTransition } from "react";

export function PersonRowActions({ person }: { person: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      <PersonDialog
        initial={person}
        trigger={
          <Button variant="ghost" size="icon">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => {
          if (!confirm("Excluir esta pessoa?")) return;
          start(() => deletePerson(person.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
