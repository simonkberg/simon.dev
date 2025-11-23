import type { Metadata } from "next";

import {
  generateListeningMetadata,
  ListeningPageContent,
} from "../components/ListeningPageContent";

const period = "1month";

export const metadata: Metadata = generateListeningMetadata(period);

export default function Listening1MonthPage() {
  return <ListeningPageContent period={period} />;
}
