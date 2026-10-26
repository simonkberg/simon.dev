import type { PublicCategory } from "@/lib/memory";

export const headings: Record<PublicCategory, { title: string; what: string }> =
  {
    self: { title: "Self", what: "who it is" },
    style: { title: "Style", what: "how it writes" },
    interests: { title: "Interests", what: "what it likes" },
  };
