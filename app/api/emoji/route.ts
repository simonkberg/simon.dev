import { SHORTCODES } from "@/lib/shortcodes";

// Next sends only s-maxage for a static route, so browsers would fetch it on every visit.
export function GET() {
  return Response.json(SHORTCODES, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
