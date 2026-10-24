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

/** A command, unless the text is a message: one without a leading slash, or with two to send one. */
export function isCommand(text: string) {
  return text.startsWith("/") && !text.startsWith("//");
}

export function runCommand(text: string): CommandResult {
  const body = text.trim().slice(1).toLowerCase();
  const space = body.search(/\s/);
  const name = space === -1 ? body : body.slice(0, space);
  const command = commands.find((command) => command.name === name);
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
  /** Whether picking it leaves nothing more to type. */
  final: boolean;
}

const NAME = /^\/(\S*)$/;
const ARGUMENT = /^\/(\S+) (\S*)$/;

/** The command or argument typed up to the caret, where it starts, and what it could become. */
export function typedCommand(text: string) {
  if (!text.startsWith("/")) return null;
  const before = text.toLowerCase();
  const name = NAME.exec(before)?.[1];
  if (name !== undefined) {
    return {
      query: name,
      start: 1,
      suggestions: commands
        .filter((command) => command.name.startsWith(name))
        .map((command): CommandSuggestion => ({
          value: command.name,
          label: usage(command),
          detail: command.description,
          final: !command.preference,
        })),
    };
  }
  const [, commandName, argument] = ARGUMENT.exec(before) ?? [];
  const preference = commands.find(
    (command) => command.name === commandName,
  )?.preference;
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
        final: true,
      })),
  };
}
