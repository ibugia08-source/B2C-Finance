import { Card, CardContent } from "@/components/ui/card";
import { B2CMascot } from "./mascot";

export function UnlinkedBanner() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          <div className="flex justify-center">
            <B2CMascot pose="welcome" width={150} className="drop-shadow-xl" />
          </div>
          <h2 className="text-xl font-bold">Acesso pendente</h2>
          <p className="text-sm text-muted-foreground">
            Seu usuário ainda não está vinculado a uma pessoa financeira no sistema.
            <br />
            Fale com o administrador para liberar o acesso aos seus dados.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminOnlyBanner() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Card className="max-w-md">
        <CardContent className="p-8 text-center space-y-3">
          <h2 className="text-lg font-bold">Área administrativa</h2>
          <p className="text-sm text-muted-foreground">
            Esta área está disponível apenas para administradores.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
