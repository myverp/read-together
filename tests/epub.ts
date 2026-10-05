import JSZip from "jszip";

export async function epub(internalLinks = false, navigation: "normal" | "nested" | "empty" | "ncx" = "normal") {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("OEBPS/book.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-book</dc:identifier><dc:title>Test walk</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-08T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file("OEBPS/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">The morning walk</a></li><li><a href="two.xhtml">Coming home</a></li></ol></nav></body></html>');
  if (navigation === "nested" || navigation === "empty") zip.file("OEBPS/nav.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${navigation === "empty" ? "" : '<li><a href="./one.xhtml">The morning walk</a><ol><li><a href="one.xhtml#passage">&lt;b&gt;River passage&lt;/b&gt; with a long title that wraps across a narrow screen</a></li></ol></li><li><a href="two.xhtml">Coming home</a></li><li><a href="https://example.com">External section</a></li><li><a href="javascript:alert(1)">Unsafe section</a></li><li><a href="missing.xhtml">Missing section</a></li>'}</ol></nav></body></html>`);
  if (navigation === "nested") {
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    zip.file("OEBPS/nav.xhtml", nav.replace('</ol></nav>', '<li><a href="one.xhtml#absent">Absent passage</a></li></ol></nav>'));
  }
  if (navigation === "ncx") {
    const opf = await zip.file("OEBPS/book.opf")!.async("string");
    zip.file("OEBPS/book.opf", opf.replace('version="3.0"', 'version="2.0"').replace('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="nav" href="toc.ncx" media-type="application/x-dtbncx+xml"/>').replace('<spine>', '<spine toc="nav">'));
    zip.file("OEBPS/toc.ncx", '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Walk</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>The morning walk</text></navLabel><content src="one.xhtml"/><navPoint id="passage" playOrder="2"><navLabel><text>River passage</text></navLabel><content src="one.xhtml#passage"/></navPoint></navPoint><navPoint id="two" playOrder="3"><navLabel><text>Coming home</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>');
  }
  for (const [path, title] of [["one", "The morning walk"], ["two", "Coming home"]]) {
    zip.file(`OEBPS/${path}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${internalLinks ? `<p><a href="${path === "one" ? "two" : "one"}.xhtml">Go to the other chapter</a></p>` : ""}${Array.from({ length: 50 }, (_, i) => `<p${i === 20 ? ' id="passage"' : ''}>Paragraph ${i + 1}. We walked along the river and watched the light settle on the water. There was time to read a little, pause, and share the same quiet story together.</p>`).join("")}</body></html>`);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}


