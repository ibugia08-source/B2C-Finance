import { redirect } from "next/navigation";

export default function Default({ params }: { params: { id: string } }) {
  redirect(`/clientes/${params.id}?tab=dados-principais`);
}
