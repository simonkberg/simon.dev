import type { Metadata } from "next";

import {
  generateListeningMetadata,
  ListeningPageContent,
} from "../components/ListeningPageContent";

const period = "12month";

export const metadata: Metadata = generateListeningMetadata(period);

export default function Listening12MonthPage() {
  return <ListeningPageContent period={period} />;
}
