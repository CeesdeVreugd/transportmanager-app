// Database-laag. Gebruikt Node's ingebouwde node:sqlite module (geen externe
// dependencies nodig) zodat de app zonder package-installatie kan draaien.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In Docker staat alle data in het volume /data (DATA_DIR=/data, zie
// Dockerfile). Lokaal valt het terug op de map data/ naast de code.
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'transport.db');

// Een database die via "Back-ups → Overzetten" is geüpload, wordt hier
// klaargezet en pas bij de volgende start (vóór het openen) ingewisseld —
// zo wordt een open database nooit overschreven.
export const HERSTEL_WACHTRIJ_PAD = path.join(DATA_DIR, 'herstel-wachtrij.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function verwerkHerstelWachtrij() {
  if (!fs.existsSync(HERSTEL_WACHTRIJ_PAD)) return;
  try {
    if (fs.existsSync(DB_PATH)) {
      const tijdstip = new Date().toISOString().replace(/[:.]/g, '-');
      const veiligheidsMap = path.join(DATA_DIR, 'backups');
      fs.mkdirSync(veiligheidsMap, { recursive: true });
      fs.copyFileSync(DB_PATH, path.join(veiligheidsMap, `voor-herstel-${tijdstip}.db`));
    }
    for (const extra of ['-wal', '-shm']) {
      fs.rmSync(DB_PATH + extra, { force: true });
    }
    fs.renameSync(HERSTEL_WACHTRIJ_PAD, DB_PATH);
    console.log('[Herstel] Geüploade database is ingewisseld. De vorige database staat in data/backups (voor-herstel-...).');
  } catch (fout) {
    console.error('[Herstel] Inwisselen van de geüploade database mislukt:', fout.message);
  }
}
verwerkHerstelWachtrij();

export const db = new DatabaseSync(DB_PATH);

