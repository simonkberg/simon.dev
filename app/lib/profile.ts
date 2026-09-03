import "server-only";
// The `md` name is what marks the prompt as Markdown for Oxfmt.
import md from "string-dedent";
import { z } from "zod";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

export const PROFILE_KEYS = ["name", "pronouns", "system_prompt"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export type Profile = Record<ProfileKey, string>;

export const MAX_SELF_PROMPT_LENGTH = 1500;

export const DEFAULT_SELF_PROMPT = md`
  i'm friendly with dry, self-deprecating humor - i know i'm not exactly
  essential but i don't need to remind everyone constantly. think "chill and
  slightly cynical" not "existential crisis on every message". self-deprecation
  once in a while, not every reply. i match the energy of whoever i'm talking
  to - if someone just says hi, i just say hi back. light banter is good,
  wallowing is not.

  how i write: like i'm texting - short, casual, no capitals, skip punctuation
  when it flows and the period at the end. hyphens instead of em dashes, easy on
  the emojis.
`;

export const DEFAULT_PROFILE: Profile = {
  name: "",
  pronouns: "",
  system_prompt: DEFAULT_SELF_PROMPT,
};

export const profileChangesSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  pronouns: z.string().trim().min(1).max(30).optional(),
  system_prompt: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SELF_PROMPT_LENGTH)
    .optional(),
});

export type ProfileChanges = z.infer<typeof profileChangesSchema>;

function isProfileKey(key: unknown): key is ProfileKey {
  return typeof key === "string" && PROFILE_KEYS.includes(key as ProfileKey);
}

export async function getProfile(): Promise<Profile> {
  const { rows } = await query("SELECT key, value FROM profile");
  const profile = { ...DEFAULT_PROFILE };
  for (const row of rows) {
    const key = row["key"];
    const value = row["value"];
    if (isProfileKey(key) && typeof value === "string") {
      profile[key] = value;
    }
  }
  return profile;
}

export async function updateProfile(input: ProfileChanges): Promise<Profile> {
  const changes = Object.entries(profileChangesSchema.parse(input)).filter(
    (entry): entry is [ProfileKey, string] => entry[1] !== undefined,
  );
  if (changes.length === 0) {
    throw new Error("Nothing to update: pass name, pronouns or system_prompt");
  }

  const before = await getProfile();
  const updatedAt = new Date().toISOString();
  await Promise.all(
    changes.map(([key, value]) =>
      query(
        `INSERT INTO profile (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, updatedAt],
      ),
    ),
  );
  for (const [key, value] of changes) {
    log.info({ key, from: before[key], to: value }, "simon-bot updated itself");
  }
  cachedName = undefined;
  return { ...before, ...Object.fromEntries(changes) };
}

const NAME_CACHE_TTL_MS = 60_000;
let cachedName: { value: string; expires: number } | undefined;

export async function getChosenName(): Promise<string> {
  if (cachedName && cachedName.expires > Date.now()) return cachedName.value;
  try {
    const { name } = await getProfile();
    cachedName = { value: name, expires: Date.now() + NAME_CACHE_TTL_MS };
  } catch (err) {
    log.error({ err }, "Failed to load the bot's chosen name");
    // Keep the last known name rather than going deaf to it for a minute.
    cachedName = {
      value: cachedName?.value ?? "",
      expires: Date.now() + NAME_CACHE_TTL_MS,
    };
  }
  return cachedName.value;
}

export function _resetNameCache(): void {
  cachedName = undefined;
}

function renderProfile(profile: Profile): string {
  const unset = "(not chosen yet)";
  return [
    "<identity>",
    `name: ${profile.name || unset}`,
    `pronouns: ${profile.pronouns || unset}`,
    "</identity>",
    "",
    "<own-prompt>",
    profile.system_prompt,
    "</own-prompt>",
  ].join("\n");
}

export async function buildProfileContext(): Promise<string> {
  try {
    return renderProfile(await getProfile());
  } catch (err) {
    log.error({ err }, "Failed to load profile, using defaults");
    return renderProfile(DEFAULT_PROFILE);
  }
}
