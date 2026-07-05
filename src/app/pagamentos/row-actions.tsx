"use client";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { deleteBillingPayment } from "@/lib/actions/billings";
import { useTransition } from "react";

export function PaymentRowActions({ payment }: { payment: any }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Excluir pagamento (reverte o saldo da cobrança)"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            "Excluir este pagamento? O saldo e o status da cobrança serão revertidos."
          )
        )
          return;
        start(async () => {
          const res = await deleteBillingPayment(payment.id);
          if (!res.ok) alert(res.error);
        });
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}
