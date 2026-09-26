import { preferences } from "@/lib/preferences";

export function resetPreferences() {
  for (const { name } of preferences) {
    document.documentElement.removeAttribute(`data-${name}`);
    document.cookie = `${name}=; max-age=0; path=/`;
  }
}
