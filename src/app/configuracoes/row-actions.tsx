"use client";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { CategoryDialog } from "./category-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteCategory } from "@/lib/actions/categories";
import { useTransition } from "react";

export function CategoryRowActions({ category }: { category: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <CategoryDialog
        initial={category}
        trigger={
          <Button variant="ghost" size="icon" aria-label="Editar categoria">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Excluir categoria"
        disabled={pending}
        onClick={async () => {
          if (!(await confirmAction({ title: "Excluir esta categoria?", destructive: true }))) return;
          start(() => deleteCategory(category.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
