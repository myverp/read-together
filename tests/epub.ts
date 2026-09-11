import JSZip from "jszip";

export async function epub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("OEBPS/book.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-book</dc:identifier><dc:title>Test walk</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-08T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file("OEBPS/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">The morning walk</a></li><li><a href="two.xhtml">Coming home</a></li></ol></nav></body></html>');
  for (const [path, title] of [["one", "The morning walk"], ["two", "Coming home"]]) {
    zip.file(`OEBPS/${path}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${Array.from({ length: 50 }, (_, i) => `<p>Paragraph ${i + 1}. We walked along the river and watched the light settle on the water. There was time to read a little, pause, and share the same quiet story together.</p>`).join("")}</body></html>`);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}


