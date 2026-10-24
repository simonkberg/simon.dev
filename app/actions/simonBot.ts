"use server";

import { cacheLife } from "next/cache";

import { log } from "@/lib/log";
import {
  forgetCategory,
  MAX_PER_CATEGORY,
  type Memory,
  peopleCategory,
  type PublicCategory,
  readPublicNotes,
  recall,
} from "@/lib/memory";
import { getSession, type Username } from "@/lib/session";

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

export type GetNotesOnMeResult =
  | { status: "ok"; data: { username: Username; notes: string[] } }
  | { status: "error"; error: string };

export async function getNotesOnMe(): Promise<GetNotesOnMeResult> {
  try {
    const { username } = await getSession();
    const category = peopleCategory(username);
    const notes = category
      ? await recall({ category, limit: MAX_PER_CATEGORY })
      : [];
    return {
      status: "ok",
      data: { username, notes: notes.toReversed().map((note) => note.content) },
    };
  } catch (err) {
    log.error({ err, action: "getNotesOnMe" }, "Error fetching notes on me");
    return { status: "error", error: "Failed to fetch simon-bot's notes" };
  }
}

export type ForgetMeResult =
  | { status: "ok"; data: { forgotten: number } }
  | { status: "error"; error: string };

export async function forgetMe(): Promise<ForgetMeResult> {
  try {
    const { username } = await getSession();
    const category = peopleCategory(username);
    const forgotten = category ? await forgetCategory(category) : 0;
    if (forgotten > 0) log.info({ username, forgotten }, "Forgot a visitor");
    return { status: "ok", data: { forgotten } };
  } catch (err) {
    log.error({ err, action: "forgetMe" }, "Error forgetting notes on me");
    return { status: "error", error: "Failed to forget simon-bot's notes" };
  }
}
