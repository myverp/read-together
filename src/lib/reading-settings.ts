export const SETTINGS_KEY = "read-together:reading-settings:v1";
export const TEXT_SIZES = [16, 18, 20, 22, 24, 26, 28] as const;
export const THEMES = ["light", "dark", "sepia"] as const;
export type ReadingSettings = { version: 1; theme: typeof THEMES[number]; fontSize: typeof TEXT_SIZES[number] };
export const DEFAULT_SETTINGS: ReadingSettings = { version: 1, theme: "light", fontSize: 18 };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem"> | null;

export function validateSettings(value: unknown): ReadingSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const settings = value as ReadingSettings;
  if (settings.version !== 1 || !THEMES.includes(settings.theme) || !TEXT_SIZES.includes(settings.fontSize)) return { ...DEFAULT_SETTINGS };
  return { version: 1, theme: settings.theme, fontSize: settings.fontSize };
}
export function loadSettings(storage: Storage): { settings: ReadingSettings; available: boolean } {
  try {
    if (!storage) return { settings: { ...DEFAULT_SETTINGS }, available: false };
    const raw = storage.getItem(SETTINGS_KEY);
    let value: unknown; try { value = JSON.parse(raw || "null"); } catch { value = null; }
    return { settings: validateSettings(value), available: true };
  } catch { return { settings: { ...DEFAULT_SETTINGS }, available: false }; }
}
export function saveSettings(storage: Storage, settings: ReadingSettings): boolean {
  try { if (!storage) return false; storage.setItem(SETTINGS_KEY, JSON.stringify(validateSettings(settings))); return true; } catch { return false; }
}
export const READING_PALETTES = {
  light: { background: "#ffffff", text: "#1d1d1f", muted: "#55555e", link: "#0058b0", surface: "#f5f5f7", line: "#92929b", error: "#a42626" },
  dark: { background: "#17191e", text: "#e9edf2", muted: "#b7bfca", link: "#93c5fd", surface: "#252932", line: "#727d90", error: "#ffb4b4" },
  sepia: { background: "#f4ecd8", text: "#3c3328", muted: "#655844", link: "#285f96", surface: "#e9dfc7", line: "#91836c", error: "#922727" },
} as const;
