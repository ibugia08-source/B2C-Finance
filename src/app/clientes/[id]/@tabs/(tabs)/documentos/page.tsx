import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "../../../shared-components";

export default async function DocumentosPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold mb-3">Contratos gerados</h2>
          <Empty>
            Conteúdo de contratos gerados será migrado da aba &quot;Documentos&quot; em breve.
          </Empty>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold mb-3">Documentos anexados</h2>
          <Empty>
            Conteúdo de documentos anexados será migrado da aba &quot;Documentos&quot; em breve.
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
