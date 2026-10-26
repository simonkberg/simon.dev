import {
  listeningAlt,
  listeningCard,
} from "@/listening/components/listeningCard";

import { toPeriod } from "./toPeriod";

export { contentType, size } from "@/lib/shareCard";

export const alt = listeningAlt;

// Images get the page's params, but no searchParams.
export default async function openGraphImage({
  params,
}: Pick<PageProps<"/listening/[period]">, "params">) {
  return listeningCard(toPeriod((await params).period));
}
