// Overzetten vanaf de oude (online) omgeving naar deze Docker-omgeving.
//
// 1) Database terugzetten: een .db-back-up (gedownload via "Back-ups" in de
//    oude omgeving) wordt gecontroleerd en klaargezet. De app herstart zich
//    daarna zelf (Docker start de container automatisch opnieuw) en wisselt
//    de database bij het opstarten in — zie verwerkHerstelWachtrij() in db.js.
//
// 2) Bestanden ophalen: geüploade CMR's, pakbonnen, foto's en handtekeningen
//    staan niet in de database maar als losse bestanden. Deze functie logt in
//    op de oude omgeving met een planner-account en haalt elk bestand op dat
//    in de database genoemd wordt maar hier nog ontbreekt.
import fs from 'node:fs';
import path from 'node:path';
import db, { HERSTEL_WACHTRIJ_PAD } from './db.js';
import { UPLOADS_DIR, bestandBestaat, bestandPad } from './opslag.js';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');

/**
 * Controleert en plaatst een geüploade database in de wachtrij. Gooit een
 * Error met een leesbare melding als het geen geldige back-up is.
 */
export function zetDatabaseKlaarVoorHerstel(buffer) {
  if (!buffer || buffer.length < 1024 || !buffer.subarray(0, 16).equals(SQLITE_HEADER)) {
    throw new Error('Dit is geen geldige database-back-up (verwacht een .db-bestand uit "Back-ups").');
  }
  const tijdelijk = HERSTEL_WACHTRIJ_PAD + '.upload';
  fs.writeFileSync(tijdelijk, buffer);
  fs.renameSync(tijdelijk, HERSTEL_WACHTRIJ_PAD);
}

/** Herstart de app kort na het versturen van het antwoord. */
export function herstartBinnenkort() {
  setTimeout(() => {
    console.log('[Herstel] App herstart om de geüploade database in te wisselen...');
    try {
      db.close();
    } catch {
      // al gesloten
    }
    process.exit(0);
  }, 1500);
}

// ---- Bestanden ophalen van de oude omgeving (draait op de achtergrond) ----

let ophaalStatus = null; // { bezig, totaal, opgehaald, overgeslagen, mislukt, melding, klaarOp }

export function bestandenOphaalStatus() {
  return ophaalStatus;
}

function benodigdeBestanden() {
  const namen = new Set();
  for (const r of db.prepare('SELECT bestandsnaam AS n FROM taak_documenten WHERE bestandsnaam IS NOT NULL').all()) namen.add(r.n);
  for (const r of db.prepare('SELECT foto_bestandsnaam AS n FROM incidenten WHERE foto_bestandsnaam IS NOT NULL').all()) namen.add(r.n);
  return [...namen].filter((n) => n && n.trim());
}

export function aantalOntbrekendeBestanden() {
  try {
    return benodigdeBestanden().filter((n) => !bestandBestaat(n)).length;
  } catch {
    return 0;
  }
}

async function logInOpOudeOmgeving(basisUrl, email, wachtwoord) {
  const antwoord = await fetch(basisUrl + '/inloggen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, wachtwoord }).toString(),
    redirect: 'manual',
  });
  const cookies = typeof antwoord.headers.getSetCookie === 'function' ? antwoord.headers.getSetCookie() : [];
  const sessie = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('sessie=') && c.length > 'sessie='.length);
  if (!sessie) {
    throw new Error('Inloggen op de oude omgeving is mislukt. Controleer het adres, e-mailadres en wachtwoord (planner-account).');
  }
  return sessie;
}

export function startBestandenOphalen({ url, email, wachtwoord }) {
  if (ophaalStatus && ophaalStatus.bezig) {
    throw new Error('Er loopt al een ophaalactie.');
  }
  let basisUrl = (url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(basisUrl)) basisUrl = 'https://' + basisUrl;
  try {
    new URL(basisUrl);
  } catch {
    throw new Error('Ongeldig adres van de oude omgeving.');
  }

  ophaalStatus = { bezig: true, totaal: 0, opgehaald: 0, overgeslagen: 0, mislukt: 0, melding: 'Bezig met inloggen…', klaarOp: null };

  (async () => {
    try {
      const sessie = await logInOpOudeOmgeving(basisUrl, (email || '').trim(), wachtwoord || '');
      const namen = benodigdeBestanden();
      ophaalStatus.totaal = namen.length;
      ophaalStatus.melding = 'Bestanden ophalen…';
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });

      for (const naam of namen) {
        try {
          if (bestandBestaat(naam)) {
            ophaalStatus.overgeslagen++;
            continue;
          }
          const doel = bestandPad(naam); // controleert ook dat het pad binnen de uploadmap blijft
          const antwoord = await fetch(`${basisUrl}/bestanden/${encodeURIComponent(naam)}`, {
            headers: { Cookie: sessie },
            redirect: 'manual',
          });
          if (antwoord.status !== 200) {
            ophaalStatus.mislukt++;
            continue;
          }
          const data = Buffer.from(await antwoord.arrayBuffer());
          fs.mkdirSync(path.dirname(doel), { recursive: true });
          fs.writeFileSync(doel + '.deel', data);
          fs.renameSync(doel + '.deel', doel);
          ophaalStatus.opgehaald++;
        } catch {
          ophaalStatus.mislukt++;
        }
      }
      ophaalStatus.melding = 'Klaar.';
    } catch (fout) {
      ophaalStatus.melding = fout.message;
      ophaalStatus.fout = true;
    } finally {
      ophaalStatus.bezig = false;
      ophaalStatus.klaarOp = new Date();
    }
  })();
}
