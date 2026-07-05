import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton cards={8} rows={4} />;
}
