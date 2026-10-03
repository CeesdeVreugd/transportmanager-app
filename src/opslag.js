// Opslag van geüploade bestanden (CMR, pakbonnen, foto's, handtekeningen) op
// dezelfde persistente schijf als de database, zodat ze een redeploy
// overleven (net als data/transport.db).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './db.js';

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

function veiligeBestandsnaam(naam) {
  const schoon = (naam || 'bestand').replace(/[^a-zA-Z0-9.\-_]/g, '_');
  return schoon.slice(-80) || 'bestand';
}

export function slaBestandOp(buffer, origineleNaam, submap = '') {
  const map = path.join(UPLOADS_DIR, submap);
  fs.mkdirSync(map, { recursive: true });
  const naam = `${randomUUID()}-${veiligeBestandsnaam(origineleNaam)}`;
  fs.writeFileSync(path.join(map, naam), buffer);
  return submap ? `${submap}/${naam}` : naam;
}

export function bestandPad(relatiefPad) {
  const volledig = path.normalize(path.join(UPLOADS_DIR, relatiefPad));
  if (!volledig.startsWith(UPLOADS_DIR)) {
    throw new Error('Ongeldig bestandspad.');
  }
  return volledig;
}

export function bestandBestaat(relatiefPad) {
  try {
    return fs.statSync(bestandPad(relatiefPad)).isFile();
  } catch {
    return false;
  }
}

export function verwijderBestand(relatiefPad) {
  try {
    fs.unlinkSync(bestandPad(relatiefPad));
  } catch {
    // Bestand bestond al niet (meer) — geen probleem.
  }
}
