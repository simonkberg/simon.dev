import { djb2hash } from "@/lib/djb2hash";

/**
 * Converts a string to a consistent HSL color value using hashing.
 * Useful for generating user avatars or consistent UI coloring.
 *
 * @param string - The input string to convert to a color
 * @param saturation - Color saturation (0-1), defaults to 0.95
 * @param lightness - Color lightness (0-1), defaults to 0.65
 * @returns HSL color string in CSS format (e.g., "hsl(240 95% 65%)")
 */
export function stringToColor(
  string: string,
  saturation = 0.95,
  lightness = 0.65,
): `hsl(${number} ${number}% ${number}%)` {
  return `hsl(${djb2hash(string) % 360} ${saturation * 100}% ${lightness * 100}%)`;
}
