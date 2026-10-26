import {
  ListeningPeriod,
  periodMetadata,
} from "@/listening/components/ListeningPeriod";

export const prefetch = "partial";

export const metadata = periodMetadata("overall");

export default function ListeningPage() {
  return <ListeningPeriod period="overall" />;
}
