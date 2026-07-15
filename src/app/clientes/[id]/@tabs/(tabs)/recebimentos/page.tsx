import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "../../../shared-components";

export default async function RecebimentosPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Empty>
          Conteúdo de recebimentos do cliente {params.id} — será migrado da aba
          &quot;Cobranças&quot; em breve.
        </Empty>
      </CardContent>
    </Card>
  );
}
