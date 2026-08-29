import type { Configuration } from "lint-staged";

const sourceFilesRegex = /\.[cm]?[tj]sx?$/;

/**
 * Custom lint-staged config.
 *
 * This ensures that all files are formatted, and that all source files are
 * linted, type-checked, and tested.
 *
 * The order of the commands is important! Oxlint must run before Prettier to
 * ensure that any code changes made by Oxlint are formatted correctly.
 */
const config: Configuration = (filenames) => {
  const commands: string[] = [];
  let allFiles = "";
  let sourceFiles = "";

  for (const file of filenames) {
    allFiles += ` ${file}`;
    if (sourceFilesRegex.test(file)) {
      sourceFiles += ` ${file}`;
    }
  }

  if (sourceFiles !== "") {
    commands.push(`oxlint --max-warnings=0 --fix ${sourceFiles}`);
  }

  if (allFiles !== "") {
    commands.push(`prettier -wlu ${allFiles}`);
  }

  if (sourceFiles !== "") {
    commands.push(`vitest related ${sourceFiles}`, "node --run lint:tsc");
  }

  return commands;
};

export default config;
