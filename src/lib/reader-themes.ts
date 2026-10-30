import type { Rendition } from "epubjs";
import { READING_PALETTES, type ReadingSettings } from "./reading-settings";

export const themeName = (settings: ReadingSettings) => `reading-${settings.theme}-${settings.fontSize}-${settings.font}-${Math.round(settings.lineHeight * 10)}-${settings.alignment}`;

export function registerReadingThemes(reader: Rendition, fixed: boolean, settings: ReadingSettings) {
  reader.themes.default({ "img, svg": { "max-width": "100%", "max-height": "100%" } });
  {
    const { theme, fontSize, font, lineHeight, alignment } = settings;
    const palette = READING_PALETTES[theme];
    const body = `body.${themeName(settings)}`;
    const text = "p, div, section, article, main, header, footer, aside, blockquote, span, em, strong, b, i, small, h1, h2, h3, h4, h5, h6, ul, ol, li, dl, dt, dd, table, thead, tbody, tr, td, th, pre, code, a, sup, sub";
    const selectors = (list: string) => list.split(", ").map(tag => `${body} ${tag}`).join(", ");
    const rules: Record<string, Record<string, string>> = {
      [body]: { color: `${palette.text} !important`, background: `${palette.background} !important`, ...(fixed ? {} : { ...(font === "original" ? {} : { "font-family": `${font === "serif" ? "Georgia, serif" : "system-ui, sans-serif"} !important` }), "font-size": `${fontSize}px !important`, "line-height": `${lineHeight} !important` }) },
      [selectors(text)]: { color: "inherit !important", "background-color": "transparent !important" },
      [selectors("a, a:visited")]: { color: `${palette.link} !important`, "text-decoration": "underline" },
      [selectors("pre, code")]: { "background-color": `${palette.surface} !important`, "white-space": "pre-wrap", "overflow-wrap": "anywhere" },
      [selectors("table, td, th")]: { "border-color": `${palette.line} !important` },
      [`${body} :focus-visible`]: { outline: `2px solid ${palette.link} !important`, "outline-offset": "3px" },
    };
    if (!fixed) {
      rules[selectors("p, div, section, article, main, header, footer, aside, blockquote, span, em, strong, b, i, ul, ol, li, dl, dt, dd, table, thead, tbody, tr, td, th, pre, code, a")] = { "font-size": "inherit !important", "line-height": "inherit !important" };
      if (font !== "original") rules[`${body} :is(p, div, section, article, main, header, footer, aside, blockquote, span, em, strong, b, i, small, h1, h2, h3, h4, h5, h6, ul, ol, li, dl, dt, dd, table, td, th, a):not(pre *, code *, kbd *, samp *)`] = { "font-family": `${font === "serif" ? "Georgia, serif" : "system-ui, sans-serif"} !important` };
      // Restrict alignment to prose paragraphs. Poetry, line-broken text,
      // tables, code and centered/right-aligned author blocks keep their formatting.
      if (alignment === "left") rules[`${body} p:not([align="center"]):not([align="right"]):not([style*="center"]):not([style*="right"]):not([class*="poem"]):not([class*="verse"]):not([class*="stanza"]):not(:has(br)):not(pre *, blockquote *, table *, [class*="poem"] *, [class*="verse"] *, [class*="poetry"] *, [class*="stanza"] *)`] = { "text-align": "left !important" };
      for (const [heading, size] of [["h1", "1.8em"], ["h2", "1.5em"], ["h3", "1.3em"], ["h4", "1.15em"], ["h5", "1.05em"], ["h6", "1em"]]) rules[`${body} ${heading}`] = { "font-size": `${size} !important` };
    }
    reader.themes.register(themeName(settings), rules);
  }
}
