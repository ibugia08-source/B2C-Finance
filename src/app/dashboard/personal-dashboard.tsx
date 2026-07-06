import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getViewer } from "@/lib/auth/viewer";
import { Sparkles } from "lucide-react";

/**
 * Dashboard do usuário comum (não-admin). Os módulos financeiros são da
 * agência (admin) — aqui fica só a recepção e o atalho para o Assistente.
 */
export async function PersonalDashboard() {
  const viewer = await getViewer("/dashboard");
  const firstName = viewer.name?.split(" ")[0] ?? "!";

  return (
    <div>
      <PageHeader
        title={`Olá, ${firstName}`}
        description="Bem-vindo ao B2C Finance"
      />
      <Card className="max-w-xl">
        <CardContent className="p-8 text-center space-y-4">
          <Sparkles className="h-10 w-10 text-primary mx-auto" />
          <div>
            <p className="font-semibold text-lg">Assistente IA da B2C</p>
            <p className="text-sm text-muted-foreground mt-1">
              Tire dúvidas e peça apoio no dia a dia. Os módulos financeiros da
              agência são gerenciados pelos administradores.
            </p>
          </div>
          <Button asChild>
            <Link href="/assistente">Abrir o Assistente</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
