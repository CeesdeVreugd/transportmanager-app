// Minimale multipart/form-data parser — puur met ingebouwde Node-modules,
// nodig om bestandsuploads (CMR, pakbon, foto's, handtekening) te verwerken
// zonder externe package zoals 'multer' of 'busboy'.

export async function leesMultipart(req, { maxBytes = 20 * 1024 * 1024 } = {}) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new Error('Geen multipart/form-data body ontvangen.');
  }
  const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();
  const body = await leesRuweBody(req, maxBytes);
  return ontleedMultipart(body, boundary);
}

function leesRuweBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totaal = 0;
    req.on('data', (chunk) => {
      totaal += chunk.length;
      if (totaal > maxBytes) {
        reject(new Error('Bestand(en) te groot (max ' + Math.round(maxBytes / (1024 * 1024)) + ' MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function ontleedMultipart(body, boundary) {
  const delimiter = Buffer.from('--' + boundary);
  const velden = {};
  const bestanden = [];

  let idx = body.indexOf(delimiter);
  while (idx !== -1) {
    const volgendeIdx = body.indexOf(delimiter, idx + delimiter.length);
    if (volgendeIdx === -1) break;

    let deel = body.slice(idx + delimiter.length, volgendeIdx);
    // Sla een eventuele afsluitende "--" (einde multipart) over.
    if (deel.slice(0, 2).toString('latin1') === '--') {
      idx = volgendeIdx;
      continue;
    }
    if (deel.slice(0, 2).toString('latin1') === '\r\n') deel = deel.slice(2);
    if (deel.slice(-2).toString('latin1') === '\r\n') deel = deel.slice(0, -2);

    const headerEind = deel.indexOf('\r\n\r\n');
    if (headerEind !== -1) {
      const headerTekst = deel.slice(0, headerEind).toString('utf8');
      const inhoud = deel.slice(headerEind + 4);

      const dispositie = headerTekst.match(/Content-Disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?/i);
      const contentTypeMatch = headerTekst.match(/Content-Type:\s*([^\r\n]+)/i);
      const veldNaam = dispositie ? dispositie[1] : null;
      const bestandsnaam = dispositie ? dispositie[2] : undefined;

      if (veldNaam) {
        if (bestandsnaam !== undefined) {
          if (bestandsnaam) {
            bestanden.push({
              veld: veldNaam,
              bestandsnaam,
              contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
              data: inhoud,
            });
          }
        } else {
          velden[veldNaam] = inhoud.toString('utf8');
        }
      }
    }

    idx = volgendeIdx;
  }

  return { velden, bestanden };
}
