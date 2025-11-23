import type { Metadata } from "next";

import {
  generateListeningMetadata,
  ListeningPageContent,
} from "./components/ListeningPageContent";

const period = "overall";

export const metadata: Metadata = generateListeningMetadata(period);

export default function ListeningPage() {
  return <ListeningPageContent period={period} />;
}
