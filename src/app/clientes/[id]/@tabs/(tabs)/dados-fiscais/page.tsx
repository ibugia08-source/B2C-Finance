import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "../../../shared-components";

export default async function DadosFiscaisPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Empty>
          Dados fiscais do cliente {params.id} (CNPJ, endereço, segmento) — será
          extraído de &quot;Dados Principais&quot; em breve.
        </Empty>
      </CardContent>
    </Card>
  );
}
