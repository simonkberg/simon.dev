"use server";

import { cacheLife } from "next/cache";

import { type DiaryEntry, readEntries } from "@/lib/diary";
import { log } from "@/lib/log";
import {
  forgetPerson,
  type Memory,
  type PublicCategory,
  readPersonNotes,
  readPublicNotes,
} from "@/lib/memory";
import { getSession, type Username } from "@/lib/session";

export type GetBotNotesResult =
  | { status: "ok"; data: Record<PublicCategory, Memory[]> }
  | { status: "error"; error: string };

export async function getBotNotes(): Promise<GetBotNotesResult> {
  "use cache";

  try {
    const data = await readPublicNotes();
    cacheLife("minutes");
    return { status: "ok", data };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getBotNotes" }, "Error fetching bot notes");
    return { status: "error", error: "Failed to fetch bot notes" };
  }
}

const DIARY_ENTRIES = 30;

export type GetDiaryResult =
  | { status: "ok"; data: DiaryEntry[] }
  | { status: "error"; error: string };

/** simon-bot's latest diary entries, newest first. */
export async function getDiary(): Promise<GetDiaryResult> {
  "use cache";

  try {
    const data = await readEntries(DIARY_ENTRIES);
    cacheLife("minutes");
    return { status: "ok", data };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getDiary" }, "Error fetching the diary");
    return { status: "error", error: "Failed to fetch the diary" };
  }
}

export type GetNotesOnMeResult =
  | { status: "ok"; data: { username: Username; notes: string[] } }
  | { status: "error"; error: string };

export async function getNotesOnMe(): Promise<GetNotesOnMeResult> {
  try {
    const { username } = await getSession();
    const notes = await readPersonNotes(username);
    return {
      status: "ok",
      data: { username, notes: notes.map((note) => note.content) },
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
    const forgotten = await forgetPerson(username);
    return { status: "ok", data: { forgotten } };
  } catch (err) {
    log.error({ err, action: "forgetMe" }, "Error forgetting notes on me");
    return { status: "error", error: "Failed to forget simon-bot's notes" };
  }
}
