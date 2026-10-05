import type { Rendition } from "epubjs";
import { READING_PALETTES, TEXT_SIZES, THEMES, type ReadingSettings } from "./reading-settings";

export const themeName = (settings: ReadingSettings) => `reading-${settings.theme}-${settings.fontSize}`;

export function registerReadingThemes(reader: Rendition, fixed: boolean) {
  reader.themes.default({ "img, svg": { "max-width": "100%", "max-height": "100%" } });
  for (const theme of THEMES) for (const fontSize of TEXT_SIZES) {
    const palette = READING_PALETTES[theme];
    const body = `body.reading-${theme}-${fontSize}`;
    const text = "p, div, section, article, main, header, footer, aside, blockquote, span, em, strong, b, i, small, h1, h2, h3, h4, h5, h6, ul, ol, li, dl, dt, dd, table, thead, tbody, tr, td, th, pre, code, a, sup, sub";
    const selectors = (list: string) => list.split(", ").map(tag => `${body} ${tag}`).join(", ");
    const rules: Record<string, Record<string, string>> = {
      [body]: { color: `${palette.text} !important`, background: `${palette.background} !important`, ...(fixed ? {} : { "font-family": "Georgia, serif !important", "font-size": `${fontSize}px !important`, "line-height": "1.6 !important" }) },
      [selectors(text)]: { color: "inherit !important", "background-color": "transparent !important" },
      [selectors("a, a:visited")]: { color: `${palette.link} !important`, "text-decoration": "underline" },
      [selectors("pre, code")]: { "background-color": `${palette.surface} !important`, "white-space": "pre-wrap", "overflow-wrap": "anywhere" },
      [selectors("table, td, th")]: { "border-color": `${palette.line} !important` },
      [`${body} :focus-visible`]: { outline: `2px solid ${palette.link} !important`, "outline-offset": "3px" },
    };
    if (!fixed) {
      rules[selectors("p, div, section, article, main, header, footer, aside, blockquote, span, em, strong, b, i, ul, ol, li, dl, dt, dd, table, thead, tbody, tr, td, th, pre, code, a")] = { "font-size": "inherit !important", "line-height": "inherit !important" };
      for (const [heading, size] of [["h1", "1.8em"], ["h2", "1.5em"], ["h3", "1.3em"], ["h4", "1.15em"], ["h5", "1.05em"], ["h6", "1em"]]) rules[`${body} ${heading}`] = { "font-size": `${size} !important` };
    }
    reader.themes.register(`reading-${theme}-${fontSize}`, rules);
  }
}
