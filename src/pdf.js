// Minimale, dependency-vrije PDF-generator - zelfde filosofie als de rest van
// de app (liever zelf een klein stukje bouwen dan een extra npm-pakket erbij
// halen). Ondersteunt precies wat de dagstaat nodig heeft: tekst (Helvetica/
// Helvetica-Bold, standaardlettertypen die geen embedding vereisen), lijnen
// en rechthoeken, over meerdere pagina's (A4).
//
// Gebruik:
//   const pdf = new PdfDocument();
//   pdf.tekst(50, 800, 'Hallo', { grootte: 12, vet: true });
//   pdf.lijn(50, 790, 545, 790);
//   pdf.nieuwePagina();
//   ...
//   const buffer = pdf.build();

const PAGINA_BREEDTE = 595.28; // A4 in punten
const PAGINA_HOOGTE = 841.89;

function escapePdfString(tekst) {
  return String(tekst).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export class PdfDocument {
  constructor() {
    this.paginas = [];
    this.nieuwePagina();
  }

  nieuwePagina() {
    this.huidige = { operators: [] };
    this.paginas.push(this.huidige);
  }

  tekst(x, y, tekst, { grootte = 10, vet = false } = {}) {
    const font = vet ? '/F2' : '/F1';
    this.huidige.operators.push(`BT ${font} ${grootte} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfString(tekst)}) Tj ET`);
  }

  lijn(x1, y1, x2, y2, { breedte = 0.75 } = {}) {
    this.huidige.operators.push(`${breedte} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rechthoek(x, y, w, h, { vullen = false } = {}) {
    this.huidige.operators.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${vullen ? 'f' : 'S'}`);
  }

  get breedte() {
    return PAGINA_BREEDTE;
  }
  get hoogte() {
    return PAGINA_HOOGTE;
  }

  build() {
    const objecten = [];
    // 1: Catalog, 2: Pages, 3: Font Helvetica, 4: Font Helvetica-Bold,
    // daarna per pagina: content-stream-object + page-object.
    const catalogId = 1;
    const pagesId = 2;
    const fontRegularId = 3;
    const fontBoldId = 4;
    let volgendeId = 5;

    const paginaIds = [];
    const paginaObjecten = [];
    for (const pagina of this.paginas) {
      const contentStream = pagina.operators.join('\n');
      const contentId = volgendeId++;
      const pageId = volgendeId++;
      objecten[contentId] = `<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`;
      objecten[pageId] =
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGINA_BREEDTE} ${PAGINA_HOOGTE}] ` +
        `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`;
      paginaIds.push(pageId);
      paginaObjecten.push(pageId, contentId);
    }

    objecten[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objecten[pagesId] = `<< /Type /Pages /Kids [${paginaIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginaIds.length} >>`;
    objecten[fontRegularId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
    objecten[fontBoldId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;

    const totaalObjecten = volgendeId - 1;
    let pdf = '%PDF-1.4\n';
    const offsets = new Array(totaalObjecten + 1).fill(0);
    for (let id = 1; id <= totaalObjecten; id++) {
      offsets[id] = Buffer.byteLength(pdf, 'utf8');
      pdf += `${id} 0 obj\n${objecten[id]}\nendobj\n`;
    }
    const xrefStart = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${totaalObjecten + 1}\n`;
    pdf += `0000000000 65535 f \n`;
    for (let id = 1; id <= totaalObjecten; id++) {
      pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${totaalObjecten + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }
}

export default PdfDocument;
