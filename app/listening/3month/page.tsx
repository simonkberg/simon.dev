import type { Metadata } from "next";

import {
  generateListeningMetadata,
  ListeningPageContent,
} from "../components/ListeningPageContent";

const period = "3month";

export const metadata: Metadata = generateListeningMetadata(period);

export default function Listening3MonthPage() {
  return <ListeningPageContent period={period} />;
}
