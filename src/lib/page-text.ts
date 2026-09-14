import type { Contents, Location, Rendition } from "epubjs";

/** Resolve both page boundaries in the rendered document, never the whole chapter. */
export function visiblePageText(reader: Rendition): { text: string; id: string } {
  const location = reader.currentLocation() as unknown as Location;
  if (!location?.start?.cfi || !location.end?.cfi) throw new Error("Wait for the page to finish opening.");
  const contents = reader.getContents() as unknown as Contents[];
  const parts = contents.filter(content => content.sectionIndex >= location.start.index && content.sectionIndex <= location.end.index);
  if (!parts.length) throw new Error("This page is not ready yet.");
  const text = parts.map(content => {
    const range = content.document.createRange();
    range.selectNodeContents(content.document.body);
    if (content.sectionIndex === location.start.index) {
      const start = content.range(location.start.cfi);
      range.setStart(start.startContainer, start.startOffset);
    }
    if (content.sectionIndex === location.end.index) {
      const end = content.range(location.end.cfi);
      range.setEnd(end.endContainer, end.endOffset);
    }
    const fragment = range.cloneContents();
    fragment.querySelectorAll('script,style,noscript,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
    fragment.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,br").forEach(node => node.append(content.document.createTextNode("\n")));
    return fragment.textContent || "";
  }).join("\n").replace(/[\t \u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("This page has no readable text. Turn to a text page.");
  if (text.length > 10000) throw new Error("This page exceeds the 10,000-character audio limit. Use a smaller reading window.");
  return { text, id: `${location.start.cfi}|${location.end.cfi}` };
}
