import { randomBytes } from 'node:crypto';
import db, { nieuweId } from './db.js';

const SESSIE_DUUR_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagen
// Voor het inloggen met een persoonlijke code (chauffeurs, als startscherm-
// icoon gebruikt): blijft ingelogd totdat de app echt wordt afgesloten/
// verwijderd, dus een sessie die praktisch niet verloopt (ruim een jaar).
export const SESSIE_DUUR_LANG_MS = 400 * 24 * 60 * 60 * 1000;

export function maakSessie(gebruikerId, duurMs = SESSIE_DUUR_MS) {
  const token = randomBytes(32).toString('hex');
  const verloopt = new Date(Date.now() + duurMs).toISOString();
  db.prepare('INSERT INTO sessies (token, gebruiker_id, verloopt_op) VALUES (?, ?, ?)').run(
    token,
    gebruikerId,
    verloopt
  );
  return { token, verloopt };
}

export function verwijderSessie(token) {
  db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
}

export function haalGebruikerViaSessie(token) {
  if (!token) return null;
  const rij = db
    .prepare(
      `SELECT g.* FROM sessies s
       JOIN gebruikers g ON g.id = s.gebruiker_id
       WHERE s.token = ? AND s.verloopt_op > datetime('now')`
    )
    .get(token);
  return rij || null;
}

export function parseCookies(headerWaarde) {
  const cookies = {};
  if (!headerWaarde) return cookies;
  for (const deel of headerWaarde.split(';')) {
    const idx = deel.indexOf('=');
    if (idx === -1) continue;
    const naam = deel.slice(0, idx).trim();
    const waarde = deel.slice(idx + 1).trim();
    cookies[naam] = decodeURIComponent(waarde);
  }
  return cookies;
}

export function sessieCookieHeader(token, { verwijder = false, duurMs = SESSIE_DUUR_MS } = {}) {
  const basis = `sessie=${token}; Path=/; HttpOnly; SameSite=Lax`;
  if (verwijder) {
    return `${basis}; Max-Age=0`;
  }
  return `${basis}; Max-Age=${Math.round(duurMs / 1000)}`;
}

export { nieuweId };
