import type { Route } from "next";

import type { Period } from "@/lib/lastfm";

export type PublicPath =
  | "/"
  | "/listening/"
  | `/listening/${Exclude<Period, "overall">}`;

/**
 * A public path as a typed `Route`. The typed routes only know the paths the
 * proxy rewrites to, `/[variant]/[theme]/…`, never the ones visitors see.
 */
export const route = (path: PublicPath) => path as Route;
