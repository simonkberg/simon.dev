// Temporary: writes past days' entries on a preview to read them back. Removed before review.
import { connection } from "next/server";

import { addDays, type Day } from "@/lib/dates";
import { writeEntry } from "@/lib/diary";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

const DAYS = 10;
const LAST: Day = "2026-10-28";

async function run(status: { running: boolean; done: string[] }) {
  await query("DELETE FROM diary");
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = addDays(LAST, -i);
    try {
      const entry = await writeEntry(day);
      await query("INSERT OR REPLACE INTO diary VALUES (?, ?, ?)", [
        day,
        entry,
        Date.now(),
      ]);
    } catch (err) {
      log.warn({ err, day }, "Diary trial failed");
      await query("INSERT OR REPLACE INTO diary VALUES (?, ?, ?)", [
        day,
        `(failed: ${String(err)})`,
        Date.now(),
      ]);
    }
    status.done.push(day);
  }
  status.running = false;
}

export async function GET(request: Request) {
  await connection();
  if (process.env["RAILWAY_ENVIRONMENT_NAME"] === "production") {
    return new Response("Not found", { status: 404 });
  }
  const status = getGlobal("diary-trial", () => ({
    running: false,
    done: [] as string[],
  }));
  if (new URL(request.url).searchParams.has("run") && !status.running) {
    Object.assign(status, { running: true, done: [] });
    void run(status);
  }
  const { rows } = await query("SELECT day, entry FROM diary ORDER BY day");
  return Response.json({ ...status, entries: rows });
}
