import { dayCard } from "@/listening/components/listeningCard";

import { toDay } from "../toDay";

export { contentType, size } from "@/lib/shareCard";

export const alt = "What I played on a day, and its month's scrobbles per day";

// Images get the page's params, but no searchParams.
export default async function openGraphImage({
  params,
}: Pick<PageProps<"/listening/on/[date]">, "params">) {
  return dayCard(await toDay((await params).date));
}
