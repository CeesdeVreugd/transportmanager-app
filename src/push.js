// Web Push (VAPID) voor pushmeldingen naar chauffeurs, ook als de app niet
// open staat. Gebruikt het npm-pakket "web-push" voor het daadwerkelijk
// versturen (JWT-ondertekening + payload-versleuteling volgens de Web Push-
// standaard) - dat pakket wordt pas geladen op het moment dat een melding
// verstuurd wordt, en als het (nog) niet geïnstalleerd is degradeert de app
// gewoon stil: chauffeurs krijgen dan geen pushmelding, maar de rest van de
// app blijft gewoon werken (zelfde patroon als de routedienst/OneDrive).
//
// De VAPID-sleutels zelf zijn gewoon een EC-sleutelpaar (P-256) - die kunnen
// we met Node's ingebouwde crypto genereren, dus daar is geen pakket voor
// nodig. Genereer ze met: node src/push.js --genereer-sleutels

import { generateKeyPairSync } from 'node:crypto';
import db, { nieuweId } from './db.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT = process.env.VAPID_CONTACT_EMAIL || 'info@devreugd-dt.nl';

export function pushVapidGeconfigureerd() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function vapidPublicKey() {
  return VAPID_PUBLIC_KEY || '';
}

function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function bufToB64url(b) {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Genereert een nieuw VAPID-sleutelpaar (base64url publieke/privésleutel),
// zonder externe pakketten nodig te hebben.
export function genereerVapidSleutels() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  const x = b64urlToBuf(pubJwk.x);
  const y = b64urlToBuf(pubJwk.y);
  const d = b64urlToBuf(privJwk.d);
  const pubPoint = Buffer.concat([Buffer.from([0x04]), x, y]);
  return { publicKey: bufToB64url(pubPoint), privateKey: bufToB64url(d) };
}

let webpushModule = null;
let laadPoging = false;
async function laadWebPush() {
  if (webpushModule) return webpushModule;
  if (laadPoging) return null;
  laadPoging = true;
  try {
    const mod = await import('web-push');
    webpushModule = mod.default || mod;
    webpushModule.setVapidDetails(`mailto:${VAPID_CONTACT}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch {
    webpushModule = null;
  }
  return webpushModule;
}

// ---- Abonnementen opslaan/verwijderen ----
export function slaPushAbonnementOp(gebruikerId, abonnement) {
  if (!abonnement || !abonnement.endpoint || !abonnement.keys) return;
  const bestaand = db.prepare('SELECT id FROM push_abonnementen WHERE endpoint = ?').get(abonnement.endpoint);
  if (bestaand) {
    db.prepare('UPDATE push_abonnementen SET gebruiker_id = ?, p256dh = ?, auth = ? WHERE id = ?').run(
      gebruikerId,
      abonnement.keys.p256dh,
      abonnement.keys.auth,
      bestaand.id
    );
    return;
  }
  db.prepare(
    'INSERT INTO push_abonnementen (id, gebruiker_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)'
  ).run(nieuweId(), gebruikerId, abonnement.endpoint, abonnement.keys.p256dh, abonnement.keys.auth);
}

export function verwijderPushAbonnement(endpoint) {
  if (!endpoint) return;
  db.prepare('DELETE FROM push_abonnementen WHERE endpoint = ?').run(endpoint);
}

// ---- Versturen ----
// payload: { titel, tekst, url } - url is waar de melding naartoe moet linken
// (bijv. de routepagina), zodat een klik op de melding daar direct heen gaat.
export async function stuurPushNaarGebruiker(gebruikerId, payload) {
  if (!pushVapidGeconfigureerd()) return;
  const webpush = await laadWebPush();
  if (!webpush) return;

  const abonnementen = db.prepare('SELECT * FROM push_abonnementen WHERE gebruiker_id = ?').all(gebruikerId);
  const body = JSON.stringify(payload);

  for (const abo of abonnementen) {
    const subscription = { endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } };
    try {
      await webpush.sendNotification(subscription, body);
    } catch (fout) {
      if (fout && (fout.statusCode === 404 || fout.statusCode === 410)) {
        verwijderPushAbonnement(abo.endpoint);
      }
      // Andere fouten (tijdelijk netwerkprobleem e.d.) negeren we stil - de
      // in-app functionaliteit mag hier nooit door breken.
    }
  }
}

// Kleine CLI: `node src/push.js --genereer-sleutels` print een nieuw
// VAPID-sleutelpaar, klaar om als omgevingsvariabelen in Portainer te zetten.
if (process.argv[1] && process.argv[1].endsWith('push.js') && process.argv.includes('--genereer-sleutels')) {
  const sleutels = genereerVapidSleutels();
  console.log('\n=== Nieuw VAPID-sleutelpaar voor pushmeldingen ===');
  console.log(`VAPID_PUBLIC_KEY=${sleutels.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${sleutels.privateKey}`);
  console.log('\nZet deze twee als omgevingsvariabelen in Portainer (stack transportmanager, net als ORS_API_KEY).\n');
}

export default {
  pushVapidGeconfigureerd,
  vapidPublicKey,
  genereerVapidSleutels,
  slaPushAbonnementOp,
  verwijderPushAbonnement,
  stuurPushNaarGebruiker,
};
