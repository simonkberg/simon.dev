/** A pattern for `LIKE ? ESCAPE '\'` that matches text containing `text`, wildcards included. */
export const likeContains = (text: string) =>
  `%${text.replaceAll(/[\\%_]/g, "\\$&")}%`;
