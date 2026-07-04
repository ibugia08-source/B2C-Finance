"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { deletePersonPayment } from "@/lib/actions/people";

export function PaymentDeleteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      onClick={() => {
        if (!confirm("Excluir este pagamento?")) return;
        start(() => deletePersonPayment(id));
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}
