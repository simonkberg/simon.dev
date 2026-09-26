import { notFound } from "next/navigation";

// Unmatched paths arrive here after the proxy's rewrite, so the 404 renders
// inside the root layout with the visitor's preferences.
export default function Missing() {
  notFound();
}