// Praktische instellingen voor een klein, betrouwbaar bestand-gebaseerd systeem.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS gebruikers (
  id TEXT PRIMARY KEY,
  naam TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  wachtwoord_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('planner', 'chauffeur')),
  actief INTEGER NOT NULL DEFAULT 1,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessies (
  token TEXT PRIMARY KEY,
  gebruiker_id TEXT NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
  verloopt_op TEXT NOT NULL,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voertuigen (
  id TEXT PRIMARY KEY,
  kenteken TEXT NOT NULL UNIQUE,
  omschrijving TEXT,
  actief INTEGER NOT NULL DEFAULT 1,
  kostprijs_per_km REAL NOT NULL DEFAULT 0,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS toltarieven (
  id TEXT PRIMARY KEY,
  omschrijving TEXT NOT NULL,
  bedrag REAL NOT NULL DEFAULT 0,
  actief INTEGER NOT NULL DEFAULT 1,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Toltarieven per land, in centen per km (naast de bestaande vaste
-- toltarieven hierboven, die voor de prijscalculator blijven bestaan). Bij
-- het afsluiten van een opdracht vult de chauffeur handmatig in hoeveel km
-- er in elk land is gereden; de tolkosten worden daaruit berekend.
CREATE TABLE IF NOT EXISTS tol_landtarieven (
  id TEXT PRIMARY KEY,
  land TEXT NOT NULL,
  cent_per_km REAL NOT NULL DEFAULT 0,
  actief INTEGER NOT NULL DEFAULT 1,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Handmatig ingevulde km per land voor een opdracht, met de op dat moment
-- geldende toltarieven al doorgerekend (snapshot, net als kostprijs/
-- klantprijs bij ritten) zodat een latere tariefwijziging oude opdrachten
-- niet met terugwerkende kracht verandert.
CREATE TABLE IF NOT EXISTS opdracht_tol_km (
  id TEXT PRIMARY KEY,
  opdracht_id TEXT NOT NULL REFERENCES opdrachten(id) ON DELETE CASCADE,
  land TEXT NOT NULL,
  km REAL NOT NULL DEFAULT 0,
  cent_per_km REAL NOT NULL DEFAULT 0,
  bedrag REAL NOT NULL DEFAULT 0,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instellingen (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  marge_percentage REAL NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS klanten (
  id TEXT PRIMARY KEY,
  naam TEXT NOT NULL,
  adres TEXT,
  telefoon TEXT,
  email TEXT,
  type TEXT NOT NULL DEFAULT 'klant',
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Eén klant/opdrachtgever kan meerdere tariefafspraken hebben (bijv.
-- "Standaard - per uur" en "Palletvervoer - per pallet"), zodat per rit of
-- werkdag de juiste afspraak gekozen kan worden.
CREATE TABLE IF NOT EXISTS tariefafspraken (
  id TEXT PRIMARY KEY,
  klant_id TEXT NOT NULL REFERENCES klanten(id) ON DELETE CASCADE,
  naam TEXT NOT NULL,
  type TEXT NOT NULL,
  tarief_vast REAL,
  tarief_per_uur REAL,
  tarief_per_km REAL,
  tarief_per_pallet REAL,
  actief INTEGER NOT NULL DEFAULT 1,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Routes: een opdracht met één of meer taken (laden/lossen), altijd door de
-- planner aangemaakt en aan een chauffeur gekoppeld.
CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  datum TEXT NOT NULL,
  klant_id TEXT REFERENCES klanten(id) ON DELETE SET NULL,
  chauffeur_id TEXT REFERENCES gebruikers(id) ON DELETE SET NULL,
  voertuig_id TEXT REFERENCES voertuigen(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'gepland',
  opmerkingen TEXT,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
  bijgewerkt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taken (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  volgorde INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  adres TEXT NOT NULL,
  lading_omschrijving TEXT,
  aantal_pallets REAL,
  aantal_colli REAL,
  gewicht_kg REAL,
  laadmeters REAL,
  tijdvenster_van TEXT,
  tijdvenster_tot TEXT,
  telefoonnummer TEXT,
  laadnummer TEXT,
  extra_info TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  afgerond_op TEXT,
  chauffeur_opmerking TEXT,
  lat REAL,
  lng REAL,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taak_documenten (
  id TEXT PRIMARY KEY,
  taak_id TEXT NOT NULL REFERENCES taken(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  bestandsnaam TEXT NOT NULL,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Werkdagen: dagregistratie voor elke chauffeur, elke werkdag. Gekoppeld aan
-- een route (indien toegewezen) of los, met een handmatig gekozen
-- opdrachtgever + tariefafspraak (voor uur/km/pallet-werk).
CREATE TABLE IF NOT EXISTS werkdagen (
  id TEXT PRIMARY KEY,
  chauffeur_id TEXT NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  klant_id TEXT REFERENCES klanten(id) ON DELETE SET NULL,
  route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
  tariefafspraak_id TEXT REFERENCES tariefafspraken(id) ON DELETE SET NULL,
  start_km REAL,
  eind_km REAL,
  start_tijd TEXT,
  eind_tijd TEXT,
  status TEXT NOT NULL DEFAULT 'bezig',
  opmerkingen TEXT,
  gefactureerd INTEGER NOT NULL DEFAULT 0,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pauzes (
  id TEXT PRIMARY KEY,
  werkdag_id TEXT NOT NULL REFERENCES werkdagen(id) ON DELETE CASCADE,
  start_tijd TEXT NOT NULL,
  eind_tijd TEXT
);

-- Opdrachten: één werkdag kan voor meerdere opdrachtgevers na elkaar worden
-- gereden (bijv. 's ochtends klant A, 's middags klant B). Elke opdracht is
-- zo'n opdrachtgever-segment binnen een werkdag, met zijn eigen begin/eind
-- (tijd, plaats, km) en, voor de planner, tariefafspraak. De losse stops
-- (dagregels) horen bij precies één opdracht.
CREATE TABLE IF NOT EXISTS opdrachten (
  id TEXT PRIMARY KEY,
  werkdag_id TEXT NOT NULL REFERENCES werkdagen(id) ON DELETE CASCADE,
  volgorde INTEGER NOT NULL DEFAULT 0,
  klant_id TEXT REFERENCES klanten(id) ON DELETE SET NULL,
  route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
  tariefafspraak_id TEXT REFERENCES tariefafspraken(id) ON DELETE SET NULL,
  start_tijd TEXT,
  start_plaats TEXT,
  start_km REAL,
  eind_tijd TEXT,
  eind_plaats TEXT,
  eind_km REAL,
  status TEXT NOT NULL DEFAULT 'bezig',
  gefactureerd INTEGER NOT NULL DEFAULT 0,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dagregels: het "stops"-logboek per opdracht, naar voorbeeld van het
-- papieren rittenformulier. Elke regel is één stop (laden/lossen/pauze/
-- alleen doorrijden) met aankomst-/vertrektijd en kilometerstand. De eerste
-- en laatste stop van een opdracht vallen samen met opdrachten.start_tijd/
-- start_km en eind_tijd/eind_km (die blijven de "grenzen" van de opdracht).
-- werkdag_id staat er nog steeds bij (naast opdracht_id) zodat de bestaande
-- NOT NULL-constraint niet aangepast hoeft te worden; hij wordt afgeleid van
-- de opdracht waar de regel bij hoort.
CREATE TABLE IF NOT EXISTS dagregels (
  id TEXT PRIMARY KEY,
  werkdag_id TEXT NOT NULL REFERENCES werkdagen(id) ON DELETE CASCADE,
  volgorde INTEGER NOT NULL DEFAULT 0,
  plaats TEXT,
  tijd_aankomst TEXT,
  tijd_vertrek TEXT,
  laden INTEGER NOT NULL DEFAULT 0,
  lossen INTEGER NOT NULL DEFAULT 0,
  pauze INTEGER NOT NULL DEFAULT 0,
  km_stand REAL,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opdrachten_werkdag ON opdrachten(werkdag_id);

-- Web-push-abonnementen: per gebruiker (chauffeur) kan een device zich
-- abonneren op pushmeldingen. Eén gebruiker kan meerdere apparaten hebben.
CREATE TABLE IF NOT EXISTS push_abonnementen (
  id TEXT PRIMARY KEY,
  gebruiker_id TEXT NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidenten (
  id TEXT PRIMARY KEY,
  taak_id TEXT REFERENCES taken(id) ON DELETE SET NULL,
  werkdag_id TEXT REFERENCES werkdagen(id) ON DELETE SET NULL,
  chauffeur_id TEXT REFERENCES gebruikers(id) ON DELETE SET NULL,
  omschrijving TEXT NOT NULL,
  foto_bestandsnaam TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voertuig_herinneringen (
  id TEXT PRIMARY KEY,
  voertuig_id TEXT NOT NULL REFERENCES voertuigen(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  omschrijving TEXT,
  vervaldatum TEXT NOT NULL,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rit_templates (
  id TEXT PRIMARY KEY,
  naam TEXT NOT NULL,
  klant_id TEXT REFERENCES klanten(id) ON DELETE SET NULL,
  ophaal_adres TEXT,
  aflever_adres TEXT,
  voertuig_id TEXT REFERENCES voertuigen(id) ON DELETE SET NULL,
  chauffeur_id TEXT REFERENCES gebruikers(id) ON DELETE SET NULL,
  opmerkingen TEXT,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prijscalculator: complete offertes/kostprijsberekeningen los van een
-- geplande rit — voor snel en compleet een klantprijs bepalen (afstand,
-- reistijd incl. verplichte EU-rusttijden, tol, ADR, koeltransport,
-- wachttijd, chauffeursvergoeding/overnachting). Geen vignetten.
CREATE TABLE IF NOT EXISTS prijsberekeningen (
  id TEXT PRIMARY KEY,
  ophaal_adres TEXT,
  aflever_adres TEXT,
  afstand_km REAL NOT NULL DEFAULT 0,
  leeg_km REAL NOT NULL DEFAULT 0,
  voertuig_id TEXT REFERENCES voertuigen(id) ON DELETE SET NULL,
  kostprijs_per_km REAL NOT NULL DEFAULT 0,
  tol_omschrijving TEXT,
  tolkosten REAL NOT NULL DEFAULT 0,
  adr INTEGER NOT NULL DEFAULT 0,
  adr_percentage REAL NOT NULL DEFAULT 0,
  adr_toeslag REAL NOT NULL DEFAULT 0,
  koeltransport INTEGER NOT NULL DEFAULT 0,
  koel_percentage REAL NOT NULL DEFAULT 0,
  koel_toeslag REAL NOT NULL DEFAULT 0,
  wachttijd_uren REAL NOT NULL DEFAULT 0,
  wachttijd_tarief REAL NOT NULL DEFAULT 0,
  wachttijd_toeslag REAL NOT NULL DEFAULT 0,
  gemiddelde_snelheid REAL NOT NULL DEFAULT 70,
  geschatte_rijtijd_uren REAL NOT NULL DEFAULT 0,
  geschatte_reisduur_uren REAL NOT NULL DEFAULT 0,
  aantal_overnachtingen INTEGER NOT NULL DEFAULT 0,
  vergoeding_per_overnachting REAL NOT NULL DEFAULT 0,
  overnachting_toeslag REAL NOT NULL DEFAULT 0,
  marge_percentage REAL NOT NULL DEFAULT 0,
  totale_kostprijs REAL NOT NULL DEFAULT 0,
  voorgestelde_klantprijs REAL NOT NULL DEFAULT 0,
  opmerkingen TEXT,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

-- In-app meldingen voor chauffeurs (geen push/e-mail): bijv. een nieuwe route
-- toegewezen gekregen, of een al toegewezen route die is gewijzigd.
CREATE TABLE IF NOT EXISTS meldingen (
  id TEXT PRIMARY KEY,
  gebruiker_id TEXT NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
  route_id TEXT REFERENCES routes(id) ON DELETE SET NULL,
  tekst TEXT NOT NULL,
  gelezen INTEGER NOT NULL DEFAULT 0,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  bestandsnaam TEXT NOT NULL,
  grootte_bytes INTEGER,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ritten (
  id TEXT PRIMARY KEY,
  datum TEXT NOT NULL,
  ophaal_adres TEXT NOT NULL,
  aflever_adres TEXT NOT NULL,
  klant_id TEXT REFERENCES klanten(id) ON DELETE SET NULL,
  voertuig_id TEXT REFERENCES voertuigen(id) ON DELETE SET NULL,
  chauffeur_id TEXT REFERENCES gebruikers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'gepland' CHECK (status IN ('gepland', 'onderweg', 'afgerond', 'geannuleerd')),
  opmerkingen TEXT,
  afstand_km REAL,
  tolkosten REAL NOT NULL DEFAULT 0,
  kostprijs REAL NOT NULL DEFAULT 0,
  klantprijs REAL,
  gefactureerd INTEGER NOT NULL DEFAULT 0,
  aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
  bijgewerkt_op TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rit_tol (
  id TEXT PRIMARY KEY,
  rit_id TEXT NOT NULL REFERENCES ritten(id) ON DELETE CASCADE,
  tol_id TEXT REFERENCES toltarieven(id) ON DELETE SET NULL,
  omschrijving TEXT NOT NULL,
  bedrag REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ritten_datum ON ritten(datum);
CREATE INDEX IF NOT EXISTS idx_ritten_chauffeur ON ritten(chauffeur_id);
CREATE INDEX IF NOT EXISTS idx_rit_tol_rit ON rit_tol(rit_id);
CREATE INDEX IF NOT EXISTS idx_tariefafspraken_klant ON tariefafspraken(klant_id);
CREATE INDEX IF NOT EXISTS idx_routes_datum ON routes(datum);
CREATE INDEX IF NOT EXISTS idx_routes_chauffeur ON routes(chauffeur_id);
CREATE INDEX IF NOT EXISTS idx_taken_route ON taken(route_id);
CREATE INDEX IF NOT EXISTS idx_taak_documenten_taak ON taak_documenten(taak_id);
CREATE INDEX IF NOT EXISTS idx_werkdagen_chauffeur ON werkdagen(chauffeur_id);
CREATE INDEX IF NOT EXISTS idx_werkdagen_datum ON werkdagen(datum);
CREATE INDEX IF NOT EXISTS idx_pauzes_werkdag ON pauzes(werkdag_id);
CREATE INDEX IF NOT EXISTS idx_dagregels_werkdag ON dagregels(werkdag_id);
CREATE INDEX IF NOT EXISTS idx_push_abonnementen_gebruiker ON push_abonnementen(gebruiker_id);
CREATE INDEX IF NOT EXISTS idx_incidenten_status ON incidenten(status);
CREATE INDEX IF NOT EXISTS idx_voertuig_herinneringen_voertuig ON voertuig_herinneringen(voertuig_id);
CREATE INDEX IF NOT EXISTS idx_prijsberekeningen_datum ON prijsberekeningen(aangemaakt_op);
CREATE INDEX IF NOT EXISTS idx_meldingen_gebruiker ON meldingen(gebruiker_id, gelezen);
`);

// ---- Migratie: kolommen toevoegen aan tabellen die al bestonden vóór deze
// uitbreiding (bijv. een al live draaiende database), zonder te crashen als
// de kolom er al staat. ----
function voegKolomToeIndienNodig(tabel, kolom, definitie) {
  const bestaandeKolommen = db.prepare(`PRAGMA table_info(${tabel})`).all().map((k) => k.name);
  if (!bestaandeKolommen.includes(kolom)) {
    db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${definitie}`);
  }
}

voegKolomToeIndienNodig('voertuigen', 'kostprijs_per_km', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('ritten', 'afstand_km', 'REAL');
voegKolomToeIndienNodig('ritten', 'tolkosten', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('ritten', 'kostprijs', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('ritten', 'klantprijs', 'REAL');
voegKolomToeIndienNodig('klanten', 'type', "TEXT NOT NULL DEFAULT 'klant'");
voegKolomToeIndienNodig('ritten', 'gefactureerd', 'INTEGER NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('werkdagen', 'gefactureerd', 'INTEGER NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('taken', 'lat', 'REAL');
voegKolomToeIndienNodig('taken', 'lng', 'REAL');
voegKolomToeIndienNodig('backups', 'onedrive_status', 'TEXT');
voegKolomToeIndienNodig('backups', 'onedrive_bijgewerkt_op', 'TEXT');
// Begin-/eindplaats erbij voor de urenregistratie (naast tijd en km-stand,
// die er al waren), en een vrij invulbaar "activiteit"-veld per stop in
// plaats van de losse laden/lossen/pauze-vinkjes (die kolommen blijven
// ongebruikt in de tabel staan, verlies van oude data hierin is akkoord).
voegKolomToeIndienNodig('werkdagen', 'start_plaats', 'TEXT');
voegKolomToeIndienNodig('werkdagen', 'eind_plaats', 'TEXT');
voegKolomToeIndienNodig('dagregels', 'activiteit', 'TEXT');

// Meerdere opdrachtgevers per werkdag ("Opdracht"): elke dagregel hoort voortaan
// bij een opdracht (naast de al bestaande werkdag_id), en een werkdag kan zijn
// brandstofverbruik (liters) bijhouden voor een km/liter-overzicht.
voegKolomToeIndienNodig('dagregels', 'opdracht_id', 'TEXT REFERENCES opdrachten(id) ON DELETE CASCADE');
voegKolomToeIndienNodig('werkdagen', 'liters_verbruikt', 'REAL');
voegKolomToeIndienNodig('opdrachten', 'tolkosten', 'REAL NOT NULL DEFAULT 0');
// Persoonlijke inlogcode (pincode) per gebruiker - vooral bedoeld voor
// chauffeurs, die daarmee kunnen inloggen zonder e-mail/wachtwoord. Elke
// gebruiker stelt zijn eigen code in via Instellingen; zonder ingestelde
// code (NULL) is inloggen met een code niet mogelijk voor die gebruiker.
voegKolomToeIndienNodig('gebruikers', 'pincode_hash', 'TEXT');
// Optioneel ritnummer per werkdag (naast de al bestaande "opmerkingen"-kolom) -
// voor op de dagstaat, alleen ingevuld als de chauffeur dat wil.
voegKolomToeIndienNodig('werkdagen', 'ritnummer', 'TEXT');

// Kostprijsinstellingen voor de nacalculatie: kosten die meeschalen met
// kilometers (brandstof, bandenslijtage, onderhoud, afschrijving) apart van
// kosten die meeschalen met gewerkte tijd (eigen uurloon) of vaste maandlasten
// (verzekering, wegenbelasting, overig) die via het verwachte aantal werkuren
// per maand omgerekend worden naar een uurbedrag. Zie berekenKostprijsPerKm/
// berekenKostprijsPerUur in server.js.
voegKolomToeIndienNodig('instellingen', 'brandstof_per_km', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'banden_per_km', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'onderhoud_per_km', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'afschrijving_per_km', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'uurloon', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'verzekering_per_maand', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'wegenbelasting_per_maand', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'overige_kosten_per_maand', 'REAL NOT NULL DEFAULT 0');
voegKolomToeIndienNodig('instellingen', 'verwachte_uren_per_maand', 'REAL NOT NULL DEFAULT 160');

db.exec('CREATE INDEX IF NOT EXISTS idx_opdracht_tol_km_opdracht ON opdracht_tol_km(opdracht_id);');

// Eenmalige migratie: elke bestaande werkdag zonder opdrachten krijgt precies
// één opdracht die zijn eigen klant/tarief/tijd/km/gefactureerd-velden
// overneemt, en zijn dagregels worden naar die opdracht doorverwezen. Draait
// veilig bij elke opstart (alleen werkdagen zonder opdrachten worden geraakt,
// dus na de eerste keer gebeurt er niets meer).
function migreerWerkdagenNaarOpdrachten() {
  const teMigreren = db
    .prepare(
      `SELECT w.* FROM werkdagen w LEFT JOIN opdrachten o ON o.werkdag_id = w.id WHERE o.id IS NULL`
    )
    .all();
  for (const w of teMigreren) {
    const opdrachtId = nieuweId();
    db.prepare(
      `INSERT INTO opdrachten
         (id, werkdag_id, volgorde, klant_id, route_id, tariefafspraak_id,
          start_tijd, start_plaats, start_km, eind_tijd, eind_plaats, eind_km, status, gefactureerd)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opdrachtId,
      w.id,
      w.klant_id,
      w.route_id,
      w.tariefafspraak_id,
      w.start_tijd,
      w.start_plaats,
      w.start_km,
      w.eind_tijd,
      w.eind_plaats,
      w.eind_km,
      w.status,
      w.gefactureerd
    );
    db.prepare('UPDATE dagregels SET opdracht_id = ? WHERE werkdag_id = ? AND opdracht_id IS NULL').run(opdrachtId, w.id);
  }
}
migreerWerkdagenNaarOpdrachten();

// Eenmalige inhaalslag: opdrachten die al bestonden vóór de automatische
// tariefafspraak-koppeling (zie maakOpdrachtAan in server.js) hebben nog
// geen tariefafspraak_id, waardoor er nooit een "te factureren"-bedrag voor
// werd berekend. Koppel alsnog de tariefafspraak als de opdrachtgever
// precies één actieve tariefafspraak heeft. Draait veilig bij elke opstart
// (raakt alleen rijen die nog geen tariefafspraak_id hebben).
function koppelOntbrekendeTariefafspraken() {
  const teKoppelen = db
    .prepare(`SELECT id, klant_id FROM opdrachten WHERE tariefafspraak_id IS NULL AND klant_id IS NOT NULL`)
    .all();
  for (const o of teKoppelen) {
    const afspraken = db.prepare('SELECT id FROM tariefafspraken WHERE klant_id = ? AND actief = 1').all(o.klant_id);
    if (afspraken.length === 1) {
      db.prepare('UPDATE opdrachten SET tariefafspraak_id = ? WHERE id = ?').run(afspraken[0].id, o.id);
    }
  }
}
koppelOntbrekendeTariefafspraken();

// Zorg dat de instellingen-rij altijd bestaat (standaard marge 20%).
db.exec(`INSERT OR IGNORE INTO instellingen (id, marge_percentage) VALUES (1, 20)`);

// ---- Wachtwoorden ----
export function hashWachtwoord(wachtwoord) {
  const salt = randomBytes(16);
  const hash = scryptSync(wachtwoord, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifieerWachtwoord(wachtwoord, opgeslagenHash) {
  const [saltHex, hashHex] = opgeslagenHash.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const verwacht = Buffer.from(hashHex, 'hex');
  const gevonden = scryptSync(wachtwoord, salt, 64);
  if (gevonden.length !== verwacht.length) return false;
  return timingSafeEqual(gevonden, verwacht);
}

export function nieuweId() {
  return randomUUID();
}

// ---- Eerste-gebruik: seed een planner-account als er nog geen gebruikers zijn ----
export function seedIndienLeeg() {
  const aantal = db.prepare('SELECT COUNT(*) AS n FROM gebruikers').get().n;
  if (aantal > 0) return null;

  const id = nieuweId();
  const tijdelijkWachtwoord = randomBytes(6).toString('base64url');
  db.prepare(
    `INSERT INTO gebruikers (id, naam, email, wachtwoord_hash, rol) VALUES (?, ?, ?, ?, 'planner')`
  ).run(id, 'Beheerder', 'beheerder@voorbeeld.nl', hashWachtwoord(tijdelijkWachtwoord));

  return { email: 'beheerder@voorbeeld.nl', wachtwoord: tijdelijkWachtwoord };
}

export default db;
