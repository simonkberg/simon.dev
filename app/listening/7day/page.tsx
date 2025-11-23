import type { Metadata } from "next";

import {
  generateListeningMetadata,
  ListeningPageContent,
} from "../components/ListeningPageContent";

const period = "7day";

export const metadata: Metadata = generateListeningMetadata(period);

export default function Listening7DayPage() {
  return <ListeningPageContent period={period} />;
}
