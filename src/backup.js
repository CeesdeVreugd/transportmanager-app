// Automatische en handmatige back-ups van de database. Zonder externe
// dependencies: periodiek wordt een kopie van het SQLite-bestand weggeschreven
// naar een aparte back-upmap, op dezelfde persistente schijf als de database
// zelf (overleeft dus een redeploy, net als data/transport.db).
//
// De database draait in WAL-modus; vóór het kopiëren wordt daarom eerst een
// checkpoint afgedwongen zodat alle recente wijzigingen echt in het
// hoofdbestand staan en de kopie compleet en consistent is.
import fs from 'node:fs';
import path from 'node:path';
import db, { DB_PATH, nieuweId } from './db.js';
import { BACKUPS_DIR } from './opslag.js';
import { oneDriveGekoppeld, uploadNaarOneDrive } from './onedrive.js';

const BEHOUD_AANTAL = 14; // bewaar de 14 meest recente back-ups, ruim genoeg voor twee weken dagelijks

function zorgVoorBackupMap() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function opschonenOudeBackups() {
  const alle = db.prepare('SELECT * FROM backups ORDER BY aangemaakt_op DESC').all();
  const teVeel = alle.slice(BEHOUD_AANTAL);
  for (const b of teVeel) {
    try {
      fs.unlinkSync(path.join(BACKUPS_DIR, b.bestandsnaam));
    } catch {
      // Bestand was al weg — geen probleem.
    }
    db.prepare('DELETE FROM backups WHERE id = ?').run(b.id);
  }
}

/**
 * Maakt direct een back-up van de database en registreert deze. Geeft de
 * bestandsnaam terug, of null als er (nog) geen databasebestand is.
 */
export function maakBackup() {
  zorgVoorBackupMap();
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (fout) {
    console.error('Wal-checkpoint mislukt vóór back-up (back-up gaat toch door):', fout.message);
  }
  if (!fs.existsSync(DB_PATH)) return null;

  const tijdstip = new Date().toISOString().replace(/[:.]/g, '-');
  const bestandsnaam = `transport-backup-${tijdstip}.db`;
  const doelPad = path.join(BACKUPS_DIR, bestandsnaam);
  fs.copyFileSync(DB_PATH, doelPad);
  const grootte = fs.statSync(doelPad).size;

  const id = nieuweId();
  db.prepare('INSERT INTO backups (id, bestandsnaam, grootte_bytes) VALUES (?, ?, ?)').run(id, bestandsnaam, grootte);
  opschonenOudeBackups();

  if (oneDriveGekoppeld()) {
    // Niet blokkerend: de lokale back-up is al veiliggesteld, de upload naar
    // OneDrive mag op de achtergrond gebeuren en de rest niet ophouden.
    uploadBackupNaarOneDrive(id).catch(() => {});
  }

  return bestandsnaam;
}

/**
 * Uploadt (of herprobeert) de OneDrive-kopie van één specifieke back-up en
 * legt het resultaat vast op de bijbehorende rij in de database.
 */
export async function uploadBackupNaarOneDrive(backupId) {
  const rij = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId);
  if (!rij) return { status: 'fout', bericht: 'Back-up niet gevonden.' };
  if (!oneDriveGekoppeld()) return { status: 'fout', bericht: 'OneDrive is niet gekoppeld.' };

  const lokaalPad = path.join(BACKUPS_DIR, rij.bestandsnaam);
  try {
    await uploadNaarOneDrive(lokaalPad, rij.bestandsnaam);
    db.prepare('UPDATE backups SET onedrive_status = ?, onedrive_bijgewerkt_op = datetime(\'now\') WHERE id = ?').run(
      'ok',
      backupId
    );
    return { status: 'ok' };
  } catch (fout) {
    console.error('OneDrive-upload van back-up mislukt:', fout.message);
    db.prepare('UPDATE backups SET onedrive_status = ?, onedrive_bijgewerkt_op = datetime(\'now\') WHERE id = ?').run(
      'mislukt',
      backupId
    );
    return { status: 'fout', bericht: fout.message };
  }
}

export function lijstBackups() {
  return db.prepare('SELECT * FROM backups ORDER BY aangemaakt_op DESC').all();
}

/**
 * Geeft een veilig, binnen de back-upmap gegarandeerd pad terug voor een
 * gevraagde back-upbestandsnaam (voorkomt paden buiten de map, bijv. via
 * "../").
 */
export function backupBestandPad(bestandsnaam) {
  const veilig = path.basename(bestandsnaam || '');
  const volledig = path.join(BACKUPS_DIR, veilig);
  if (!volledig.startsWith(BACKUPS_DIR)) {
    throw new Error('Ongeldig back-uppad.');
  }
  return volledig;
}

let automatischGestart = false;

/**
 * Start de automatische periodieke back-up (standaard elke 24 uur), inclusief
 * één keer meteen bij het opstarten van de server. Veilig om vaker aan te
 * roepen: start de timer maar één keer op.
 */
export function startAutomatischeBackups(intervalUren = 24) {
  if (automatischGestart) return;
  automatischGestart = true;

  setTimeout(() => {
    try {
      maakBackup();
    } catch (fout) {
      console.error('Automatische back-up mislukt:', fout.message);
    }
  }, 5000);

  setInterval(
    () => {
      try {
        maakBackup();
      } catch (fout) {
        console.error('Automatische back-up mislukt:', fout.message);
      }
    },
    intervalUren * 60 * 60 * 1000
  );
}
