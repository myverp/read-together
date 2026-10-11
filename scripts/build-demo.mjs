import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('public/demo/story.md', 'utf8');
const title = source.split('\n')[0].replace(/^# /, '');
const chapters = source.split('\n## ').slice(1).map(chapter => {
  const [heading, ...lines] = chapter.split('\n');
  return { heading, paragraphs: lines.join('\n').trim().split(/\n\s*\n/) };
});
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const zip = new JSZip();
const file = (name, text) => zip.file(name, text, { date: new Date('2026-09-29T00:00:00Z'), compression: 'STORE' });
file('mimetype', 'application/epub+zip');
file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file('OEBPS/book.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">read-together-original-demo</dc:identifier><dc:title>${escape(title)}</dc:title><dc:language>en</dc:language><dc:rights>Original Read Together demo; unrestricted reuse permitted.</dc:rights><meta property="dcterms:modified">2026-09-29T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((_, i) => `<item id="c${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map((chapter, i) => `<li><a href="chapter-${i}.xhtml">${escape(chapter.heading)}</a></li>`).join('')}</ol></nav></body></html>`);
chapters.forEach((chapter, i) => file(`OEBPS/chapter-${i}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escape(chapter.heading)}</title></head><body><h1>${escape(chapter.heading)}</h1>${chapter.paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</body></html>`));
writeFileSync('public/demo/read-together-demo.epub', await zip.generateAsync({ type: 'nodebuffer' }));
console.log(`Built original demo with ${chapters.length} chapters.`);
