import type { Metadata } from "next";

import {
  generateListeningMetadata,
  ListeningPageContent,
} from "../components/ListeningPageContent";

const period = "6month";

export const metadata: Metadata = generateListeningMetadata(period);

export default function Listening6MonthPage() {
  return <ListeningPageContent period={period} />;
}
