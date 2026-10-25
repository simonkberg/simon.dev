/** A promise React reads as already resolved, since a resolved promise still suspends in a server render. */
export const settled = <T>(value: T) =>
  Object.assign(Promise.resolve(value), { status: "fulfilled", value });
