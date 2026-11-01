import { z } from "zod";

/** A pattern for `LIKE ? ESCAPE '\'` that matches text containing `text`, wildcards included. */
export const likeContains = (text: string) =>
  `%${text.replaceAll(/[\\%_]/g, "\\$&")}%`;

/** A column of epoch milliseconds. */
export const epochMs = z.number().pipe(z.coerce.date());

/** A boolean expression's column: SQLite has no booleans, only 0 and 1. */
export const flag = z.union([z.literal(0), z.literal(1)]).transform(Boolean);
