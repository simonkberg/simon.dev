import { arrayIncludes } from "ts-extras";

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
  preference?: Preference;
  run: (argument: string) => CommandResult;
}

const usage = ({ name, preference }: Command) =>
  preference ? `/${name} ${preference.options.join("|")}` : `/${name}`;

function preferenceCommand(preference: Preference): Command {
  const command: Command = {
    name: preference.label,
    description: `Switch the ${preference.label}`,
    preference,
    run(argument) {
      if (!arrayIncludes(preference.options, argument)) {
        return { status: "error", error: `Usage: ${usage(command)}` };
      }
      setPreference(preference, argument);
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
];

/** The message to send, or null for a command: a leading slash runs one, and two send one. */
export function messageText(text: string) {
  if (text.startsWith("//")) return text.slice(1);
  return text.startsWith("/") ? null : text;
}

const findCommand = (name: string | undefined) =>
  commands.find((command) => command.name === name);

export function runCommand(text: string): CommandResult {
  const body = text.trim().slice(1).toLowerCase();
  const space = body.search(/\s/);
  const name = space === -1 ? body : body.slice(0, space);
  const command = findCommand(name);
  if (!command) {
    return {
      status: "error",
      error: `Unknown command /${name}. Try /help, or // to send a slash.`,
    };
  }
  return command.run(space === -1 ? "" : body.slice(space).trim());
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
      complete: typed !== undefined && !typed.preference,
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
