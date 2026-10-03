// Koppeling met OneDrive (Microsoft Graph API) om back-ups ook buiten de server
// te bewaren. Werkt volledig zonder client secret via de OAuth2 "device
// code"-flow: de planner klikt op "Koppel OneDrive", krijgt een korte code te
// zien, voert die in op microsoft.com/devicelogin, en de app bewaart daarna
// zelf een refresh-token om ververst te blijven inloggen. Zonder configuratie
// (geen ONEDRIVE_CLIENT_ID) doet deze module niets — lokale back-ups blijven
// dan gewoon werken zoals altijd.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

const CLIENT_ID = process.env.ONEDRIVE_CLIENT_ID;
const TENANT = process.env.ONEDRIVE_TENANT_ID || 'common';
const SCOPE = 'Files.ReadWrite offline_access';
const MAP_NAAM = 'Back-ups De Vreugd Transport';
const TOKEN_BESTAND = path.join(DATA_DIR, 'onedrive-token.json');

export function oneDriveGeconfigureerd() {
  return Boolean(CLIENT_ID);
}

function leesTokenBestand() {
  try {
    const ruw = fs.readFileSync(TOKEN_BESTAND, 'utf8');
    return JSON.parse(ruw);
  } catch {
    return null;
  }
}

function schrijfTokenBestand(refreshToken) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    TOKEN_BESTAND,
    JSON.stringify({ refresh_token: refreshToken, bijgewerkt_op: new Date().toISOString() }, null, 2)
  );
}

export function oneDriveGekoppeld() {
  return oneDriveGeconfigureerd() && Boolean(leesTokenBestand()?.refresh_token);
}

export function oneDriveLoskoppelen() {
  try {
    fs.unlinkSync(TOKEN_BESTAND);
  } catch {
    // Was al niet gekoppeld — geen probleem.
  }
}

function tokenUrl() {
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
}

// Microsoft geeft bij succes en normale fouten JSON terug, maar bij een
// netwerk- of proxyprobleem (of een storing) soms platte tekst — dat mag
// nooit een onherkenbare crash geven, dus dit vangt dat netjes op.
async function leesJsonVeilig(resp) {
  const tekst = await resp.text();
  try {
    return JSON.parse(tekst);
  } catch {
    return { error: 'onbekend', error_description: tekst.slice(0, 200) || `Onverwacht antwoord (${resp.status}) van Microsoft.` };
  }
}

/**
 * Stap 1 van de koppel-flow: vraagt bij Microsoft een korte gebruikerscode
 * aan die de planner op microsoft.com/devicelogin moet invoeren.
 */
export async function startDeviceCodeFlow() {
  if (!oneDriveGeconfigureerd()) {
    throw new Error('ONEDRIVE_CLIENT_ID is niet ingesteld.');
  }
  const resp = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  const data = await leesJsonVeilig(resp);
  if (!resp.ok) {
    throw new Error(data.error_description || 'Kon geen koppelcode aanvragen bij Microsoft.');
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificatieUrl: data.verification_uri,
    verlooptOverSeconden: data.expires_in,
    pollIntervalSeconden: data.interval || 5,
  };
}

/**
 * Stap 2: controleert of de planner de code inmiddels heeft ingevoerd. Geeft
 * { status: 'ok' }, { status: 'pending' } of { status: 'fout', bericht } terug.
 */
export async function controleerDeviceCodeFlow(deviceCode) {
  const resp = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: CLIENT_ID,
      device_code: deviceCode,
    }),
  });
  const data = await leesJsonVeilig(resp);
  if (resp.ok && data.refresh_token) {
    schrijfTokenBestand(data.refresh_token);
    return { status: 'ok' };
  }
  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { status: 'pending' };
  }
  return { status: 'fout', bericht: data.error_description || data.error || 'Onbekende fout van Microsoft.' };
}

async function verkrijgAccessToken() {
  const opgeslagen = leesTokenBestand();
  if (!opgeslagen?.refresh_token) {
    throw new Error('OneDrive is niet gekoppeld.');
  }
  const resp = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: opgeslagen.refresh_token,
      scope: SCOPE,
    }),
  });
  const data = await leesJsonVeilig(resp);
  if (!resp.ok) {
    throw new Error(data.error_description || 'Kon geen nieuw toegangstoken ophalen bij Microsoft.');
  }
  // Microsoft geeft vaak een nieuwe refresh-token mee — die moet de oude
  // vervangen, anders werkt de koppeling bij de volgende ronde niet meer.
  if (data.refresh_token) {
    schrijfTokenBestand(data.refresh_token);
  }
  return data.access_token;
}

/**
 * Uploadt een lokaal back-upbestand naar de map "Back-ups De Vreugd
 * Transport" in de OneDrive van de gekoppelde account. Ondersteunt zowel
 * kleine bestanden (directe upload) als grotere (upload-sessie in stukken
 * van 5 MB), zodat ook een gegroeide database probleemloos wegkomt.
 */
export async function uploadNaarOneDrive(lokaalPad, bestandsnaam) {
  const accessToken = await verkrijgAccessToken();
  const grootte = fs.statSync(lokaalPad).size;
  const doelPad = `${MAP_NAAM}/${bestandsnaam}`;
  const KLEIN_MAX = 4 * 1024 * 1024;

  if (grootte <= KLEIN_MAX) {
    const inhoud = fs.readFileSync(lokaalPad);
    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(doelPad).replace(/%2F/g, '/')}:/content`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
        body: inhoud,
      }
    );
    if (!resp.ok) {
      const tekst = await resp.text().catch(() => '');
      throw new Error(`OneDrive-upload mislukt (${resp.status}): ${tekst.slice(0, 200)}`);
    }
    return;
  }

  // Grotere bestanden: upload-sessie met stukken van 5 MB.
  const sessieResp = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(doelPad).replace(/%2F/g, '/')}:/createUploadSession`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    }
  );
  const sessie = await sessieResp.json();
  if (!sessieResp.ok || !sessie.uploadUrl) {
    throw new Error('Kon geen upload-sessie starten bij OneDrive.');
  }

  const CHUNK = 5 * 1024 * 1024;
  const fd = fs.openSync(lokaalPad, 'r');
  try {
    let offset = 0;
    while (offset < grootte) {
      const lengte = Math.min(CHUNK, grootte - offset);
      const buffer = Buffer.alloc(lengte);
      fs.readSync(fd, buffer, 0, lengte, offset);
      const eind = offset + lengte - 1;
      const chunkResp = await fetch(sessie.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(lengte),
          'Content-Range': `bytes ${offset}-${eind}/${grootte}`,
        },
        body: buffer,
      });
      if (!chunkResp.ok && chunkResp.status !== 202) {
        const tekst = await chunkResp.text().catch(() => '');
        throw new Error(`OneDrive-upload (deel) mislukt (${chunkResp.status}): ${tekst.slice(0, 200)}`);
      }
      offset += lengte;
    }
  } finally {
    fs.closeSync(fd);
  }
}
