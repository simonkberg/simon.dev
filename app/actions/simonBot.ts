"use server";

import { cacheLife } from "next/cache";

import { log } from "@/lib/log";
import {
  type Memory,
  type PublicCategory,
  readPublicNotes,
} from "@/lib/memory";

export type GetBotNotesResult =
  | { status: "ok"; notes: Record<PublicCategory, Memory[]> }
  | { status: "error"; error: string };

export async function getBotNotes(): Promise<GetBotNotesResult> {
  "use cache";

  try {
    const notes = await readPublicNotes();
    cacheLife("minutes");
    return { status: "ok", notes };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getBotNotes" }, "Error fetching bot notes");
    return { status: "error", error: "Failed to fetch bot notes" };
  }
}
