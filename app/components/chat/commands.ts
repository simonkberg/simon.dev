import { arrayIncludes } from "ts-extras";

import { getArtistPlays, getRandomTrack } from "@/actions/lastfm";
import { forgetMe, getNotesOnMe } from "@/actions/simonBot";
import { formatNumber } from "@/lib/formatNumber";
import {
  currentPreference,
  type Preference,
  preferences,
  setPreference,
} from "@/lib/preferences";

export type CommandResult =
  | { status: "ok"; output?: readonly string[] }
  | { status: "error"; error: string };

export interface Command {
  name: string;
  description: string;
  /** What the command takes, shown after its name. */
  argument?: string;
  preference?: Preference;
  run: (argument: string) => CommandResult | Promise<CommandResult>;
}

const usage = ({ name, argument }: Command) =>
  argument ? `/${name} ${argument}` : `/${name}`;

function preferenceCommand(preference: Preference): Command {
  const command: Command = {
    name: preference.label,
    description: `Switch the ${preference.label}`,
    argument: preference.options.join("|"),
    preference,
    run(argument) {
      const option = argument.toLowerCase();
      if (!arrayIncludes(preference.options, option)) {
        return { status: "error", error: `Usage: ${usage(command)}` };
      }
      setPreference(preference, option);
      return { status: "ok" };
    },
  };
  return command;
}

export const commands: readonly Command[] = [
  {
    name: "help",
    description: "List the commands",
    run() {
      const usages = commands.map(usage);
      const width = Math.max(...usages.map((line) => line.length));
      return {
        status: "ok",
        output: commands.map(
          (command, index) =>
            `${usages[index]?.padEnd(width)}  ${command.description}`,
        ),
      };
    },
  },
  ...preferences.map(preferenceCommand),
  {
    name: "whoami",
    description: "Show what simon-bot knows about you",
    async run() {
      const result = await getNotesOnMe();
      if (result.status === "error") return result;
      const { username, notes } = result.data;
      return {
        status: "ok",
        output: [
          `You are ${username}.`,
          ...(notes.length > 0
            ? ["simon-bot remembers:", ...notes.map((note) => `- ${note}`)]
            : ["simon-bot doesn't remember anything about you yet."]),
        ],
      };
    },
  },
  {
    name: "forget",
    description: "Make simon-bot forget you",
    async run() {
      const result = await forgetMe();
      if (result.status === "error") return result;
      const { forgotten } = result.data;
      return {
        status: "ok",
        output: [
          forgotten > 0
            ? `simon-bot forgot ${forgotten} ${forgotten === 1 ? "note" : "notes"} about you.`
            : "simon-bot had nothing to forget about you.",
        ],
      };
    },
  },
  {
    name: "plays",
    description: "Count Simon's plays of an artist",
    argument: "<artist>",
    async run(argument) {
      if (!argument)
        return { status: "error", error: "Usage: /plays <artist>" };
      const result = await getArtistPlays(argument);
      if (result.status === "error") return result;
      if (!result.data) {
        return { status: "error", error: `Last.fm doesn't know ${argument}.` };
      }
      const { name, plays } = result.data;
      return {
        status: "ok",
        output: [
          `Simon has played ${name} ${formatNumber(plays)} ${plays === 1 ? "time" : "times"}.`,
        ],
      };
    },
  },
  {
    name: "shuffle",
    description: "Pick a random track from Simon's history",
    async run() {
      const result = await getRandomTrack();
      if (result.status === "error") return result;
      const { name, artist, played } = result.data;
      return {
        status: "ok",
        output: [`${name} by ${artist}, played ${played}.`],
      };
    },
  },
];

/** The message to send, or null for a command: a leading slash runs one, and two send one. */
export function messageText(text: string) {
  if (text.startsWith("//")) return text.slice(1);
  return text.startsWith("/") ? null : text;
}

const findCommand = (name: string | undefined) =>
  commands.find((command) => command.name === name);

export function runCommand(
  text: string,
): CommandResult | Promise<CommandResult> {
  const body = text.slice(1);
  const space = body.search(/\s/);
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const command = findCommand(name);
  if (!command) {
    return {
      status: "error",
      error: `Unknown command /${name}. Try /help, or // to send a slash.`,
    };
  }
  const result = command.run(space === -1 ? "" : body.slice(space).trim());
  return result instanceof Promise
    ? result.catch(() => ({
        status: "error",
        error: `Couldn't run /${name}. Try again.`,
      }))
    : result;
}

export interface CommandSuggestion {
  value: string;
  label: string;
  detail: string;
}

const NAME = /^\/(\S*)$/;
const ARGUMENT = /^\/(\S+)\s+(\S*)$/;

/** The command or argument typed up to the caret, where it starts, what it could become, and whether it needs nothing picked. */
export function typedCommand(text: string) {
  if (!text.startsWith("/")) return null;
  const before = text.toLowerCase();
  const name = NAME.exec(before)?.[1];
  if (name !== undefined) {
    const typed = findCommand(name);
    return {
      query: name,
      start: 1,
      suggestions: commands
        .filter((command) => command.name.startsWith(name))
        .map((command): CommandSuggestion => ({
          value: command.name,
          label: usage(command),
          detail: command.description,
        })),
      complete: typed !== undefined && typed.argument === undefined,
    };
  }
  const [, commandName, argument] = ARGUMENT.exec(before) ?? [];
  const preference = findCommand(commandName)?.preference;
  if (!preference || argument === undefined) return null;
  const current = currentPreference(preference);
  return {
    query: argument,
    start: before.length - argument.length,
    suggestions: preference.options
      .filter((option) => option.startsWith(argument))
      .map((option): CommandSuggestion => ({
        value: option,
        label: option,
        detail: option === current ? "current" : "",
      })),
    complete: arrayIncludes(preference.options, argument),
  };
}
