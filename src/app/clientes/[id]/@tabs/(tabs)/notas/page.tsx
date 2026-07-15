import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "../../../shared-components";

export default async function NotasPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Empty>
          Notas de contexto do cliente {params.id} — será migrado da aba
          &quot;Contexto&quot; em breve.
        </Empty>
      </CardContent>
    </Card>
  );
}
