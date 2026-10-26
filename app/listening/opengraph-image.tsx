import {
  listeningAlt,
  listeningCard,
} from "@/listening/components/listeningCard";

export { contentType, size } from "@/lib/shareCard";

export const alt = listeningAlt;

export default async function openGraphImage() {
  return listeningCard("overall");
}
