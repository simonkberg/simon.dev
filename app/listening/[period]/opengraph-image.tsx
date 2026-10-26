import {
  listeningAlt,
  listeningCard,
} from "@/listening/components/listeningCard";

import { toPeriod } from "./toPeriod";

export { contentType, size } from "@/lib/shareCard";

export const alt = listeningAlt;

export default async function openGraphImage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  return listeningCard(toPeriod((await params).period));
}
