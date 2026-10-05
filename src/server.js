import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import db, { hashWachtwoord, nieuweId, zorgVoorEersteBeheerder } from './db.js';
import { huidigeGebruiker, behandelInloggen, meldAlleApparatenAf, stuurWelkomstmail, logActie } from './inloggen.js';
import { kan, vereisteVoorPad, synchroniseerRolKolom } from './rechten.js';
import { behandelBeheer, beheerTabs } from './beheer.js';
import { layout, escapeHtml, APP_VERSIE } from './render.js';
import branding from './branding.js';
import { berekenAfstandKm, routeBerekeningActief } from './routing.js';
import { leesMultipart } from './multipart.js';
import { slaBestandOp, bestandPad, bestandBestaat } from './opslag.js';
import { emailNotificatiesActief, stuurKlantEmail } from './email.js';
import { huidigeTijd, huidigeDatum, huidigeDagVanWeek, minutenTussen, addDagen, weekBereikVanDatum, maandBereikVanDatum } from './tijd.js';
import { pushVapidGeconfigureerd, vapidPublicKey, slaPushAbonnementOp, verwijderPushAbonnement, stuurPushNaarGebruiker } from './push.js';
import { maakBackup, lijstBackups, backupBestandPad, startAutomatischeBackups, uploadBackupNaarOneDrive } from './backup.js';
import { PdfDocument } from './pdf.js';
import {
  zetDatabaseKlaarVoorHerstel,
  herstartBinnenkort,
  startBestandenOphalen,
  bestandenOphaalStatus,
  aantalOntbrekendeBestanden,
} from './migratie.js';
import {
  oneDriveGeconfigureerd,
  oneDriveGekoppeld,
  oneDriveLoskoppelen,
  startDeviceCodeFlow,
  controleerDeviceCodeFlow,
} from './onedrive.js';
import {
  pagRittenOverzicht,
  pagRitFormulier,
  pagVoertuigen,
  pagKlanten,
  pagChauffeurs,
  pagChauffeurDashboard,
  pagChauffeurRitopdrachten,
  pagChauffeurMeldingen,
  pagChauffeurWeekoverzicht,
  pagUrenregistratie,
  pagWerkdagDetail,
  pagWerkdagNieuw,
  pagTaakDetail,
  pagTarieven,
  pagFinancieelOverzicht,
  pagKlantDetail,
  pagWeekUitdraai,
  pagVoertuigDetail,
  pagIncidenten,
  pagDashboard,
  pagPrijscalculator,
  pagSjablonenOverzicht,
  pagSjabloonFormulier,
  pagBackups,
  pagOneDriveKoppelen,
  HERINNERING_TYPE_LABEL,
} from './pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const POORT = process.env.PORT || 3000;

// Tijdelijke, in-memory status van een lopende OneDrive-koppelpoging
// (device-code-flow). Er is maar één planner-omgeving, dus één globale
// variabele is voldoende — verdwijnt bij een herstart, dan moet de planner
// gewoon opnieuw op "Koppel OneDrive" klikken.
let oneDriveKoppelState = null;

const STATISCHE_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function leesBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let grootte = 0;
    const MAX = 1024 * 1024; // 1MB is ruim genoeg voor deze formulieren
    req.on('data', (chunk) => {
      grootte += chunk.length;
      if (grootte > MAX) {
        reject(new Error('Body te groot'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function leesFormulier(req) {
  const contentType = req.headers['content-type'] || '';
  const ruw = await leesBody(req);
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(ruw);
    const obj = Object.fromEntries(params);
    // Voor velden die meerdere waarden kunnen hebben (bijv. aangevinkte
    // checkboxes met dezelfde 'name'), gaat fromEntries verloren — bewaar
    // daarom ook de ruwe params zodat getAll() gebruikt kan worden.
    Object.defineProperty(obj, '_raw', { value: params, enumerable: false });
    return obj;
  }
  return {};
}

function alleWaarden(v, veld) {
  return v && v._raw ? v._raw.getAll(veld) : [];
}

async function leesJson(req) {
  const ruw = await leesBody(req);
  try {
    return JSON.parse(ruw || '{}');
  } catch {
    return {};
  }
}

function stuurJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function stuurHtml(res, statusCode, html, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(html);
}

function redirect(res, locatie, extraHeaders = {}) {
  res.writeHead(302, { Location: locatie, ...extraHeaders });
  res.end();
}


function serveerStatischBestand(req, res, pathname) {
  const veiligPad = path.normalize(pathname).replace(/^([./\\])+/, '');
  const volledigPad = path.join(PUBLIC_DIR, veiligPad);
  if (!volledigPad.startsWith(PUBLIC_DIR)) {
    stuurHtml(res, 403, 'Verboden');
    return true;
  }
  if (!fs.existsSync(volledigPad) || !fs.statSync(volledigPad).isFile()) {
    return false;
  }
  const ext = path.extname(volledigPad);
  const contentType = STATISCHE_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300' });
  fs.createReadStream(volledigPad).pipe(res);
  return true;
}

// ---- Data-helpers ----
function haalRitten({ datum } = {}) {
  const basisQuery = `
    SELECT r.*, k.naam AS klant_naam, v.kenteken AS kenteken, c.naam AS chauffeur_naam
    FROM ritten r
    LEFT JOIN klanten k ON k.id = r.klant_id
    LEFT JOIN voertuigen v ON v.id = r.voertuig_id
    LEFT JOIN gebruikers c ON c.id = r.chauffeur_id
  `;
  if (datum) {
    return db.prepare(`${basisQuery} WHERE r.datum = ? ORDER BY r.datum, r.aangemaakt_op`).all(datum);
  }
  return db.prepare(`${basisQuery} ORDER BY r.datum DESC, r.aangemaakt_op DESC LIMIT 200`).all();
}

function haalKlantenMetTariefAantal() {
  return db
    .prepare(
      `SELECT k.*, (SELECT COUNT(*) FROM tariefafspraken t WHERE t.klant_id = k.id) AS aantal_tarieven
       FROM klanten k ORDER BY k.naam`
    )
    .all();
}

function haalToltarieven({ alleenActief = false } = {}) {
  if (alleenActief) {
    return db.prepare('SELECT * FROM toltarieven WHERE actief = 1 ORDER BY omschrijving').all();
  }
  return db.prepare('SELECT * FROM toltarieven ORDER BY omschrijving').all();
}

function haalInstellingen() {
  return (
    db.prepare('SELECT * FROM instellingen WHERE id = 1').get() || {
      marge_percentage: 20,
      brandstof_per_km: 0,
      banden_per_km: 0,
      onderhoud_per_km: 0,
      afschrijving_per_km: 0,
      uurloon: 0,
      verzekering_per_maand: 0,
      wegenbelasting_per_maand: 0,
      overige_kosten_per_maand: 0,
      verwachte_uren_per_maand: 160,
    }
  );
}

// Werkelijke kostprijs per km: alles wat meeschaalt met hoeveel er gereden
// wordt (brandstof, bandenslijtage, onderhoud/reparatie, afschrijving).
function berekenKostprijsPerKm(instellingen = haalInstellingen()) {
  return (
    (instellingen.brandstof_per_km || 0) +
    (instellingen.banden_per_km || 0) +
    (instellingen.onderhoud_per_km || 0) +
    (instellingen.afschrijving_per_km || 0)
  );
}

// Werkelijke kostprijs per gewerkt uur: het eigen uurloon plus de vaste
// maandlasten (verzekering, wegenbelasting, overig), omgerekend naar een
// uurbedrag via het verwachte aantal werkuren per maand.
function berekenKostprijsPerUur(instellingen = haalInstellingen()) {
  const vasteMaandlasten =
    (instellingen.verzekering_per_maand || 0) + (instellingen.wegenbelasting_per_maand || 0) + (instellingen.overige_kosten_per_maand || 0);
  const verwachteUren = instellingen.verwachte_uren_per_maand || 0;
  const vasteLastenPerUur = verwachteUren > 0 ? vasteMaandlasten / verwachteUren : 0;
  return (instellingen.uurloon || 0) + vasteLastenPerUur;
}

function haalTolLandtarieven({ alleenActief = false } = {}) {
  if (alleenActief) {
    return db.prepare('SELECT * FROM tol_landtarieven WHERE actief = 1 ORDER BY land').all();
  }
  return db.prepare('SELECT * FROM tol_landtarieven ORDER BY land').all();
}

function haalTolTariefVoorLand(land) {
  return db.prepare('SELECT * FROM tol_landtarieven WHERE land = ? AND actief = 1').get(land);
}

// Slaat de handmatig ingevulde land/km-regels van een opdracht op (met het op
// dat moment geldende tarief als snapshot) en telt de totale tolkosten op de
// opdracht zelf op, zodat die meetelt in de kostenberekening.
function slaOpdrachtTolOp(opdrachtId, landKmRegels) {
  let totaal = 0;
  for (const { land, km } of landKmRegels) {
    if (!land || !km || km <= 0) continue;
    const tarief = haalTolTariefVoorLand(land);
    const centPerKm = tarief ? tarief.cent_per_km : 0;
    const bedrag = Math.round(((km * centPerKm) / 100) * 100) / 100;
    totaal += bedrag;
    db.prepare(
      'INSERT INTO opdracht_tol_km (id, opdracht_id, land, km, cent_per_km, bedrag) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(nieuweId(), opdrachtId, land, km, centPerKm, bedrag);
  }
  if (totaal > 0) {
    db.prepare('UPDATE opdrachten SET tolkosten = tolkosten + ? WHERE id = ?').run(Math.round(totaal * 100) / 100, opdrachtId);
  }
}

function haalGeselecteerdeTolIds(ritId) {
  if (!ritId) return [];
  return db
    .prepare('SELECT tol_id FROM rit_tol WHERE rit_id = ?')
    .all(ritId)
    .map((r) => r.tol_id)
    .filter(Boolean);
}

// Slaat op welke toltarieven bij een rit horen (met bedrag-snapshot) en geeft
// de som van de tolkosten terug.
function verwerkTolSelectie(ritId, tolIds) {
  db.prepare('DELETE FROM rit_tol WHERE rit_id = ?').run(ritId);
  let totaal = 0;
  for (const tolId of tolIds) {
    const tol = db.prepare('SELECT * FROM toltarieven WHERE id = ?').get(tolId);
    if (!tol) continue;
    db.prepare('INSERT INTO rit_tol (id, rit_id, tol_id, omschrijving, bedrag) VALUES (?, ?, ?, ?, ?)').run(
      nieuweId(),
      ritId,
      tol.id,
      tol.omschrijving,
      tol.bedrag
    );
    totaal += tol.bedrag;
  }
  return Math.round(totaal * 100) / 100;
}

function berekenKostprijs({ afstandKm, voertuigId, tolkosten }) {
  const voertuig = voertuigId ? db.prepare('SELECT * FROM voertuigen WHERE id = ?').get(voertuigId) : null;
  const kostprijsPerKm = voertuig ? voertuig.kostprijs_per_km : 0;
  const afstand = Number(afstandKm) || 0;
  const kostprijs = afstand * kostprijsPerKm + (Number(tolkosten) || 0);
  return Math.round(kostprijs * 100) / 100;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ---- Prijscalculator: complete offerte-berekening los van een geplande rit.
// Houdt rekening met verplichte EU-rusttijden (45 min pauze per 4,5u rijden,
// max. 9u rijden per dag), tol, ADR, koeltransport, wachttijd en
// chauffeursvergoeding/overnachting. Geen vignetten (bewust weggelaten).
function berekenPrijsOfferte(v) {
  const afstand = Number(v.afstand_km) || 0;
  const leegKm = Number(v.leeg_km) || 0;
  const totaalKm = afstand + leegKm;
  const kostprijsPerKm = Number(v.kostprijs_per_km) || 0;
  const basisKosten = totaalKm * kostprijsPerKm;

  const tolIds = alleWaarden(v, 'tol_ids');
  let tolkosten = 0;
  const tolOmschrijvingen = [];
  for (const tolId of tolIds) {
    const tol = db.prepare('SELECT * FROM toltarieven WHERE id = ?').get(tolId);
    if (!tol) continue;
    tolkosten += tol.bedrag;
    tolOmschrijvingen.push(tol.omschrijving);
  }

  const adr = v.adr === '1' || v.adr === 'on';
  const adrPercentage = Number(v.adr_percentage) || 0;
  const adrToeslag = adr ? round2(basisKosten * (adrPercentage / 100)) : 0;

  const koel = v.koeltransport === '1' || v.koeltransport === 'on';
  const koelPercentage = Number(v.koel_percentage) || 0;
  const koelToeslag = koel ? round2(basisKosten * (koelPercentage / 100)) : 0;

  const wachttijdUren = Number(v.wachttijd_uren) || 0;
  const wachttijdTarief = Number(v.wachttijd_tarief) || 0;
  const wachttijdToeslag = round2(wachttijdUren * wachttijdTarief);

  const gemiddeldeSnelheid = Number(v.gemiddelde_snelheid) || 70;
  const rijtijdUren = gemiddeldeSnelheid > 0 ? totaalKm / gemiddeldeSnelheid : 0;
  const aantalPauzes = Math.floor(rijtijdUren / 4.5);
  const rijdagen = Math.max(1, Math.ceil(rijtijdUren / 9));
  const geschatteOvernachtingen = Math.max(0, rijdagen - 1);

  const aantalOvernachtingen =
    v.aantal_overnachtingen !== undefined && v.aantal_overnachtingen !== '' ? Number(v.aantal_overnachtingen) : geschatteOvernachtingen;
  const vergoedingPerOvernachting = Number(v.vergoeding_per_overnachting) || 0;
  const overnachtingToeslag = round2(aantalOvernachtingen * vergoedingPerOvernachting);

  const totaleKostprijs = round2(basisKosten + tolkosten + adrToeslag + koelToeslag + wachttijdToeslag + overnachtingToeslag);
  const margePercentage = Number(v.marge_percentage) || 0;
  const voorgesteldeKlantprijs = round2(totaleKostprijs * (1 + margePercentage / 100));

  const geschatteReisduurUren = Math.round((rijtijdUren + aantalPauzes * 0.75 + geschatteOvernachtingen * 11) * 10) / 10;

  return {
    totaalKm: round2(totaalKm),
    basisKosten: round2(basisKosten),
    tolkosten: round2(tolkosten),
    tolOmschrijvingen,
    adr,
    adrPercentage,
    adrToeslag,
    koel,
    koelPercentage,
    koelToeslag,
    wachttijdUren,
    wachttijdTarief,
    wachttijdToeslag,
    gemiddeldeSnelheid,
    rijtijdUren: round2(rijtijdUren),
    aantalPauzes,
    rijdagen,
    aantalOvernachtingen,
    vergoedingPerOvernachting,
    overnachtingToeslag,
    geschatteReisduurUren,
    totaleKostprijs,
    margePercentage,
    voorgesteldeKlantprijs,
  };
}

// Slaat de route/prijsvelden van een rit op (afstand, tol-selectie, berekende
// kostprijs en klantprijs). Wordt na het aanmaken/bewerken van een rit aangeroepen.
function slaRitPrijsOp(ritId, v) {
  const afstandKm = v.afstand_km !== undefined && v.afstand_km !== '' ? Number(v.afstand_km) : null;
  const klantprijs = v.klantprijs !== undefined && v.klantprijs !== '' ? Number(v.klantprijs) : null;
  const tolIds = alleWaarden(v, 'tol_ids');
  const tolkosten = verwerkTolSelectie(ritId, tolIds);
  const voertuigId = v.voertuig_id || null;
  const kostprijs = berekenKostprijs({ afstandKm, voertuigId, tolkosten });
  db.prepare('UPDATE ritten SET afstand_km = ?, tolkosten = ?, kostprijs = ?, klantprijs = ? WHERE id = ?').run(
    afstandKm,
    tolkosten,
    kostprijs,
    klantprijs,
    ritId
  );
}

function haalRittenVoorChauffeur(chauffeurId) {
  return db
    .prepare(
      `SELECT r.*, k.naam AS klant_naam, v.kenteken AS kenteken
       FROM ritten r
       LEFT JOIN klanten k ON k.id = r.klant_id
       LEFT JOIN voertuigen v ON v.id = r.voertuig_id
       WHERE r.chauffeur_id = ? AND r.status IN ('gepland', 'onderweg')
       ORDER BY r.datum, r.aangemaakt_op`
    )
    .all(chauffeurId);
}

// ---- Dagregistratie (werkdagen/dagregels) & taakafhandeling voor chauffeurs ----
function vandaagIso() {
  return huidigeDatum();
}

function haalWerkdagVanVandaag(chauffeurId) {
  return db
    .prepare('SELECT * FROM werkdagen WHERE chauffeur_id = ? AND datum = ? ORDER BY aangemaakt_op DESC LIMIT 1')
    .get(chauffeurId, vandaagIso());
}

// Laatst bekende plaats van de chauffeur: de eindplaats van zijn laatst
// afgesloten opdracht - gebruikt om het beginplaats-veld bij "Nieuwe dag
// beginnen" alvast in te vullen (blijft altijd aanpasbaar).
function haalLaatsteEindplaats(chauffeurId) {
  const rij = db
    .prepare(
      `SELECT o.eind_plaats FROM opdrachten o
       JOIN werkdagen w ON w.id = o.werkdag_id
       WHERE w.chauffeur_id = ? AND o.eind_plaats IS NOT NULL AND o.eind_plaats != ''
       ORDER BY w.datum DESC, o.aangemaakt_op DESC LIMIT 1`
    )
    .get(chauffeurId);
  return rij ? rij.eind_plaats : null;
}

function haalWerkdagMetKlant(werkdagId) {
  return db
    .prepare(
      `SELECT w.*, k.naam AS klant_naam, t.naam AS tarief_naam
       FROM werkdagen w
       LEFT JOIN klanten k ON k.id = w.klant_id
       LEFT JOIN tariefafspraken t ON t.id = w.tariefafspraak_id
       WHERE w.id = ?`
    )
    .get(werkdagId);
}

// ---- Opdrachten: een werkdag kan uit meerdere opdrachtgever-segmenten
// bestaan (bijv. 's ochtends klant A, 's middags klant B). Elke opdracht
// heeft zijn eigen begin/eind (tijd, plaats, km) en eigen stops. ----
function haalOpdrachten(werkdagId) {
  return db
    .prepare(
      `SELECT o.*, k.naam AS klant_naam, t.naam AS tarief_naam
       FROM opdrachten o
       LEFT JOIN klanten k ON k.id = o.klant_id
       LEFT JOIN tariefafspraken t ON t.id = o.tariefafspraak_id
       WHERE o.werkdag_id = ?
       ORDER BY o.volgorde, o.aangemaakt_op`
    )
    .all(werkdagId);
}

// De momenteel "lopende" opdracht van een werkdag (nog niet afgesloten) -
// tijdens een live dag kan er hooguit één tegelijk open staan.
function haalOpenOpdracht(werkdagId) {
  return db
    .prepare(`SELECT * FROM opdrachten WHERE werkdag_id = ? AND status = 'bezig' ORDER BY aangemaakt_op DESC LIMIT 1`)
    .get(werkdagId);
}

function haalDagregelsVoorOpdracht(opdrachtId) {
  return db.prepare('SELECT * FROM dagregels WHERE opdracht_id = ? ORDER BY volgorde, aangemaakt_op').all(opdrachtId);
}

function haalOpenDagregel(opdrachtId) {
  return db
    .prepare('SELECT * FROM dagregels WHERE opdracht_id = ? AND tijd_vertrek IS NULL ORDER BY aangemaakt_op DESC LIMIT 1')
    .get(opdrachtId);
}

// Alle opdrachten van een werkdag, elk met hun eigen stops en totalen erbij
// (gebruikt voor weergave: live blok, dag-detail, correctieformulier).
function haalOpdrachtenMetDetails(werkdagId) {
  return haalOpdrachten(werkdagId).map((o) => {
    const dagregels = haalDagregelsVoorOpdracht(o.id);
    return { ...o, dagregels, totalen: berekenOpdrachtTotalen(o, dagregels) };
  });
}

// Een stop telt als pauze als de vrij ingevulde activiteit dat woord bevat
// (hoofdletterongevoelig) - zo blijft de urenberekening werken nu activiteit
// een vrij tekstveld is in plaats van een apart aan-/uit-vinkje.
function isPauzeActiviteit(activiteit) {
  return (activiteit || '').trim().toLowerCase() === 'pauze';
}

// Totalen voor één opdracht: kilometers, totale diensttijd (start- tot
// eindtijd, of tot nu als de opdracht nog bezig is) en netto gewerkte tijd
// (diensttijd min alle stops met activiteit "pauze").
function berekenOpdrachtTotalen(opdracht, dagregels) {
  const kmTotaal =
    opdracht && opdracht.start_km != null && opdracht.eind_km != null ? Math.max(0, opdracht.eind_km - opdracht.start_km) : null;
  const diensttijdMinuten =
    opdracht && opdracht.start_tijd ? minutenTussen(opdracht.start_tijd, opdracht.eind_tijd || huidigeTijd()) : 0;
  let pauzeMinuten = 0;
  for (const d of dagregels) {
    if (isPauzeActiviteit(d.activiteit) && d.tijd_aankomst) {
      pauzeMinuten += minutenTussen(d.tijd_aankomst, d.tijd_vertrek || huidigeTijd());
    }
  }
  const nettoMinuten = Math.max(0, diensttijdMinuten - pauzeMinuten);
  return { kmTotaal, diensttijdMinuten, nettoMinuten, pauzeMinuten };
}

// Totalen voor een hele werkdag: som van alle opdrachten van die dag, plus
// (indien bijgehouden) het brandstofverbruik in km/liter.
function berekenWerkdagTotalen(werkdag, opdrachten) {
  let kmTotaal = null;
  let diensttijdMinuten = 0;
  let nettoMinuten = 0;
  let pauzeMinuten = 0;
  for (const o of opdrachten || []) {
    const t = o.totalen || berekenOpdrachtTotalen(o, o.dagregels || []);
    if (t.kmTotaal != null) kmTotaal = (kmTotaal || 0) + t.kmTotaal;
    diensttijdMinuten += t.diensttijdMinuten;
    nettoMinuten += t.nettoMinuten;
    pauzeMinuten += t.pauzeMinuten;
  }
  const literPerKm =
    werkdag && werkdag.liters_verbruikt && kmTotaal != null && kmTotaal > 0
      ? Math.round((kmTotaal / werkdag.liters_verbruikt) * 100) / 100
      : null;
  return { kmTotaal, diensttijdMinuten, nettoMinuten, pauzeMinuten, literPerKm };
}

// Werkdagen-historie (voor correcties): alle dagen tot `dagenTerug` dagen
// geleden, exclusief vandaag (dat heeft zijn eigen live blok).
function haalWerkdagenHistorie(chauffeurId, dagenTerug) {
  const vandaag = vandaagIso();
  const drempel = addDagen(vandaag, -dagenTerug);
  const werkdagen = db
    .prepare(
      `SELECT w.*, k.naam AS klant_naam FROM werkdagen w LEFT JOIN klanten k ON k.id = w.klant_id
       WHERE w.chauffeur_id = ? AND w.datum < ? AND w.datum >= ? ORDER BY w.datum DESC, w.aangemaakt_op DESC`
    )
    .all(chauffeurId, vandaag, drempel);
  return werkdagen.map((w) => {
    const opdrachten = haalOpdrachtenMetDetails(w.id);
    const klantNamen = [...new Set(opdrachten.map((o) => o.klant_naam).filter(Boolean))];
    return { werkdag: { ...w, klant_naam: klantNamen.join(', ') || w.klant_naam }, ...berekenWerkdagTotalen(w, opdrachten) };
  });
}

// ---- Gedeelde mutatie-helpers voor werkdagen/dagregels, gebruikt door zowel
// de chauffeur- als de planner-routes (correcties: "iedereen mag alles
// aanpassen"). ----
function haalWerkdagVoorBewerken(werkdagId, chauffeurIdBeperking) {
  const werkdag = haalWerkdagMetKlant(werkdagId);
  if (!werkdag) return null;
  if (chauffeurIdBeperking && werkdag.chauffeur_id !== chauffeurIdBeperking) return null;
  return werkdag;
}

function haalDagregelVoorBewerken(regelId, chauffeurIdBeperking) {
  const regel = db
    .prepare(
      `SELECT d.*, w.chauffeur_id AS werkdag_chauffeur_id
       FROM dagregels d JOIN werkdagen w ON w.id = d.werkdag_id WHERE d.id = ?`
    )
    .get(regelId);
  if (!regel) return null;
  if (chauffeurIdBeperking && regel.werkdag_chauffeur_id !== chauffeurIdBeperking) return null;
  return regel;
}

function maakDagregelAan(opdrachtId, werkdagId, { plaats, activiteit, tijd_aankomst, tijd_vertrek, km_stand }) {
  const maxVolgorde = db.prepare('SELECT COALESCE(MAX(volgorde), 0) AS m FROM dagregels WHERE opdracht_id = ?').get(opdrachtId).m;
  const id = nieuweId();
  db.prepare(
    'INSERT INTO dagregels (id, werkdag_id, opdracht_id, volgorde, plaats, activiteit, tijd_aankomst, tijd_vertrek, km_stand) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    werkdagId,
    opdrachtId,
    maxVolgorde + 1,
    (plaats || '').trim() || null,
    (activiteit || '').trim() || null,
    tijd_aankomst || huidigeTijd(),
    (tijd_vertrek || '').trim() || null,
    km_stand != null && km_stand !== '' ? Number(km_stand) : null
  );
  return id;
}

// Werkt een bestaande stop bij (gebruikt zowel door het onderweg-corrigeren
// van een losse stop als, indirect, door de Vertrek-knop hieronder).
function werkDagregelBij(id, { plaats, activiteit, tijd_aankomst, tijd_vertrek, km_stand }) {
  db.prepare(
    'UPDATE dagregels SET plaats = ?, activiteit = ?, tijd_aankomst = ?, tijd_vertrek = ?, km_stand = ? WHERE id = ?'
  ).run(
    (plaats || '').trim() || null,
    (activiteit || '').trim() || null,
    (tijd_aankomst || '').trim() || null,
    (tijd_vertrek || '').trim() || null,
    km_stand != null && km_stand !== '' ? Number(km_stand) : null,
    id
  );
}

// Maakt een nieuwe opdracht (opdrachtgever-segment) aan binnen een werkdag -
// gebruikt bij "Dag beginnen" (de eerste opdracht) en "+ Opdracht toevoegen".
// Als er geen tariefafspraak is meegegeven (chauffeurs kiezen die zelf niet -
// dat doet alleen de planner) maar de opdrachtgever wél precies één actieve
// tariefafspraak heeft, wordt die automatisch gekoppeld. Zonder dit bleef
// tariefafspraak_id altijd leeg voor door chauffeurs aangemaakte opdrachten,
// waardoor er nooit een bedrag ("te factureren") kon worden berekend, ook al
// waren de uren/km wel correct geregistreerd. Heeft een klant meerdere
// tariefafspraken, dan blijft het aan de planner om de juiste te kiezen (zie
// het aandachtspunt hiervoor op het dashboard).
function bepaalAutomatischeTariefafspraak(klantId) {
  if (!klantId) return null;
  const afspraken = db.prepare('SELECT id FROM tariefafspraken WHERE klant_id = ? AND actief = 1').all(klantId);
  return afspraken.length === 1 ? afspraken[0].id : null;
}

function maakOpdrachtAan(werkdagId, { klant_id, route_id, tariefafspraak_id, start_km, start_plaats }) {
  const maxVolgorde = db.prepare('SELECT COALESCE(MAX(volgorde), 0) AS m FROM opdrachten WHERE werkdag_id = ?').get(werkdagId).m;
  const id = nieuweId();
  const gekozenTariefafspraakId = tariefafspraak_id || bepaalAutomatischeTariefafspraak(klant_id);
  db.prepare(
    `INSERT INTO opdrachten (id, werkdag_id, volgorde, klant_id, route_id, tariefafspraak_id, start_tijd, start_plaats, start_km, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'bezig')`
  ).run(
    id,
    werkdagId,
    maxVolgorde + 1,
    klant_id || null,
    route_id || null,
    gekozenTariefafspraakId || null,
    huidigeTijd(),
    (start_plaats || '').trim() || null,
    start_km != null && start_km !== '' ? Number(start_km) : null
  );
  return id;
}

// ---- "Dag toevoegen"/correctie: het hele dagformulier (per opdracht een
// begin/eind + alle stops) wordt in één keer opgeslagen, in plaats van losse
// verzoekjes per stop - zie de uitleg bij volledigeDagFormHtml. ----
function verzamelStopsUitFormulier(v) {
  const plaatsen = alleWaarden(v, 'stop_plaats');
  const activiteiten = alleWaarden(v, 'stop_activiteit');
  const aankomsten = alleWaarden(v, 'stop_aankomst');
  const vertrekken = alleWaarden(v, 'stop_vertrek');
  const kms = alleWaarden(v, 'stop_km');
  const opdrachtIndexen = alleWaarden(v, 'stop_opdracht_index');
  const aantal = Math.max(plaatsen.length, activiteiten.length, aankomsten.length, vertrekken.length, kms.length);
  const stops = [];
  for (let i = 0; i < aantal; i++) {
    const plaats = (plaatsen[i] || '').trim();
    const activiteit = (activiteiten[i] || '').trim();
    const aankomst = (aankomsten[i] || '').trim();
    const vertrek = (vertrekken[i] || '').trim();
    const km = (kms[i] || '').trim();
    if (!plaats && !activiteit && !aankomst && !vertrek && !km) continue; // lege rij overslaan
    stops.push({
      opdrachtIndex: Number(opdrachtIndexen[i] || 0) || 0,
      plaats: plaats || null,
      activiteit: activiteit || null,
      tijd_aankomst: aankomst || null,
      tijd_vertrek: vertrek || null,
      km_stand: km !== '' ? Number(km) : null,
    });
  }
  return stops;
}

// Verzamelt alle opdracht-blokken (elk met zijn eigen stops) uit het platte
// correctieformulier: elk opdracht_*-veld is een array (één waarde per
// opdracht-blok, in volgorde), en elke stop draagt via het verborgen veld
// stop_opdracht_index het (0-gebaseerde) blok waar hij bij hoort.
function verzamelOpdrachtenUitFormulier(v, { magTarief }) {
  const ids = alleWaarden(v, 'opdracht_id');
  const klantIds = alleWaarden(v, 'opdracht_klant_id');
  const tariefIds = alleWaarden(v, 'opdracht_tariefafspraak_id');
  const startTijden = alleWaarden(v, 'opdracht_start_tijd');
  const startPlaatsen = alleWaarden(v, 'opdracht_start_plaats');
  const startKms = alleWaarden(v, 'opdracht_start_km');
  const eindTijden = alleWaarden(v, 'opdracht_eind_tijd');
  const eindPlaatsen = alleWaarden(v, 'opdracht_eind_plaats');
  const eindKms = alleWaarden(v, 'opdracht_eind_km');
  const alleStops = verzamelStopsUitFormulier(v);

  const opdrachten = [];
  for (let i = 0; i < klantIds.length; i++) {
    opdrachten.push({
      id: ids[i] || null,
      klant_id: klantIds[i] || null,
      tariefafspraak_id: magTarief ? tariefIds[i] || null : null,
      start_tijd: startTijden[i] || null,
      start_plaats: (startPlaatsen[i] || '').trim() || null,
      start_km: startKms[i] !== undefined && startKms[i] !== '' ? Number(startKms[i]) : null,
      eind_tijd: eindTijden[i] || null,
      eind_plaats: (eindPlaatsen[i] || '').trim() || null,
      eind_km: eindKms[i] !== undefined && eindKms[i] !== '' ? Number(eindKms[i]) : null,
      stops: alleStops.filter((s) => s.opdrachtIndex === i),
    });
  }
  return opdrachten;
}

function vervangDagregelsVoorOpdracht(opdrachtId, werkdagId, stops) {
  db.prepare('DELETE FROM dagregels WHERE opdracht_id = ?').run(opdrachtId);
  stops.forEach((s, i) => {
    db.prepare(
      `INSERT INTO dagregels (id, werkdag_id, opdracht_id, volgorde, plaats, activiteit, tijd_aankomst, tijd_vertrek, km_stand)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nieuweId(), werkdagId, opdrachtId, i + 1, s.plaats, s.activiteit, s.tijd_aankomst, s.tijd_vertrek, s.km_stand);
  });
}

// Slaat alle opdracht-blokken van een werkdag in één keer op: bestaande
// opdrachten (herkend aan hun meegestuurde id) worden bijgewerkt, nieuwe
// blokken worden aangemaakt, en opdrachten die niet meer in het formulier
// voorkomen worden verwijderd (incl. hun stops). Bij het bijwerken van een
// bestaande opdracht door een chauffeur (magTarief: false) wordt de kolom
// tariefafspraak_id helemaal niet aangeraakt, zodat een door de planner
// gekozen tariefafspraak niet per ongeluk wordt gewist.
function vervangOpdrachten(werkdagId, opdrachten, { magTarief }) {
  const bestaandeIds = db.prepare('SELECT id FROM opdrachten WHERE werkdag_id = ?').all(werkdagId).map((r) => r.id);
  const behoudenIds = new Set();

  opdrachten.forEach((o, i) => {
    let opdrachtId = o.id && bestaandeIds.includes(o.id) ? o.id : null;
    if (opdrachtId) {
      behoudenIds.add(opdrachtId);
      db.prepare(
        `UPDATE opdrachten SET volgorde = ?, klant_id = ?, start_tijd = ?, start_plaats = ?, start_km = ?, eind_tijd = ?, eind_plaats = ?, eind_km = ?${
          magTarief ? ', tariefafspraak_id = ?' : ''
        } WHERE id = ?`
      ).run(
        ...[
          i + 1,
          o.klant_id,
          o.start_tijd,
          o.start_plaats,
          o.start_km,
          o.eind_tijd,
          o.eind_plaats,
          o.eind_km,
          ...(magTarief ? [o.tariefafspraak_id] : []),
          opdrachtId,
        ]
      );
    } else {
      opdrachtId = nieuweId();
      behoudenIds.add(opdrachtId);
      const status = o.eind_tijd || o.eind_km != null ? 'afgerond' : 'bezig';
      db.prepare(
        `INSERT INTO opdrachten (id, werkdag_id, volgorde, klant_id, tariefafspraak_id, start_tijd, start_plaats, start_km, eind_tijd, eind_plaats, eind_km, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        opdrachtId,
        werkdagId,
        i + 1,
        o.klant_id,
        magTarief ? o.tariefafspraak_id : null,
        o.start_tijd,
        o.start_plaats,
        o.start_km,
        o.eind_tijd,
        o.eind_plaats,
        o.eind_km,
        status
      );
    }
    vervangDagregelsVoorOpdracht(opdrachtId, werkdagId, o.stops);
  });

  for (const id of bestaandeIds) {
    if (!behoudenIds.has(id)) db.prepare('DELETE FROM opdrachten WHERE id = ?').run(id);
  }
}

// Werkt een bestaande dag (alle opdracht-blokken + hun stops) in één keer bij.
function slaVolledigeDagOp(werkdagId, v, { magTarief }) {
  vervangOpdrachten(werkdagId, verzamelOpdrachtenUitFormulier(v, { magTarief }), { magTarief });
  if (v.liters_verbruikt !== undefined) {
    db.prepare('UPDATE werkdagen SET liters_verbruikt = ? WHERE id = ?').run(
      v.liters_verbruikt !== '' ? Number(v.liters_verbruikt) : null,
      werkdagId
    );
  }
  if (v.ritnummer !== undefined || v.opmerkingen !== undefined) {
    db.prepare('UPDATE werkdagen SET ritnummer = ?, opmerkingen = ? WHERE id = ?').run(
      (v.ritnummer || '').trim() || null,
      (v.opmerkingen || '').trim() || null,
      werkdagId
    );
  }
}

// Maakt een complete, al voorbije dag in één keer aan ("Dag toevoegen").
function maakWerkdagCompleetAan(chauffeurId, v, { magTarief }) {
  const id = nieuweId();
  db.prepare(
    `INSERT INTO werkdagen (id, chauffeur_id, datum, liters_verbruikt, ritnummer, opmerkingen, status) VALUES (?, ?, ?, ?, ?, ?, 'afgerond')`
  ).run(
    id,
    chauffeurId,
    v.datum,
    v.liters_verbruikt !== undefined && v.liters_verbruikt !== '' ? Number(v.liters_verbruikt) : null,
    (v.ritnummer || '').trim() || null,
    (v.opmerkingen || '').trim() || null
  );
  vervangOpdrachten(id, verzamelOpdrachtenUitFormulier(v, { magTarief }), { magTarief });
  return id;
}

// ---- In-app meldingen: nieuwe of gewijzigde routes. Naast de in-app rij
// gaat er, als push is ingesteld, ook direct een pushmelding uit. ----
// ---- Chauffeur-beginscherm: speelse begroetingen (Betuws) per dagdeel/situatie ----
function formatMinutenKort(minuten) {
  const m = Math.max(0, Math.round(minuten || 0));
  const uren = Math.floor(m / 60);
  const rest = m % 60;
  return `${uren}u ${String(rest).padStart(2, '0')}min`;
}

function begroetingStart(naam, uur, isMaandag) {
  if (isMaandag && uur >= 4 && uur < 11) return `Nije week, ${naam} — gas d'rop!`;
  if (uur < 5) return `Mogguh, voor jou een speciekuip koffie ${naam}!`;
  if (uur < 7) return `Mogguh ${naam}, mooi op tijd keerl!`;
  if (uur < 11) return `Zo kan die wel weer ff eh?! Hup, gas der op ${naam}!`;
  if (uur < 14) return `Zoooo....wakker, ${naam}??`;
  if (uur < 18) return `Middag ${naam}, rommel de dag maar ff vol!`;
  return `Moet jij niet naar bed, ${naam}??!...`;
}

function begroetingEind(naam, gewerkteMinuten, isVrijdag) {
  const uren = gewerkteMinuten / 60;
  if (uren >= 12) return `Lekker gewerkt keerl, ${naam}!`;
  if (isVrijdag) return `Zo ${naam}, week d'r op — geniet van je weekend!`;
  return `Best gelopen, nou gouw naar mama toe ${naam}!`;
}

function formatDatumKort(iso) {
  if (!iso) return '';
  const [j, m, d] = iso.split('-');
  return `${d}-${m}-${j}`;
}

function meldChauffeur(chauffeurId, tekst, routeId = null) {
  if (!chauffeurId) return;
  const meldingId = nieuweId();
  db.prepare('INSERT INTO meldingen (id, gebruiker_id, route_id, tekst) VALUES (?, ?, ?, ?)').run(meldingId, chauffeurId, routeId, tekst);
  stuurPushNaarGebruiker(chauffeurId, {
    titel: branding.bedrijfsnaam,
    tekst,
    url: '/chauffeur/ritopdrachten',
    meldingId,
  }).catch(() => {});
}

function haalTaakVoorChauffeur(taakId, chauffeurId) {
  return db
    .prepare(
      `SELECT t.*, r.datum AS route_datum, r.chauffeur_id, r.klant_id, k.naam AS klant_naam, k.email AS klant_email
       FROM taken t
       JOIN routes r ON r.id = t.route_id
       LEFT JOIN klanten k ON k.id = r.klant_id
       WHERE t.id = ? AND r.chauffeur_id = ?`
    )
    .get(taakId, chauffeurId);
}

// ---- Week-uitdraai: factureerbaar bedrag per opdrachtgever, gebaseerd op
// afgeronde werkdagen en de daarbij gekozen tariefafspraak. ----
function huidigeWeekBereik() {
  return weekBereikVanDatum(vandaagIso());
}

function haalWeekUitdraai({ van, tot, alleenNietGefactureerd = false } = {}) {
  let query = `
    SELECT o.*, w.datum AS datum, w.chauffeur_id AS chauffeur_id, g.naam AS chauffeur_naam,
            k.naam AS klant_naam, t.naam AS tarief_naam, t.type AS tarief_type,
            t.tarief_vast, t.tarief_per_uur, t.tarief_per_km, t.tarief_per_pallet
     FROM opdrachten o
     JOIN werkdagen w ON w.id = o.werkdag_id
     LEFT JOIN gebruikers g ON g.id = w.chauffeur_id
     LEFT JOIN klanten k ON k.id = o.klant_id
     LEFT JOIN tariefafspraken t ON t.id = o.tariefafspraak_id
     WHERE o.status = 'afgerond'
  `;
  const params = [];
  if (van && tot) {
    query += ' AND w.datum BETWEEN ? AND ?';
    params.push(van, tot);
  }
  if (alleenNietGefactureerd) {
    query += ' AND o.gefactureerd = 0';
  }
  query += ' ORDER BY w.datum';
  const opdrachten = db.prepare(query).all(...params);

  const groepen = new Map();
  for (const o of opdrachten) {
    const totalenOpdracht = berekenOpdrachtTotalen(o, haalDagregelsVoorOpdracht(o.id));
    const minuten = totalenOpdracht.nettoMinuten;
    const km = totalenOpdracht.kmTotaal != null ? totalenOpdracht.kmTotaal : 0;
    let pallets = 0;
    let colli = 0;
    if (o.route_id) {
      const som = db
        .prepare('SELECT COALESCE(SUM(aantal_pallets), 0) AS p, COALESCE(SUM(aantal_colli), 0) AS c FROM taken WHERE route_id = ?')
        .get(o.route_id);
      pallets = som.p;
      colli = som.c;
    }
    const key = `${o.klant_id || 'geen'}|${o.tariefafspraak_id || 'geen'}`;
    if (!groepen.has(key)) {
      groepen.set(key, {
        klant_id: o.klant_id,
        klant_naam: o.klant_naam || 'Onbekende opdrachtgever',
        tarief_naam: o.tarief_naam,
        tarief_type: o.tarief_type,
        tarief_vast: o.tarief_vast,
        tarief_per_uur: o.tarief_per_uur,
        tarief_per_km: o.tarief_per_km,
        tarief_per_pallet: o.tarief_per_pallet,
        aantalWerkdagen: 0,
        aantalGefactureerd: 0,
        totaalMinuten: 0,
        totaalKm: 0,
        totaalPallets: 0,
        totaalColli: 0,
        details: [],
      });
    }
    const g = groepen.get(key);
    g.aantalWerkdagen += 1;
    if (o.gefactureerd) g.aantalGefactureerd += 1;
    g.totaalMinuten += minuten;
    g.totaalKm += km;
    g.totaalPallets += pallets;
    g.totaalColli += colli;
    g.details.push({ datum: o.datum, chauffeur_naam: o.chauffeur_naam || 'Onbekend', uren: minuten / 60, km });
  }

  const groepenArray = Array.from(groepen.values()).map((g) => {
    const uren = g.totaalMinuten / 60;
    let bedrag = 0;
    if (g.tarief_type === 'vast_per_rit') bedrag = g.aantalWerkdagen * (g.tarief_vast || 0);
    else if (g.tarief_type === 'per_uur') bedrag = uren * (g.tarief_per_uur || 0);
    else if (g.tarief_type === 'per_km') bedrag = g.totaalKm * (g.tarief_per_km || 0);
    else if (g.tarief_type === 'per_uur_en_km') bedrag = uren * (g.tarief_per_uur || 0) + g.totaalKm * (g.tarief_per_km || 0);
    else if (g.tarief_type === 'per_pallet') bedrag = (g.totaalPallets || g.totaalColli) * (g.tarief_per_pallet || 0);
    return { ...g, uren, bedrag: Math.round(bedrag * 100) / 100 };
  });

  const perKlant = new Map();
  for (const g of groepenArray) {
    const sleutel = g.klant_id || 'geen';
    if (!perKlant.has(sleutel)) {
      perKlant.set(sleutel, {
        klant_id: g.klant_id,
        klant_naam: g.klant_naam,
        uren: 0,
        km: 0,
        pallets: 0,
        colli: 0,
        bedrag: 0,
        aantalWerkdagen: 0,
        aantalGefactureerd: 0,
        afspraken: [],
      });
    }
    const p = perKlant.get(sleutel);
    p.uren += g.uren;
    p.km += g.totaalKm;
    p.pallets += g.totaalPallets;
    p.colli += g.totaalColli;
    p.bedrag += g.bedrag;
    p.aantalWerkdagen += g.aantalWerkdagen;
    p.aantalGefactureerd += g.aantalGefactureerd;
    p.afspraken.push(g);
  }

  // Nacalculatie: werkelijke kostprijs (uren x kostprijs/uur + km x kostprijs/km)
  // per opdrachtgever, zodat direct zichtbaar is wat een klant echt oplevert.
  const instellingen = haalInstellingen();
  const kostprijsPerUur = berekenKostprijsPerUur(instellingen);
  const kostprijsPerKm = berekenKostprijsPerKm(instellingen);

  return Array.from(perKlant.values())
    .map((p) => {
      const kosten = round2(p.uren * kostprijsPerUur + p.km * kostprijsPerKm);
      return { ...p, bedrag: round2(p.bedrag), kosten, winst: round2(p.bedrag - kosten) };
    })
    .sort((a, b) => a.klant_naam.localeCompare(b.klant_naam));
}

// Zelfde brondata als haalWeekUitdraai, maar gegroepeerd per datum in plaats
// van per opdrachtgever/tariefafspraak - voor het "Per dag"-kaartjesoverzicht
// (operationeel: wie heeft wat gedaan, los van de facturatietabel).
function haalOpdrachtenPerDag({ van, tot }) {
  const opdrachten = db
    .prepare(
      `SELECT o.*, w.datum AS datum, g.naam AS chauffeur_naam, k.naam AS klant_naam
       FROM opdrachten o
       JOIN werkdagen w ON w.id = o.werkdag_id
       LEFT JOIN gebruikers g ON g.id = w.chauffeur_id
       LEFT JOIN klanten k ON k.id = o.klant_id
       WHERE o.status = 'afgerond' AND w.datum BETWEEN ? AND ?
       ORDER BY w.datum, o.aangemaakt_op`
    )
    .all(van, tot);

  const perDag = new Map();
  for (const o of opdrachten) {
    const totalen = berekenOpdrachtTotalen(o, haalDagregelsVoorOpdracht(o.id));
    if (!perDag.has(o.datum)) perDag.set(o.datum, []);
    perDag.get(o.datum).push({
      klant_naam: o.klant_naam || 'Onbekende opdrachtgever',
      chauffeur_naam: o.chauffeur_naam || 'Onbekend',
      uren: totalen.nettoMinuten / 60,
      km: totalen.kmTotaal,
    });
  }
  return Array.from(perDag.entries())
    .map(([datum, opdrachten]) => ({ datum, opdrachten }))
    .sort((a, b) => a.datum.localeCompare(b.datum));
}

// ---- Dagstaat (PDF) ----
// Alle afgeronde opdrachten in de periode, optioneel gefilterd op klant, met
// hun stops erbij - de brondata voor de dagstaat-PDF (één blok per opdracht,
// naar voorbeeld van het papieren rittenformulier).
function haalOpdrachtenVoorDagstaat({ van, tot, klantId }) {
  const params = [van, tot];
  let query = `
    SELECT o.*, w.datum AS datum, w.ritnummer AS ritnummer, w.opmerkingen AS opmerkingen, g.naam AS chauffeur_naam, k.naam AS klant_naam
    FROM opdrachten o
    JOIN werkdagen w ON w.id = o.werkdag_id
    LEFT JOIN gebruikers g ON g.id = w.chauffeur_id
    LEFT JOIN klanten k ON k.id = o.klant_id
    WHERE o.status = 'afgerond' AND w.datum BETWEEN ? AND ?`;
  if (klantId) {
    query += ' AND o.klant_id = ?';
    params.push(klantId);
  }
  query += ' ORDER BY w.datum, o.aangemaakt_op';
  const opdrachten = db.prepare(query).all(...params);
  return opdrachten.map((o) => {
    const dagregels = haalDagregelsVoorOpdracht(o.id);
    return { ...o, dagregels, totalen: berekenOpdrachtTotalen(o, dagregels) };
  });
}

function activiteitBevat(activiteit, zoekterm) {
  return (activiteit || '').toLowerCase().includes(zoekterm);
}

function formatDatumPdf(iso) {
  if (!iso) return '';
  const [j, m, d] = iso.split('-');
  return `${d}-${m}-${j}`;
}

function formatMinutenPdf(minuten) {
  const m = Math.max(0, Math.round(minuten || 0));
  const uren = Math.floor(m / 60);
  const rest = m % 60;
  return `${uren}u ${String(rest).padStart(2, '0')}min`;
}

// Bouwt de dagstaat-PDF op - één pagina per opdracht(gever-segment), in
// dezelfde opzet als het papieren rittenformulier: bedrijfsnaam, gegevens
// bovenaan, een stops-tabel, en de dagtotalen onderaan.
function genereerDagstaatPdf(opdrachten) {
  const pdf = new PdfDocument();
  const linkerkant = 50;
  const rechterkant = pdf.breedte - 50;
  const kolommen = [
    { titel: 'Plaats', breedte: 140 },
    { titel: 'Aankomst', breedte: 65 },
    { titel: 'Vertrek', breedte: 65 },
    { titel: 'Laden', breedte: 50 },
    { titel: 'Lossen', breedte: 50 },
    { titel: 'Pauze', breedte: 50 },
    { titel: 'Km-stand', breedte: 75 },
  ];

  const tekenTabelHeader = (y) => {
    let x = linkerkant;
    for (const k of kolommen) {
      pdf.tekst(x + 2, y, k.titel, { grootte: 9, vet: true });
      x += k.breedte;
    }
    pdf.lijn(linkerkant, y - 4, rechterkant, y - 4);
    return y - 18;
  };

  const tekenRij = (y, waarden) => {
    let x = linkerkant;
    waarden.forEach((waarde, i) => {
      pdf.tekst(x + 2, y, String(waarde == null ? '' : waarde), { grootte: 9 });
      x += kolommen[i].breedte;
    });
    return y - 16;
  };

  opdrachten.forEach((o, index) => {
    if (index > 0) pdf.nieuwePagina();
    let y = pdf.hoogte - 60;

    pdf.tekst(linkerkant, y, branding.bedrijfsnaam, { grootte: 18, vet: true });
    pdf.tekst(rechterkant - 100, y, 'Dagstaat', { grootte: 14, vet: true });
    y -= 30;
    pdf.lijn(linkerkant, y, rechterkant, y);
    y -= 25;

    const info = [
      ['Datum', formatDatumPdf(o.datum)],
      ['Opdrachtgever', o.klant_naam || '—'],
      ['Naam chauffeur', o.chauffeur_naam || '—'],
      ['Ritnummer', o.ritnummer || '—'],
    ];
    for (const [label, waarde] of info) {
      pdf.tekst(linkerkant, y, `${label}:`, { grootte: 10, vet: true });
      pdf.tekst(linkerkant + 120, y, String(waarde), { grootte: 10 });
      y -= 16;
    }
    if (o.opmerkingen) {
      pdf.tekst(linkerkant, y, 'Opmerkingen:', { grootte: 10, vet: true });
      pdf.tekst(linkerkant + 120, y, o.opmerkingen, { grootte: 10 });
      y -= 16;
    }
    y -= 10;

    y = tekenTabelHeader(y);
    y = tekenRij(y, [o.start_plaats || '—', o.start_tijd || '—', '', '', '', '', o.start_km != null ? o.start_km : '']);

    for (const d of o.dagregels) {
      if (y < 90) {
        pdf.nieuwePagina();
        y = pdf.hoogte - 60;
        y = tekenTabelHeader(y);
      }
      y = tekenRij(y, [
        d.plaats || '—',
        d.tijd_aankomst || '—',
        d.tijd_vertrek || '—',
        activiteitBevat(d.activiteit, 'laden') ? 'X' : '',
        activiteitBevat(d.activiteit, 'lossen') ? 'X' : '',
        activiteitBevat(d.activiteit, 'pauze') ? 'X' : '',
        d.km_stand != null ? d.km_stand : '',
      ]);
    }

    if (y < 110) {
      pdf.nieuwePagina();
      y = pdf.hoogte - 60;
      y = tekenTabelHeader(y);
    }
    y = tekenRij(y, [o.eind_plaats || '—', o.eind_tijd || '—', '', '', '', '', o.eind_km != null ? o.eind_km : '']);

    y -= 25;
    pdf.lijn(linkerkant, y, rechterkant, y);
    y -= 20;

    const totalen = o.totalen || {};
    pdf.tekst(linkerkant, y, 'Beginstand:', { grootte: 10, vet: true });
    pdf.tekst(linkerkant + 90, y, String(o.start_km != null ? o.start_km : '—'), { grootte: 10 });
    pdf.tekst(linkerkant + 250, y, 'Begintijd:', { grootte: 10, vet: true });
    pdf.tekst(linkerkant + 330, y, String(o.start_tijd || '—'), { grootte: 10 });
    y -= 16;
    pdf.tekst(linkerkant, y, 'Eindstand:', { grootte: 10, vet: true });
    pdf.tekst(linkerkant + 90, y, String(o.eind_km != null ? o.eind_km : '—'), { grootte: 10 });
    pdf.tekst(linkerkant + 250, y, 'Eindtijd:', { grootte: 10, vet: true });
    pdf.tekst(linkerkant + 330, y, String(o.eind_tijd || '—'), { grootte: 10 });
    y -= 16;
    pdf.tekst(linkerkant, y, 'Totaal km:', { grootte: 10, vet: true });
    pdf.tekst(linkerkant + 90, y, totalen.kmTotaal != null ? `${totalen.kmTotaal} km` : '—', { grootte: 10 });
    pdf.tekst(linkerkant + 250, y, 'Totaal uren:', { grootte: 10, vet: true });
    pdf.tekst(linkerkant + 330, y, formatMinutenPdf(totalen.nettoMinuten || 0), { grootte: 10 });
  });

  return pdf.build();
}

// Zelfde opzet als haalOpdrachtenPerDag, maar voor het persoonlijke
// weekoverzicht van één chauffeur: gefilterd op zijn eigen dagen, met een
// weektotaal (uren, km) erbij - geen facturatiebedragen, die zijn alleen
// relevant voor de beheerder.
function haalOpdrachtenPerDagVoorChauffeur(chauffeurId, { van, tot }) {
  const opdrachten = db
    .prepare(
      `SELECT o.*, w.datum AS datum, k.naam AS klant_naam
       FROM opdrachten o
       JOIN werkdagen w ON w.id = o.werkdag_id
       LEFT JOIN klanten k ON k.id = o.klant_id
       WHERE o.status = 'afgerond' AND w.chauffeur_id = ? AND w.datum BETWEEN ? AND ?
       ORDER BY w.datum, o.aangemaakt_op`
    )
    .all(chauffeurId, van, tot);

  const perDag = new Map();
  let totaalUren = 0;
  let totaalKm = 0;
  for (const o of opdrachten) {
    const totalen = berekenOpdrachtTotalen(o, haalDagregelsVoorOpdracht(o.id));
    const uren = totalen.nettoMinuten / 60;
    totaalUren += uren;
    totaalKm += totalen.kmTotaal || 0;
    if (!perDag.has(o.datum)) perDag.set(o.datum, []);
    perDag.get(o.datum).push({ klant_naam: o.klant_naam || 'Onbekende opdrachtgever', uren, km: totalen.kmTotaal });
  }
  const dagen = Array.from(perDag.entries())
    .map(([datum, opdrachten]) => ({ datum, opdrachten }))
    .sort((a, b) => a.datum.localeCompare(b.datum));
  return { dagen, totaalUren, totaalKm };
}

// ---- Voertuigen: onderhoud/APK/verzekering-herinneringen & bezetting ----
const HERINNERING_WAARSCHUW_DAGEN = 30;

function vervaldatumStatus(vervaldatum) {
  const vandaag = vandaagIso();
  const drempelIso = addDagen(vandaag, HERINNERING_WAARSCHUW_DAGEN);
  if (vervaldatum < vandaag) return 'verlopen';
  if (vervaldatum <= drempelIso) return 'binnenkort';
  return 'ok';
}

function haalVoertuigenMetAandacht() {
  const voertuigen = db.prepare('SELECT * FROM voertuigen ORDER BY kenteken').all();
  for (const v of voertuigen) {
    const herinneringen = db.prepare('SELECT * FROM voertuig_herinneringen WHERE voertuig_id = ? ORDER BY vervaldatum').all(v.id);
    let beste = null;
    for (const h of herinneringen) {
      const status = vervaldatumStatus(h.vervaldatum);
      if (status === 'ok') continue;
      if (!beste || h.vervaldatum < beste.vervaldatum) beste = { ...h, status };
    }
    v.aandacht_status = beste ? beste.status : 'ok';
    v.eerstvolgende_omschrijving = beste ? `${HERINNERING_TYPE_LABEL[beste.type] || beste.type}${beste.omschrijving ? ' - ' + beste.omschrijving : ''}` : null;
    v.eerstvolgende_vervaldatum = beste ? beste.vervaldatum : null;
  }
  return voertuigen;
}

function huidigeMaandBereik() {
  const vandaag = vandaagIso();
  return { van: `${vandaag.slice(0, 8)}01`, tot: vandaag };
}

function haalVoertuigBezetting(voertuigId, van, tot) {
  const rittenSom = db
    .prepare(`SELECT COALESCE(SUM(afstand_km), 0) AS km FROM ritten WHERE voertuig_id = ? AND datum BETWEEN ? AND ? AND status != 'geannuleerd'`)
    .get(voertuigId, van, tot);
  const rittenDagen = db
    .prepare(`SELECT DISTINCT datum FROM ritten WHERE voertuig_id = ? AND datum BETWEEN ? AND ? AND status != 'geannuleerd'`)
    .all(voertuigId, van, tot);
  const opdrachtenMetVoertuig = db
    .prepare(
      `SELECT o.*, w.datum AS datum FROM opdrachten o
       JOIN werkdagen w ON w.id = o.werkdag_id
       JOIN routes r ON r.id = o.route_id
       WHERE r.voertuig_id = ? AND w.datum BETWEEN ? AND ? AND o.status = 'afgerond'`
    )
    .all(voertuigId, van, tot);

  let km = rittenSom.km || 0;
  let minuten = 0;
  const dagenSet = new Set(rittenDagen.map((r) => r.datum));
  for (const o of opdrachtenMetVoertuig) {
    const totalen = berekenOpdrachtTotalen(o, haalDagregelsVoorOpdracht(o.id));
    minuten += totalen.nettoMinuten;
    if (totalen.kmTotaal != null) km += totalen.kmTotaal;
    dagenSet.add(o.datum);
  }

  const dagenInPeriode = Math.max(1, Math.round((new Date(tot) - new Date(van)) / 86400000) + 1);
  return { totaalKm: km, totaalUren: minuten / 60, dagenIngezet: dagenSet.size, dagenInPeriode };
}

function haalIncidentenOverzicht(statusFilter) {
  let query = `
    SELECT i.*, c.naam AS chauffeur_naam, t.adres AS taak_adres, r.datum AS route_datum, w.datum AS werkdag_datum
    FROM incidenten i
    LEFT JOIN gebruikers c ON c.id = i.chauffeur_id
    LEFT JOIN taken t ON t.id = i.taak_id
    LEFT JOIN routes r ON r.id = t.route_id
    LEFT JOIN werkdagen w ON w.id = i.werkdag_id
  `;
  const params = [];
  if (statusFilter) {
    query += ' WHERE i.status = ?';
    params.push(statusFilter);
  }
  query += ' ORDER BY i.aangemaakt_op DESC';
  return db.prepare(query).all(...params);
}

// ---- Beheerdersdashboard ----
function periodeBereik(type, offset = 0) {
  const vandaag = vandaagIso();
  if (type === 'week') {
    const dezeWeek = weekBereikVanDatum(vandaag);
    return { van: addDagen(dezeWeek.van, offset * 7), tot: addDagen(dezeWeek.tot, offset * 7) };
  }
  return maandBereikVanDatum(vandaag, offset);
}

function berekenPeriodeCijfers({ van, tot }) {
  const ritten = db.prepare(`SELECT * FROM ritten WHERE datum BETWEEN ? AND ? AND status != 'geannuleerd'`).all(van, tot);
  let omzet = 0;
  let kosten = 0;
  for (const r of ritten) {
    omzet += r.klantprijs || 0;
    kosten += r.kostprijs || 0;
  }

  const overzicht = haalWeekUitdraai({ van, tot });
  for (const k of overzicht) omzet += k.bedrag;

  // Werkelijke kostprijs van de gereden/gewerkte uren en kilometers uit de
  // urenregistratie, op basis van de kostprijsinstellingen (per_km/per_uur) -
  // dit is de nacalculatie, los van de aparte (handmatige) ritten-planning.
  const opdrachtenAlles = db
    .prepare(
      `SELECT o.* FROM opdrachten o JOIN werkdagen w ON w.id = o.werkdag_id WHERE o.status = 'afgerond' AND w.datum BETWEEN ? AND ?`
    )
    .all(van, tot);
  const instellingen = haalInstellingen();
  const kostprijsPerUur = berekenKostprijsPerUur(instellingen);
  const kostprijsPerKm = berekenKostprijsPerKm(instellingen);
  let minuten = 0;
  let kmTotaal = 0;
  for (const o of opdrachtenAlles) {
    const totalen = berekenOpdrachtTotalen(o, haalDagregelsVoorOpdracht(o.id));
    minuten += totalen.nettoMinuten;
    kmTotaal += totalen.kmTotaal || 0;
    kosten += o.tolkosten || 0;
  }
  kosten += (minuten / 60) * kostprijsPerUur + kmTotaal * kostprijsPerKm;

  return {
    omzet: Math.round(omzet * 100) / 100,
    kosten: Math.round(kosten * 100) / 100,
    marge: Math.round((omzet - kosten) * 100) / 100,
    uren: minuten / 60,
    aantalRitten: ritten.length,
  };
}

function haalVerliesRitten({ limiet = 5 } = {}) {
  return db
    .prepare(
      `SELECT r.*, k.naam AS klant_naam FROM ritten r LEFT JOIN klanten k ON k.id = r.klant_id
       WHERE r.klantprijs IS NOT NULL AND r.klantprijs < r.kostprijs AND r.status != 'geannuleerd'
       ORDER BY r.datum DESC LIMIT ?`
    )
    .all(limiet);
}

function haalRisicoTaken() {
  const vandaag = vandaagIso();
  const taken = db
    .prepare(
      `SELECT t.*, r.datum AS route_datum, c.naam AS chauffeur_naam
       FROM taken t
       JOIN routes r ON r.id = t.route_id
       LEFT JOIN gebruikers c ON c.id = r.chauffeur_id
       WHERE t.status != 'afgerond' AND t.tijdvenster_tot IS NOT NULL AND r.datum <= ?
       ORDER BY r.datum, t.tijdvenster_tot`
    )
    .all(vandaag);
  const nuTijd = huidigeTijd();
  const resultaat = [];
  for (const t of taken) {
    const verstreken = `${t.route_datum}T${t.tijdvenster_tot}` < `${vandaag}T${nuTijd}`;
    if (verstreken) {
      resultaat.push({ ...t, risico: 'verlopen' });
      continue;
    }
    if (t.route_datum === vandaag) {
      const [uu, mm] = t.tijdvenster_tot.split(':').map(Number);
      const [nu2, nm] = nuTijd.split(':').map(Number);
      if (uu * 60 + mm - (nu2 * 60 + nm) <= 60) resultaat.push({ ...t, risico: 'binnenkort' });
    }
  }
  return resultaat;
}

function haalTopOpdrachtgevers({ van, tot, limiet = 5 }) {
  const rittenPerKlant = db
    .prepare(
      `SELECT k.id AS klant_id, k.naam AS klant_naam, COALESCE(SUM(r.klantprijs), 0) AS omzet, COALESCE(SUM(r.kostprijs), 0) AS kosten
       FROM ritten r JOIN klanten k ON k.id = r.klant_id
       WHERE r.datum BETWEEN ? AND ? AND r.status != 'geannuleerd'
       GROUP BY k.id`
    )
    .all(van, tot);
  const werkdagOverzicht = haalWeekUitdraai({ van, tot });

  const combined = new Map();
  for (const r of rittenPerKlant) {
    combined.set(r.klant_id, { klant_naam: r.klant_naam, omzet: r.omzet, kosten: r.kosten });
  }
  for (const w of werkdagOverzicht) {
    if (!w.klant_id) continue;
    const bestaand = combined.get(w.klant_id) || { klant_naam: w.klant_naam, omzet: 0, kosten: 0 };
    bestaand.omzet += w.bedrag;
    combined.set(w.klant_id, bestaand);
  }
  return Array.from(combined.values())
    .map((k) => ({ ...k, marge: k.omzet - k.kosten }))
    .sort((a, b) => b.omzet - a.omzet)
    .slice(0, limiet);
}

function haalOmzetTrend({ aantalPeriodes = 8, type = 'week' } = {}) {
  const resultaat = [];
  for (let i = aantalPeriodes - 1; i >= 0; i--) {
    const { van, tot } = periodeBereik(type, -i);
    const cijfers = berekenPeriodeCijfers({ van, tot });
    const label = type === 'week' ? van.slice(5) : van.slice(0, 7);
    resultaat.push({ label, omzet: cijfers.omzet, marge: cijfers.marge });
  }
  return resultaat;
}

function haalNogTeFactureren() {
  const rittenSom =
    db.prepare(`SELECT COALESCE(SUM(klantprijs), 0) AS bedrag FROM ritten WHERE status = 'afgerond' AND gefactureerd = 0 AND klantprijs IS NOT NULL`).get()
      .bedrag || 0;
  const werkdagOverzicht = haalWeekUitdraai({ alleenNietGefactureerd: true });
  const werkdagSom = werkdagOverzicht.reduce((som, k) => som + k.bedrag, 0);
  return Math.round((rittenSom + werkdagSom) * 100) / 100;
}

// Afgeronde opdrachten met een opdrachtgever maar zonder gekoppelde
// tariefafspraak: hiervoor kan geen bedrag worden berekend (blijft overal
// €0,00 tellen), meestal omdat de opdrachtgever meerdere tariefafspraken
// heeft en de planner nog moet kiezen welke van toepassing is (bij precies
// één actieve tariefafspraak gebeurt de koppeling automatisch).
function haalOpdrachtenZonderTariefafspraak() {
  return db
    .prepare(
      `SELECT o.id, k.naam AS klant_naam FROM opdrachten o
       JOIN klanten k ON k.id = o.klant_id
       WHERE o.status = 'afgerond' AND o.tariefafspraak_id IS NULL
       ORDER BY k.naam`
    )
    .all();
}

function haalDashboardData(periodeType) {
  const huidig = periodeBereik(periodeType, 0);
  const vorig = periodeBereik(periodeType, -1);
  const cijfersHuidig = berekenPeriodeCijfers(huidig);
  const cijfersVorig = berekenPeriodeCijfers(vorig);
  const voertuigen = haalVoertuigenMetAandacht();
  return {
    periodeType,
    huidig,
    vorig,
    cijfersHuidig,
    cijfersVorig,
    verliesRitten: haalVerliesRitten(),
    voertuigenMetAandacht: voertuigen.filter((v) => v.aandacht_status !== 'ok'),
    openIncidenten: haalIncidentenOverzicht('open'),
    risicoTaken: haalRisicoTaken(),
    opdrachtenZonderTarief: haalOpdrachtenZonderTariefafspraak(),
    topOpdrachtgevers: haalTopOpdrachtgevers({ van: huidig.van, tot: huidig.tot }),
    voertuigenBezetting: voertuigen.map((v) => ({ ...v, bezetting: haalVoertuigBezetting(v.id, huidig.van, huidig.tot) })),
    nogTeFactureren: haalNogTeFactureren(),
    trend: haalOmzetTrend({ aantalPeriodes: 8, type: periodeType === 'maand' ? 'maand' : 'week' }),
  };
}

function csvVeld(waarde) {
  const tekst = String(waarde ?? '');
  if (/[;"\n]/.test(tekst)) {
    return '"' + tekst.replace(/"/g, '""') + '"';
  }
  return tekst;
}

function csvGetal(n) {
  return (Number(n) || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const BESTAND_CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;
    const methode = req.method;

    // Beveiligingsheaders (zoals WorkPortal).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // Formulieren alleen vanaf de eigen site accepteren (bescherming tegen CSRF).
    if (methode === 'POST' && req.headers.origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      let herkomst = '';
      try {
        herkomst = new URL(req.headers.origin).host;
      } catch {
        herkomst = '';
      }
      if (herkomst !== host) return stuurHtml(res, 403, 'Verzoek geweigerd.');
    }

    // Manifest: iOS krijgt het vierkante icoon (anders legt iOS er een glaseffect
    // over), andere apparaten het ronde icoon — net als WorkPortal.
    if (methode === 'GET' && pathname === '/manifest.webmanifest') {
      const ios = /iPhone|iPad|iPod/.test(req.headers['user-agent'] || '');
      const icons = ios
        ? [180, 192, 512].map((n) => ({ src: `/img/wp-app-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' }))
        : [96, 144, 192, 256, 384, 512].map((n) => ({ src: `/img/wp-round-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' }));
      const manifest = {
        name: branding.appNaam,
        short_name: branding.appNaam,
        start_url: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#0A0A96',
        id: '/',
        scope: '/',
        icons,
      };
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', Vary: 'User-Agent', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(manifest));
      return;
    }

    if (methode === 'GET' && pathname !== '/' && serveerStatischBestand(req, res, pathname)) {
      return;
    }

    // ---- Gezondheidscontrole voor Docker (HEALTHCHECK) en Portainer ----
    if (methode === 'GET' && pathname === '/health') {
      db.prepare('SELECT 1').get();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok', version: APP_VERSIE }));
      return;
    }

    // ---- Inloggen: e-mailcode + pincode per apparaat (zie src/inloggen.js) ----
    if (await behandelInloggen(req, res, url, { leesFormulier, stuurHtml, redirect })) return;

    const gebruiker = huidigeGebruiker(req);

    if (pathname === '/') {
      if (!gebruiker) return redirect(res, '/login');
      if (kan(gebruiker, 'mijnwerk')) return redirect(res, '/chauffeur');
      if (kan(gebruiker, 'planning')) return redirect(res, '/planner/dashboard');
      return redirect(res, '/account');
    }

    if (!gebruiker) {
      // Niet ingelogd: naar het inlogscherm (pincode als dit apparaat al bekend is) en daarna terug.
      const terug = methode === 'GET' ? `?volgende=${encodeURIComponent(pathname + url.search)}` : '';
      return redirect(res, '/login' + terug);
    }

    // ---- Rechten per module: elk scherm valt onder één module ----
    const vereiste = vereisteVoorPad(pathname, methode);
    if (vereiste && !kan(gebruiker, vereiste.module, vereiste.niveau)) {
      return stuurHtml(
        res,
        403,
        layout({
          titel: 'Geen toegang',
          actief: '',
          gebruiker,
          inhoud: `<div class="card"><h1>Geen toegang</h1><p class="muted">Je functierol heeft geen rechten voor dit onderdeel${vereiste.niveau > 1 ? ' (of alleen om te bekijken)' : ''}. Vraag een beheerder om je rechten aan te passen.</p><p><a class="btn" href="/">Naar het beginscherm</a></p></div>`,
        })
      );
    }

    // ---- Beheer, Mijn account, menu en zoeken (zie src/beheer.js) ----
    if (await behandelBeheer(req, res, url, gebruiker, { leesFormulier, leesJson, stuurJson, stuurHtml, redirect, layout })) return;

    // Alles hierna vereist een ingelogde gebruiker.
    if (!gebruiker) return redirect(res, '/login');

    // ---- Geüploade bestanden (CMR, pakbon, foto's, handtekening) ----
    const bestandMatch = pathname.match(/^\/bestanden\/([^/]+)$/);
    if (bestandMatch && methode === 'GET') {
      const naam = decodeURIComponent(bestandMatch[1]);
      if (!bestandBestaat(naam)) return stuurHtml(res, 404, 'Bestand niet gevonden.');
      const volledigPad = bestandPad(naam);
      const contentType = BESTAND_CONTENT_TYPES[path.extname(volledigPad).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300' });
      fs.createReadStream(volledigPad).pipe(res);
      return;
    }

    // ---- Planner-routes ----
    if (pathname.startsWith('/planner')) {

      if (methode === 'GET' && pathname === '/planner/dashboard') {
        const periodeType = url.searchParams.get('periode') === 'week' ? 'week' : 'maand';
        return stuurHtml(
          res,
          200,
          layout({ titel: 'Bedrijfsdashboard', actief: 'bedrijfsdashboard', gebruiker, inhoud: pagDashboard(haalDashboardData(periodeType)) })
        );
      }

      if (methode === 'GET' && pathname === '/planner') {
        const datumFilter = url.searchParams.get('datum') || '';
        const ritten = haalRitten({ datum: datumFilter || undefined });
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Ritten',
            actief: 'ritten',
            gebruiker,
            inhoud: pagRittenOverzicht({ ritten, datumFilter }),
          })
        );
      }

      const laadFormulierData = () => ({
        klanten: db.prepare('SELECT * FROM klanten ORDER BY naam').all(),
        voertuigen: db.prepare('SELECT * FROM voertuigen WHERE actief = 1 ORDER BY kenteken').all(),
        chauffeurs: db.prepare("SELECT * FROM gebruikers WHERE rol = 'chauffeur' AND actief = 1 AND verwijderd = 0 ORDER BY naam").all(),
        toltarieven: haalToltarieven({ alleenActief: true }),
        margePercentage: haalInstellingen().marge_percentage,
        routeBerekeningActief: routeBerekeningActief(),
      });

      if (methode === 'GET' && pathname === '/planner/ritten/nieuw') {
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Nieuwe rit',
            actief: 'ritten',
            gebruiker,
            inhoud: pagRitFormulier({ rit: null, geselecteerdeTolIds: [], ...laadFormulierData() }),
          })
        );
      }

      if (methode === 'POST' && pathname === '/planner/ritten/nieuw') {
        const v = await leesFormulier(req);
        if (!v.datum || !v.ophaal_adres || !v.aflever_adres) {
          return stuurHtml(
            res,
            400,
            layout({
              titel: 'Nieuwe rit',
              actief: 'ritten',
              gebruiker,
              inhoud: pagRitFormulier({
                rit: v,
                geselecteerdeTolIds: alleWaarden(v, 'tol_ids'),
                ...laadFormulierData(),
                fout: 'Vul minimaal datum, ophaaladres en afleveradres in.',
              }),
            })
          );
        }
        const ritId = nieuweId();
        db.prepare(
          `INSERT INTO ritten (id, datum, ophaal_adres, aflever_adres, klant_id, voertuig_id, chauffeur_id, status, opmerkingen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ritId,
          v.datum,
          v.ophaal_adres,
          v.aflever_adres,
          v.klant_id || null,
          v.voertuig_id || null,
          v.chauffeur_id || null,
          v.status || 'gepland',
          v.opmerkingen || null
        );
        slaRitPrijsOp(ritId, v);
        return redirect(res, '/planner');
      }

      const ritBewerkMatch = pathname.match(/^\/planner\/ritten\/([^/]+)\/bewerken$/);
      if (ritBewerkMatch) {
        const ritId = ritBewerkMatch[1];
        const bestaandeRit = db.prepare('SELECT * FROM ritten WHERE id = ?').get(ritId);
        if (!bestaandeRit) return stuurHtml(res, 404, 'Rit niet gevonden.');

        if (methode === 'GET') {
          return stuurHtml(
            res,
            200,
            layout({
              titel: 'Rit bewerken',
              actief: 'ritten',
              gebruiker,
              inhoud: pagRitFormulier({
                rit: bestaandeRit,
                geselecteerdeTolIds: haalGeselecteerdeTolIds(ritId),
                ...laadFormulierData(),
              }),
            })
          );
        }

        if (methode === 'POST') {
          const v = await leesFormulier(req);
          if (!v.datum || !v.ophaal_adres || !v.aflever_adres) {
            return stuurHtml(
              res,
              400,
              layout({
                titel: 'Rit bewerken',
                actief: 'ritten',
                gebruiker,
                inhoud: pagRitFormulier({
                  rit: { ...bestaandeRit, ...v },
                  geselecteerdeTolIds: alleWaarden(v, 'tol_ids'),
                  ...laadFormulierData(),
                  fout: 'Vul minimaal datum, ophaaladres en afleveradres in.',
                }),
              })
            );
          }
          db.prepare(
            `UPDATE ritten SET datum=?, ophaal_adres=?, aflever_adres=?, klant_id=?, voertuig_id=?, chauffeur_id=?, status=?, opmerkingen=?, bijgewerkt_op=datetime('now')
             WHERE id=?`
          ).run(
            v.datum,
            v.ophaal_adres,
            v.aflever_adres,
            v.klant_id || null,
            v.voertuig_id || null,
            v.chauffeur_id || null,
            v.status || 'gepland',
            v.opmerkingen || null,
            ritId
          );
          slaRitPrijsOp(ritId, v);
          return redirect(res, '/planner');
        }
      }

      const ritVerwijderMatch = pathname.match(/^\/planner\/ritten\/([^/]+)\/verwijderen$/);
      if (ritVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM ritten WHERE id = ?').run(ritVerwijderMatch[1]);
        return redirect(res, '/planner');
      }

      const ritGefactureerdMatch = pathname.match(/^\/planner\/ritten\/([^/]+)\/gefactureerd$/);
      if (ritGefactureerdMatch && methode === 'POST') {
        db.prepare('UPDATE ritten SET gefactureerd = 1 - gefactureerd WHERE id = ?').run(ritGefactureerdMatch[1]);
        return redirect(res, '/planner/financieel');
      }

      // ---- Sjablonen voor vaste/terugkerende ritten ----
      const laadSjabloonFormulierData = () => ({
        klanten: db.prepare('SELECT * FROM klanten ORDER BY naam').all(),
        voertuigen: db.prepare('SELECT * FROM voertuigen WHERE actief = 1 ORDER BY kenteken').all(),
        chauffeurs: db.prepare("SELECT * FROM gebruikers WHERE rol = 'chauffeur' AND actief = 1 AND verwijderd = 0 ORDER BY naam").all(),
      });

      if (pathname === '/planner/sjablonen' && methode === 'GET') {
        const sjablonen = db
          .prepare(
            `SELECT s.*, k.naam AS klant_naam, v.kenteken, c.naam AS chauffeur_naam
             FROM rit_templates s
             LEFT JOIN klanten k ON k.id = s.klant_id
             LEFT JOIN voertuigen v ON v.id = s.voertuig_id
             LEFT JOIN gebruikers c ON c.id = s.chauffeur_id
             ORDER BY s.naam`
          )
          .all();
        return stuurHtml(res, 200, layout({ titel: 'Sjablonen', actief: 'sjablonen', gebruiker, inhoud: pagSjablonenOverzicht({ sjablonen }) }));
      }

      if (pathname === '/planner/sjablonen/nieuw' && methode === 'GET') {
        let sjabloon = null;
        const vanRitId = url.searchParams.get('van_rit');
        if (vanRitId) {
          const rit = db.prepare('SELECT * FROM ritten WHERE id = ?').get(vanRitId);
          if (rit) {
            sjabloon = {
              naam: '',
              ophaal_adres: rit.ophaal_adres,
              aflever_adres: rit.aflever_adres,
              klant_id: rit.klant_id,
              voertuig_id: rit.voertuig_id,
              chauffeur_id: rit.chauffeur_id,
              opmerkingen: rit.opmerkingen,
            };
          }
        }
        return stuurHtml(
          res,
          200,
          layout({ titel: 'Nieuw sjabloon', actief: 'sjablonen', gebruiker, inhoud: pagSjabloonFormulier({ sjabloon, ...laadSjabloonFormulierData() }) })
        );
      }

      if (pathname === '/planner/sjablonen/nieuw' && methode === 'POST') {
        const v = await leesFormulier(req);
        if (!v.naam || !v.ophaal_adres || !v.aflever_adres) {
          return stuurHtml(
            res,
            400,
            layout({
              titel: 'Nieuw sjabloon',
              actief: 'sjablonen',
              gebruiker,
              inhoud: pagSjabloonFormulier({ sjabloon: v, ...laadSjabloonFormulierData(), fout: 'Vul minimaal naam, ophaaladres en afleveradres in.' }),
            })
          );
        }
        db.prepare(
          `INSERT INTO rit_templates (id, naam, klant_id, ophaal_adres, aflever_adres, voertuig_id, chauffeur_id, opmerkingen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(nieuweId(), v.naam.trim(), v.klant_id || null, v.ophaal_adres, v.aflever_adres, v.voertuig_id || null, v.chauffeur_id || null, v.opmerkingen || null);
        return redirect(res, '/planner/sjablonen');
      }

      const sjabloonBewerkMatch = pathname.match(/^\/planner\/sjablonen\/([^/]+)\/bewerken$/);
      if (sjabloonBewerkMatch) {
        const sjabloonId = sjabloonBewerkMatch[1];
        const bestaand = db.prepare('SELECT * FROM rit_templates WHERE id = ?').get(sjabloonId);
        if (!bestaand) return stuurHtml(res, 404, 'Sjabloon niet gevonden.');

        if (methode === 'GET') {
          return stuurHtml(
            res,
            200,
            layout({ titel: 'Sjabloon bewerken', actief: 'sjablonen', gebruiker, inhoud: pagSjabloonFormulier({ sjabloon: bestaand, ...laadSjabloonFormulierData() }) })
          );
        }

        if (methode === 'POST') {
          const v = await leesFormulier(req);
          if (!v.naam || !v.ophaal_adres || !v.aflever_adres) {
            return stuurHtml(
              res,
              400,
              layout({
                titel: 'Sjabloon bewerken',
                actief: 'sjablonen',
                gebruiker,
                inhoud: pagSjabloonFormulier({
                  sjabloon: { ...bestaand, ...v },
                  ...laadSjabloonFormulierData(),
                  fout: 'Vul minimaal naam, ophaaladres en afleveradres in.',
                }),
              })
            );
          }
          db.prepare(
            `UPDATE rit_templates SET naam=?, klant_id=?, ophaal_adres=?, aflever_adres=?, voertuig_id=?, chauffeur_id=?, opmerkingen=? WHERE id=?`
          ).run(v.naam.trim(), v.klant_id || null, v.ophaal_adres, v.aflever_adres, v.voertuig_id || null, v.chauffeur_id || null, v.opmerkingen || null, sjabloonId);
          return redirect(res, '/planner/sjablonen');
        }
      }

      const sjabloonVerwijderMatch = pathname.match(/^\/planner\/sjablonen\/([^/]+)\/verwijderen$/);
      if (sjabloonVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM rit_templates WHERE id = ?').run(sjabloonVerwijderMatch[1]);
        return redirect(res, '/planner/sjablonen');
      }

      const sjabloonToepassenMatch = pathname.match(/^\/planner\/sjablonen\/([^/]+)\/toepassen$/);
      if (sjabloonToepassenMatch && methode === 'POST') {
        const sjabloon = db.prepare('SELECT * FROM rit_templates WHERE id = ?').get(sjabloonToepassenMatch[1]);
        if (!sjabloon) return stuurHtml(res, 404, 'Sjabloon niet gevonden.');
        const v = await leesFormulier(req);
        const datum = v.datum || vandaagIso();
        const ritId = nieuweId();
        db.prepare(
          `INSERT INTO ritten (id, datum, ophaal_adres, aflever_adres, klant_id, voertuig_id, chauffeur_id, status, opmerkingen)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'gepland', ?)`
        ).run(ritId, datum, sjabloon.ophaal_adres, sjabloon.aflever_adres, sjabloon.klant_id, sjabloon.voertuig_id, sjabloon.chauffeur_id, sjabloon.opmerkingen);
        return redirect(res, `/planner/ritten/${ritId}/bewerken`);
      }

      // ---- Back-ups ----
      if (pathname === '/planner/backups' && methode === 'GET') {
        const succes = url.searchParams.get('succes') === '1';
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Back-ups',
            actief: 'backups',
            gebruiker,
            inhoud: pagBackups({
                tabs: beheerTabs('backups'),
              backups: lijstBackups(),
              succes,
              fout: url.searchParams.get('fout') || '',
              oneDriveGeconfigureerd: oneDriveGeconfigureerd(),
              oneDriveGekoppeld: oneDriveGekoppeld(),
              herstelGestart: url.searchParams.get('herstel') === '1',
              ophaalStatus: bestandenOphaalStatus(),
              ontbrekendeBestanden: aantalOntbrekendeBestanden(),
            }),
          })
        );
      }

      // ---- Overzetten vanaf de oude omgeving ----
      if (pathname === '/planner/backups/herstellen' && methode === 'POST') {
        let bestanden;
        try {
          ({ bestanden } = await leesMultipart(req, { maxBytes: 500 * 1024 * 1024 }));
          const db_bestand = bestanden.find((b) => b.veld === 'database' && b.data && b.data.length);
          zetDatabaseKlaarVoorHerstel(db_bestand && db_bestand.data);
        } catch (fout) {
          return redirect(res, '/planner/backups?fout=' + encodeURIComponent(fout.message));
        }
        herstartBinnenkort();
        return redirect(res, '/planner/backups?herstel=1');
      }

      if (pathname === '/planner/backups/bestanden-ophalen' && methode === 'POST') {
        const v = await leesFormulier(req);
        try {
          startBestandenOphalen({ url: v.oude_url, email: v.email, wachtwoord: v.wachtwoord });
        } catch (fout) {
          return redirect(res, '/planner/backups?fout=' + encodeURIComponent(fout.message));
        }
        return redirect(res, '/planner/backups#overzetten');
      }

      if (pathname === '/planner/backups/nu' && methode === 'POST') {
        try {
          maakBackup();
        } catch (fout) {
          console.error('Handmatige back-up mislukt:', fout.message);
        }
        return redirect(res, '/planner/backups?succes=1');
      }

      const backupDownloadMatch = pathname.match(/^\/planner\/backups\/([^/]+)\/download$/);
      if (backupDownloadMatch && methode === 'GET') {
        try {
          const bestandNaam = decodeURIComponent(backupDownloadMatch[1]);
          const volledigPad = backupBestandPad(bestandNaam);
          if (!fs.existsSync(volledigPad)) return stuurHtml(res, 404, 'Back-up niet gevonden.');
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${bestandNaam}"`,
          });
          fs.createReadStream(volledigPad).pipe(res);
          return;
        } catch {
          return stuurHtml(res, 400, 'Ongeldige back-up.');
        }
      }

      const backupOneDriveOpnieuwMatch = pathname.match(/^\/planner\/backups\/([^/]+)\/onedrive-opnieuw$/);
      if (backupOneDriveOpnieuwMatch && methode === 'POST') {
        await uploadBackupNaarOneDrive(backupOneDriveOpnieuwMatch[1]);
        return redirect(res, '/planner/backups?succes=1');
      }

      if (pathname === '/planner/backups/onedrive/koppelen' && methode === 'POST') {
        try {
          oneDriveKoppelState = { ...(await startDeviceCodeFlow()), gestartOp: Date.now() };
        } catch (fout) {
          return stuurHtml(
            res,
            400,
            layout({
              titel: 'Back-ups',
              actief: 'backups',
              gebruiker,
              inhoud: pagBackups({
                tabs: beheerTabs('backups'),
                backups: lijstBackups(),
                fout: fout.message,
                oneDriveGeconfigureerd: oneDriveGeconfigureerd(),
                oneDriveGekoppeld: oneDriveGekoppeld(),
              }),
            })
          );
        }
        return redirect(res, '/planner/backups/onedrive/koppelen');
      }

      if (pathname === '/planner/backups/onedrive/koppelen' && methode === 'GET') {
        if (!oneDriveKoppelState) return redirect(res, '/planner/backups');
        return stuurHtml(
          res,
          200,
          layout({ titel: 'OneDrive koppelen', actief: 'backups', gebruiker, inhoud: pagOneDriveKoppelen(oneDriveKoppelState) })
        );
      }

      if (pathname === '/planner/backups/onedrive/koppelen/controleren' && methode === 'POST') {
        if (!oneDriveKoppelState) return redirect(res, '/planner/backups');
        const resultaat = await controleerDeviceCodeFlow(oneDriveKoppelState.deviceCode);
        if (resultaat.status === 'ok') {
          oneDriveKoppelState = null;
          return redirect(res, '/planner/backups?succes=1');
        }
        if (resultaat.status === 'pending') {
          return stuurHtml(
            res,
            200,
            layout({
              titel: 'OneDrive koppelen',
              actief: 'backups',
              gebruiker,
              inhoud: pagOneDriveKoppelen({ ...oneDriveKoppelState, nogNietVoltooid: true }),
            })
          );
        }
        oneDriveKoppelState = null;
        return stuurHtml(
          res,
          400,
          layout({
            titel: 'Back-ups',
            actief: 'backups',
            gebruiker,
            inhoud: pagBackups({
                tabs: beheerTabs('backups'),
              backups: lijstBackups(),
              fout: `Koppelen met OneDrive is mislukt: ${resultaat.bericht}`,
              oneDriveGeconfigureerd: oneDriveGeconfigureerd(),
              oneDriveGekoppeld: oneDriveGekoppeld(),
            }),
          })
        );
      }

      if (pathname === '/planner/backups/onedrive/loskoppelen' && methode === 'POST') {
        oneDriveLoskoppelen();
        oneDriveKoppelState = null;
        return redirect(res, '/planner/backups?succes=1');
      }

      if (pathname === '/planner/voertuigen') {
        if (methode === 'GET') {
          const voertuigen = haalVoertuigenMetAandacht();
          return stuurHtml(res, 200, layout({ titel: 'Voertuigen', actief: 'voertuigen', gebruiker, inhoud: pagVoertuigen({ voertuigen }) }));
        }
      }

      if (methode === 'POST' && pathname === '/planner/voertuigen/nieuw') {
        const v = await leesFormulier(req);
        const voertuigen = haalVoertuigenMetAandacht();
        if (!v.kenteken) {
          return stuurHtml(res, 400, layout({ titel: 'Voertuigen', actief: 'voertuigen', gebruiker, inhoud: pagVoertuigen({ voertuigen, fout: 'Kenteken is verplicht.' }) }));
        }
        try {
          db.prepare('INSERT INTO voertuigen (id, kenteken, omschrijving, kostprijs_per_km) VALUES (?, ?, ?, ?)').run(
            nieuweId(),
            v.kenteken.trim(),
            v.omschrijving || null,
            v.kostprijs_per_km ? Number(v.kostprijs_per_km) : 0
          );
        } catch {
          return stuurHtml(res, 400, layout({ titel: 'Voertuigen', actief: 'voertuigen', gebruiker, inhoud: pagVoertuigen({ voertuigen, fout: 'Dit kenteken bestaat al.' }) }));
        }
        return redirect(res, '/planner/voertuigen');
      }

      const voertuigVerwijderMatch = pathname.match(/^\/planner\/voertuigen\/([^/]+)\/verwijderen$/);
      if (voertuigVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM voertuigen WHERE id = ?').run(voertuigVerwijderMatch[1]);
        return redirect(res, '/planner/voertuigen');
      }

      // ---- Voertuig-detail: bezetting & onderhoud/APK/verzekering-herinneringen ----
      const laadVoertuigDetailData = (voertuigId, van, tot) => {
        const herinneringenRuw = db.prepare('SELECT * FROM voertuig_herinneringen WHERE voertuig_id = ? ORDER BY vervaldatum').all(voertuigId);
        const herinneringen = herinneringenRuw.map((h) => ({ ...h, status: vervaldatumStatus(h.vervaldatum) }));
        const bezetting = haalVoertuigBezetting(voertuigId, van, tot);
        return { herinneringen, bezetting };
      };

      const voertuigDetailMatch = pathname.match(/^\/planner\/voertuigen\/([^/]+)$/);
      if (voertuigDetailMatch && methode === 'GET') {
        const voertuig = db.prepare('SELECT * FROM voertuigen WHERE id = ?').get(voertuigDetailMatch[1]);
        if (!voertuig) return stuurHtml(res, 404, 'Voertuig niet gevonden.');
        const standaard = huidigeMaandBereik();
        const van = url.searchParams.get('van') || standaard.van;
        const tot = url.searchParams.get('tot') || standaard.tot;
        return stuurHtml(
          res,
          200,
          layout({
            titel: voertuig.kenteken,
            actief: 'voertuigen',
            gebruiker,
            inhoud: pagVoertuigDetail({ voertuig, van, tot, ...laadVoertuigDetailData(voertuig.id, van, tot) }),
          })
        );
      }

      const herinneringNieuwMatch = pathname.match(/^\/planner\/voertuigen\/([^/]+)\/herinneringen\/nieuw$/);
      if (herinneringNieuwMatch && methode === 'POST') {
        const voertuigId = herinneringNieuwMatch[1];
        const voertuig = db.prepare('SELECT * FROM voertuigen WHERE id = ?').get(voertuigId);
        if (!voertuig) return stuurHtml(res, 404, 'Voertuig niet gevonden.');
        const v = await leesFormulier(req);
        if (!v.vervaldatum || !Object.keys(HERINNERING_TYPE_LABEL).includes(v.type)) {
          const standaard = huidigeMaandBereik();
          return stuurHtml(
            res,
            400,
            layout({
              titel: voertuig.kenteken,
              actief: 'voertuigen',
              gebruiker,
              inhoud: pagVoertuigDetail({
                voertuig,
                van: standaard.van,
                tot: standaard.tot,
                ...laadVoertuigDetailData(voertuigId, standaard.van, standaard.tot),
                fout: 'Vul een geldig type en vervaldatum in.',
              }),
            })
          );
        }
        db.prepare('INSERT INTO voertuig_herinneringen (id, voertuig_id, type, omschrijving, vervaldatum) VALUES (?, ?, ?, ?, ?)').run(
          nieuweId(),
          voertuigId,
          v.type,
          v.omschrijving || null,
          v.vervaldatum
        );
        return redirect(res, `/planner/voertuigen/${voertuigId}`);
      }

      const herinneringVerwijderMatch = pathname.match(/^\/planner\/voertuigen\/([^/]+)\/herinneringen\/([^/]+)\/verwijderen$/);
      if (herinneringVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM voertuig_herinneringen WHERE id = ?').run(herinneringVerwijderMatch[2]);
        return redirect(res, `/planner/voertuigen/${herinneringVerwijderMatch[1]}`);
      }

      if (pathname === '/planner/klanten' && methode === 'GET') {
        const klanten = haalKlantenMetTariefAantal();
        return stuurHtml(res, 200, layout({ titel: 'Klanten', actief: 'klanten', gebruiker, inhoud: pagKlanten({ klanten }) }));
      }

      // Snel een klant aanmaken vanuit het zoekveld bij "Klant / Opdrachtgever"
      // (recht Bewerken op Relaties, gecontroleerd via de module "relaties").
      if (methode === 'POST' && pathname === '/planner/klanten/snel') {
        const v = await leesJson(req).catch(() => ({}));
        const naam = String(v.naam || '').trim().slice(0, 120);
        if (!naam) return stuurJson(res, 400, { fout: 'Vul een naam in.' });
        const bestaand = db.prepare('SELECT id, naam FROM klanten WHERE lower(naam) = lower(?)').get(naam);
        if (bestaand) return stuurJson(res, 200, { id: bestaand.id, naam: bestaand.naam, bestond: true });
        const id = nieuweId();
        db.prepare('INSERT INTO klanten (id, naam, type) VALUES (?, ?, ?)').run(id, naam, v.type === 'transporteur' ? 'transporteur' : 'klant');
        logActie(gebruiker, 'Klant aangemaakt', 'klant', id, naam);
        return stuurJson(res, 201, { id, naam });
      }

      if (methode === 'POST' && pathname === '/planner/klanten/nieuw') {
        const v = await leesFormulier(req);
        const klanten = haalKlantenMetTariefAantal();
        if (!v.naam) {
          return stuurHtml(res, 400, layout({ titel: 'Klanten', actief: 'klanten', gebruiker, inhoud: pagKlanten({ klanten, fout: 'Naam is verplicht.' }) }));
        }
        db.prepare('INSERT INTO klanten (id, naam, adres, telefoon, email, type) VALUES (?, ?, ?, ?, ?, ?)').run(
          nieuweId(),
          v.naam.trim(),
          v.adres || null,
          v.telefoon || null,
          v.email || null,
          v.type === 'transporteur' ? 'transporteur' : 'klant'
        );
        return redirect(res, '/planner/klanten');
      }

      const klantVerwijderMatch = pathname.match(/^\/planner\/klanten\/([^/]+)\/verwijderen$/);
      if (klantVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM klanten WHERE id = ?').run(klantVerwijderMatch[1]);
        return redirect(res, '/planner/klanten');
      }

      // ---- Klant-detail: tariefafspraken beheren ----
      const klantDetailMatch = pathname.match(/^\/planner\/klanten\/([^/]+)$/);
      if (klantDetailMatch && methode === 'GET') {
        const klant = db.prepare('SELECT * FROM klanten WHERE id = ?').get(klantDetailMatch[1]);
        if (!klant) return stuurHtml(res, 404, 'Klant niet gevonden.');
        const tariefafspraken = db.prepare('SELECT * FROM tariefafspraken WHERE klant_id = ? ORDER BY naam').all(klant.id);
        return stuurHtml(
          res,
          200,
          layout({ titel: klant.naam, actief: 'klanten', gebruiker, inhoud: pagKlantDetail({ klant, tariefafspraken }) })
        );
      }

      const tariefNieuwMatch = pathname.match(/^\/planner\/klanten\/([^/]+)\/tarieven\/nieuw$/);
      if (tariefNieuwMatch && methode === 'POST') {
        const klantId = tariefNieuwMatch[1];
        const klant = db.prepare('SELECT * FROM klanten WHERE id = ?').get(klantId);
        if (!klant) return stuurHtml(res, 404, 'Klant niet gevonden.');
        const v = await leesFormulier(req);
        const geldigeTypes = ['vast_per_rit', 'per_uur', 'per_km', 'per_uur_en_km', 'per_pallet'];
        if (!v.naam || !geldigeTypes.includes(v.type)) {
          const tariefafspraken = db.prepare('SELECT * FROM tariefafspraken WHERE klant_id = ? ORDER BY naam').all(klantId);
          return stuurHtml(
            res,
            400,
            layout({ titel: klant.naam, actief: 'klanten', gebruiker, inhoud: pagKlantDetail({ klant, tariefafspraken, fout: 'Vul een naam en een geldig type in.' }) })
          );
        }
        db.prepare(
          `INSERT INTO tariefafspraken (id, klant_id, naam, type, tarief_vast, tarief_per_uur, tarief_per_km, tarief_per_pallet)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          nieuweId(),
          klantId,
          v.naam.trim(),
          v.type,
          v.tarief_vast ? Number(v.tarief_vast) : null,
          v.tarief_per_uur ? Number(v.tarief_per_uur) : null,
          v.tarief_per_km ? Number(v.tarief_per_km) : null,
          v.tarief_per_pallet ? Number(v.tarief_per_pallet) : null
        );
        return redirect(res, `/planner/klanten/${klantId}`);
      }

      const tariefVerwijderMatch = pathname.match(/^\/planner\/klanten\/([^/]+)\/tarieven\/([^/]+)\/verwijderen$/);
      if (tariefVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM tariefafspraken WHERE id = ?').run(tariefVerwijderMatch[2]);
        return redirect(res, `/planner/klanten/${tariefVerwijderMatch[1]}`);
      }

      if (pathname === '/planner/chauffeurs' && methode === 'GET') {
        const chauffeurs = db.prepare("SELECT * FROM gebruikers WHERE rol = 'chauffeur' AND verwijderd = 0 ORDER BY naam").all();
        return stuurHtml(res, 200, layout({ titel: 'Chauffeurs', actief: 'chauffeurs', gebruiker, inhoud: pagChauffeurs({ chauffeurs }) }));
      }

      if (methode === 'POST' && pathname === '/planner/chauffeurs/nieuw') {
        const v = await leesFormulier(req);
        const chauffeurs = db.prepare("SELECT * FROM gebruikers WHERE rol = 'chauffeur' AND verwijderd = 0 ORDER BY naam").all();
        if (!v.naam || !v.email) {
          return stuurHtml(res, 400, layout({ titel: 'Chauffeurs', actief: 'chauffeurs', gebruiker, inhoud: pagChauffeurs({ chauffeurs, fout: 'Naam en e-mailadres zijn verplicht.' }) }));
        }
        try {
          const id = nieuweId();
          const nieuw = { naam: v.naam.trim(), email: v.email.toLowerCase().trim() };
          // Geen wachtwoord meer: inloggen gaat met e-mailcode + pincode. Het
          // wachtwoordveld krijgt een onbruikbare willekeurige waarde.
          db.prepare("INSERT INTO gebruikers (id, naam, email, wachtwoord_hash, rol) VALUES (?, ?, ?, ?, 'chauffeur')").run(
            id,
            nieuw.naam,
            nieuw.email,
            hashWachtwoord(nieuweId() + nieuweId())
          );
          const rolChauffeur = db.prepare("SELECT id FROM functierollen WHERE sleutel = 'chauffeur'").get();
          if (rolChauffeur) db.prepare('INSERT OR IGNORE INTO gebruiker_rollen (gebruiker_id, rol_id) VALUES (?, ?)').run(id, rolChauffeur.id);
          synchroniseerRolKolom(id);
          logActie(gebruiker, 'Gebruiker aangemaakt', 'gebruiker', id, `${nieuw.naam} <${nieuw.email}> (chauffeur)`);
          await stuurWelkomstmail(nieuw);
          const bijgewerkteChauffeurs = db.prepare("SELECT * FROM gebruikers WHERE rol = 'chauffeur' AND verwijderd = 0 ORDER BY naam").all();
          return stuurHtml(
            res,
            200,
            layout({
              titel: 'Chauffeurs',
              actief: 'chauffeurs',
              gebruiker,
              inhoud: pagChauffeurs({ chauffeurs: bijgewerkteChauffeurs, nieuweInloggegevens: nieuw }),
            })
          );
        } catch {
          return stuurHtml(res, 400, layout({ titel: 'Chauffeurs', actief: 'chauffeurs', gebruiker, inhoud: pagChauffeurs({ chauffeurs, fout: 'Dit e-mailadres bestaat al.' }) }));
        }
      }

      const chauffeurDeactiverenMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/deactiveren$/);
      if (chauffeurDeactiverenMatch && methode === 'POST') {
        const c = db.prepare('SELECT * FROM gebruikers WHERE id = ? AND verwijderd = 0').get(chauffeurDeactiverenMatch[1]);
        if (c && c.id !== gebruiker.id) {
          db.prepare('UPDATE gebruikers SET actief = ? WHERE id = ?').run(c.actief ? 0 : 1, c.id);
          if (c.actief) meldAlleApparatenAf(c.id); // inactief = direct van al zijn apparaten afgemeld
          logActie(gebruiker, c.actief ? 'Gebruiker uitgeschakeld' : 'Gebruiker geactiveerd', 'gebruiker', c.id, c.naam);
        }
        return redirect(res, '/planner/chauffeurs');
      }

      // Pincode vergeten / telefoon kwijt: alle apparaten van de chauffeur afmelden.
      const chauffeurAfmeldenMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/apparaten-afmelden$/);
      if (chauffeurAfmeldenMatch && methode === 'POST') {
        const c = db.prepare('SELECT * FROM gebruikers WHERE id = ? AND verwijderd = 0').get(chauffeurAfmeldenMatch[1]);
        const chauffeurs = db.prepare("SELECT * FROM gebruikers WHERE rol = 'chauffeur' AND verwijderd = 0 ORDER BY naam").all();
        if (!c || c.rol !== 'chauffeur') {
          return stuurHtml(res, 404, layout({ titel: 'Chauffeurs', actief: 'chauffeurs', gebruiker, inhoud: pagChauffeurs({ chauffeurs, fout: 'Chauffeur niet gevonden.' }) }));
        }
        meldAlleApparatenAf(c.id);
        logActie(gebruiker, 'Apparaten afgemeld', 'gebruiker', c.id, c.naam);
        return stuurHtml(
          res,
          200,
          layout({ titel: 'Chauffeurs', actief: 'chauffeurs', gebruiker, inhoud: pagChauffeurs({ chauffeurs, nieuwWachtwoordVoor: { naam: c.naam, email: c.email } }) })
        );
      }

      // ---- Urenregistratie van een chauffeur bekijken/corrigeren ----
      const plannerUrenMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/uren$/);
      if (plannerUrenMatch && methode === 'GET') {
        const chauffeurId = plannerUrenMatch[1];
        let werkdag = haalWerkdagVanVandaag(chauffeurId);
        werkdag = werkdag ? haalWerkdagMetKlant(werkdag.id) : null;
        const opdrachten = werkdag ? haalOpdrachtenMetDetails(werkdag.id) : [];
        const totalen = berekenWerkdagTotalen(werkdag, opdrachten);
        const klanten = db.prepare('SELECT * FROM klanten ORDER BY naam').all();
        const historie = haalWerkdagenHistorie(chauffeurId, 60);
        const actiePrefix = `/planner/chauffeurs/${chauffeurId}/uren`;
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Urenregistratie',
            actief: 'chauffeurs',
            gebruiker,
            inhoud: pagUrenregistratie({
              vandaagWerkdag: werkdag,
              vandaagOpdrachten: opdrachten,
              vandaagTotalen: totalen,
              historie,
              klanten,
              actiePrefix,
              opgeslagen: url.searchParams.get('succes') === '1',
            }),
          })
        );
      }

      const plannerUrenNieuwMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/uren\/nieuw$/);
      if (plannerUrenNieuwMatch && methode === 'GET') {
        const chauffeurId = plannerUrenNieuwMatch[1];
        const klanten = db.prepare('SELECT * FROM klanten ORDER BY naam').all();
        const tariefafspraken = db.prepare('SELECT * FROM tariefafspraken WHERE actief = 1 ORDER BY naam').all();
        const actiePrefix = `/planner/chauffeurs/${chauffeurId}/uren`;
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Dag toevoegen',
            actief: 'chauffeurs',
            gebruiker,
            inhoud: pagWerkdagNieuw({ klanten, tariefafspraken, magTariefZien: true, actiePrefix, terugUrl: actiePrefix }),
          })
        );
      }

      if (plannerUrenNieuwMatch && methode === 'POST') {
        const chauffeurId = plannerUrenNieuwMatch[1];
        const v = await leesFormulier(req);
        if (!v.datum) return redirect(res, `/planner/chauffeurs/${chauffeurId}/uren/nieuw`);
        const id = maakWerkdagCompleetAan(chauffeurId, v, { magTarief: true });
        return redirect(res, `/planner/chauffeurs/${chauffeurId}/uren/${id}?succes=1`);
      }

      // Velden van de dag van VANDAAG bijwerken/verwijderen, vanaf het
      // "vandaag"-blok op de planner-urenpagina (geen werkdag-id in de URL,
      // net als bij de chauffeur - zie de uitleg daar).
      const plannerUrenVandaagBijwerkenMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/uren\/bijwerken$/);
      if (plannerUrenVandaagBijwerkenMatch && methode === 'POST') {
        const chauffeurId = plannerUrenVandaagBijwerkenMatch[1];
        const werkdag = haalWerkdagVanVandaag(chauffeurId);
        const v = await leesFormulier(req);
        if (werkdag) slaVolledigeDagOp(werkdag.id, v, { magTarief: true });
        return redirect(res, `/planner/chauffeurs/${chauffeurId}/uren?succes=1`);
      }

      const plannerUrenVandaagVerwijderenMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/uren\/verwijderen$/);
      if (plannerUrenVandaagVerwijderenMatch && methode === 'POST') {
        const chauffeurId = plannerUrenVandaagVerwijderenMatch[1];
        const werkdag = haalWerkdagVanVandaag(chauffeurId);
        if (werkdag) db.prepare('DELETE FROM werkdagen WHERE id = ?').run(werkdag.id);
        return redirect(res, `/planner/chauffeurs/${chauffeurId}/uren`);
      }

      const plannerWerkdagVerwijderenMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/uren\/([^/]+)\/verwijderen$/);
      if (plannerWerkdagVerwijderenMatch && methode === 'POST') {
        const [, chauffeurId, werkdagId] = plannerWerkdagVerwijderenMatch;
        const werkdag = haalWerkdagVoorBewerken(werkdagId, chauffeurId);
        if (werkdag) db.prepare('DELETE FROM werkdagen WHERE id = ?').run(werkdag.id);
        return redirect(res, `/planner/chauffeurs/${chauffeurId}/uren`);
      }

      const plannerWerkdagBijwerkenMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/uren\/([^/]+)\/bijwerken$/);
      if (plannerWerkdagBijwerkenMatch && methode === 'POST') {
        const [, chauffeurId, werkdagId] = plannerWerkdagBijwerkenMatch;
        const werkdag = haalWerkdagVoorBewerken(werkdagId, chauffeurId);
        const v = await leesFormulier(req);
        if (werkdag) slaVolledigeDagOp(werkdag.id, v, { magTarief: true });
        return redirect(res, `/planner/chauffeurs/${chauffeurId}/uren/${werkdagId}?succes=1`);
      }

      const plannerWerkdagDetailMatch = pathname.match(/^\/planner\/chauffeurs\/([^/]+)\/uren\/([^/]+)$/);
      if (plannerWerkdagDetailMatch && methode === 'GET') {
        const [, chauffeurId, werkdagId] = plannerWerkdagDetailMatch;
        const werkdag = haalWerkdagVoorBewerken(werkdagId, chauffeurId);
        if (!werkdag) return stuurHtml(res, 404, 'Dag niet gevonden.');
        const opdrachten = haalOpdrachtenMetDetails(werkdag.id);
        const totalen = berekenWerkdagTotalen(werkdag, opdrachten);
        const klanten = db.prepare('SELECT * FROM klanten ORDER BY naam').all();
        const tariefafspraken = db.prepare('SELECT * FROM tariefafspraken WHERE actief = 1 ORDER BY naam').all();
        const actiePrefix = `/planner/chauffeurs/${chauffeurId}/uren/${werkdag.id}`;
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Urenregistratie',
            actief: 'chauffeurs',
            gebruiker,
            inhoud: pagWerkdagDetail({
              werkdag,
              opdrachten,
              totalen,
              klanten,
              tariefafspraken,
              magTariefZien: true,
              actiePrefix,
              terugUrl: `/planner/chauffeurs/${chauffeurId}/uren`,
              opgeslagen: url.searchParams.get('succes') === '1',
            }),
          })
        );
      }

      // ---- Route automatisch berekenen (gebruikt door het ritformulier) ----
      if (methode === 'POST' && pathname === '/planner/route-berekenen') {
        const { ophaal_adres, aflever_adres } = await leesJson(req);
        try {
          const afstand_km = await berekenAfstandKm(ophaal_adres, aflever_adres);
          return stuurJson(res, 200, { afstand_km });
        } catch (fout) {
          return stuurJson(res, fout.code === 'GEEN_API_KEY' ? 200 : 400, { fout: fout.message });
        }
      }

      // ---- Prijscalculator ----
      const laadPrijscalculatorData = () => ({
        voertuigen: db.prepare('SELECT * FROM voertuigen WHERE actief = 1 ORDER BY kenteken').all(),
        toltarieven: haalToltarieven({ alleenActief: true }),
        margePercentage: haalInstellingen().marge_percentage,
        routeBerekeningActief: routeBerekeningActief(),
        geschiedenis: db.prepare('SELECT * FROM prijsberekeningen ORDER BY aangemaakt_op DESC LIMIT 20').all(),
      });

      if (pathname === '/planner/prijscalculator' && methode === 'GET') {
        return stuurHtml(
          res,
          200,
          layout({ titel: 'Prijscalculator', actief: 'prijscalculator', gebruiker, inhoud: pagPrijscalculator({ ...laadPrijscalculatorData() }) })
        );
      }

      if (pathname === '/planner/prijscalculator' && methode === 'POST') {
        const v = await leesFormulier(req);
        if (!v.afstand_km) {
          return stuurHtml(
            res,
            400,
            layout({
              titel: 'Prijscalculator',
              actief: 'prijscalculator',
              gebruiker,
              inhoud: pagPrijscalculator({
                ...laadPrijscalculatorData(),
                v,
                geselecteerdeTolIds: alleWaarden(v, 'tol_ids'),
                fout: 'Vul minimaal de afstand in.',
              }),
            })
          );
        }
        const resultaat = berekenPrijsOfferte(v);
        db.prepare(
          `INSERT INTO prijsberekeningen (
             id, ophaal_adres, aflever_adres, afstand_km, leeg_km, voertuig_id, kostprijs_per_km,
             tol_omschrijving, tolkosten, adr, adr_percentage, adr_toeslag, koeltransport, koel_percentage, koel_toeslag,
             wachttijd_uren, wachttijd_tarief, wachttijd_toeslag, gemiddelde_snelheid, geschatte_rijtijd_uren,
             geschatte_reisduur_uren, aantal_overnachtingen, vergoeding_per_overnachting, overnachting_toeslag,
             marge_percentage, totale_kostprijs, voorgestelde_klantprijs, opmerkingen
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          nieuweId(),
          v.ophaal_adres || null,
          v.aflever_adres || null,
          Number(v.afstand_km) || 0,
          Number(v.leeg_km) || 0,
          v.voertuig_id || null,
          Number(v.kostprijs_per_km) || 0,
          resultaat.tolOmschrijvingen.join(', ') || null,
          resultaat.tolkosten,
          resultaat.adr ? 1 : 0,
          resultaat.adrPercentage,
          resultaat.adrToeslag,
          resultaat.koel ? 1 : 0,
          resultaat.koelPercentage,
          resultaat.koelToeslag,
          resultaat.wachttijdUren,
          resultaat.wachttijdTarief,
          resultaat.wachttijdToeslag,
          resultaat.gemiddeldeSnelheid,
          resultaat.rijtijdUren,
          resultaat.geschatteReisduurUren,
          resultaat.aantalOvernachtingen,
          resultaat.vergoedingPerOvernachting,
          resultaat.overnachtingToeslag,
          resultaat.margePercentage,
          resultaat.totaleKostprijs,
          resultaat.voorgesteldeKlantprijs,
          v.opmerkingen || null
        );
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Prijscalculator',
            actief: 'prijscalculator',
            gebruiker,
            inhoud: pagPrijscalculator({
              ...laadPrijscalculatorData(),
              v,
              geselecteerdeTolIds: alleWaarden(v, 'tol_ids'),
              resultaat,
            }),
          })
        );
      }

      const berekeningVerwijderMatch = pathname.match(/^\/planner\/prijscalculator\/([^/]+)\/verwijderen$/);
      if (berekeningVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM prijsberekeningen WHERE id = ?').run(berekeningVerwijderMatch[1]);
        return redirect(res, '/planner/prijscalculator');
      }

      // ---- Tarieven: standaard marge + toltarieven ----
      if (pathname === '/planner/tarieven' && methode === 'GET') {
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Tarieven',
            actief: 'tarieven',
            gebruiker,
            inhoud: pagTarieven({
              toltarieven: haalToltarieven(),
              tolLandtarieven: haalTolLandtarieven(),
              margePercentage: haalInstellingen().marge_percentage,
              kostprijsInstellingen: haalInstellingen(),
              kostprijsPerKm: berekenKostprijsPerKm(),
              kostprijsPerUur: berekenKostprijsPerUur(),
              routeBerekeningActief: routeBerekeningActief(),
              emailNotificatiesActief: emailNotificatiesActief(),
            }),
          })
        );
      }

      if (methode === 'POST' && pathname === '/planner/tarieven/marge') {
        const v = await leesFormulier(req);
        const marge = Number(v.marge_percentage);
        if (!Number.isFinite(marge) || marge < 0) {
          return stuurHtml(
            res,
            400,
            layout({
              titel: 'Tarieven',
              actief: 'tarieven',
              gebruiker,
              inhoud: pagTarieven({
                toltarieven: haalToltarieven(),
                tolLandtarieven: haalTolLandtarieven(),
                margePercentage: haalInstellingen().marge_percentage,
                kostprijsInstellingen: haalInstellingen(),
                kostprijsPerKm: berekenKostprijsPerKm(),
                kostprijsPerUur: berekenKostprijsPerUur(),
                routeBerekeningActief: routeBerekeningActief(),
                emailNotificatiesActief: emailNotificatiesActief(),
                fout: 'Vul een geldig percentage in.',
              }),
            })
          );
        }
        db.prepare('UPDATE instellingen SET marge_percentage = ? WHERE id = 1').run(marge);
        return redirect(res, '/planner/tarieven');
      }

      if (methode === 'POST' && pathname === '/planner/tarieven/kostprijs') {
        const v = await leesFormulier(req);
        const velden = [
          'brandstof_per_km',
          'banden_per_km',
          'onderhoud_per_km',
          'afschrijving_per_km',
          'uurloon',
          'verzekering_per_maand',
          'wegenbelasting_per_maand',
          'overige_kosten_per_maand',
          'verwachte_uren_per_maand',
        ];
        const waarden = {};
        let ongeldig = false;
        for (const veld of velden) {
          const getal = Number(v[veld]);
          if (!Number.isFinite(getal) || getal < 0) ongeldig = true;
          waarden[veld] = Number.isFinite(getal) ? getal : 0;
        }
        if (ongeldig) {
          return stuurHtml(
            res,
            400,
            layout({
              titel: 'Tarieven',
              actief: 'tarieven',
              gebruiker,
              inhoud: pagTarieven({
                toltarieven: haalToltarieven(),
                tolLandtarieven: haalTolLandtarieven(),
                margePercentage: haalInstellingen().marge_percentage,
                kostprijsInstellingen: waarden,
                kostprijsPerKm: berekenKostprijsPerKm(waarden),
                kostprijsPerUur: berekenKostprijsPerUur(waarden),
                routeBerekeningActief: routeBerekeningActief(),
                emailNotificatiesActief: emailNotificatiesActief(),
                fout: 'Vul overal een geldig getal (0 of hoger) in.',
              }),
            })
          );
        }
        db.prepare(
          `UPDATE instellingen SET brandstof_per_km = ?, banden_per_km = ?, onderhoud_per_km = ?, afschrijving_per_km = ?,
           uurloon = ?, verzekering_per_maand = ?, wegenbelasting_per_maand = ?, overige_kosten_per_maand = ?, verwachte_uren_per_maand = ?
           WHERE id = 1`
        ).run(
          waarden.brandstof_per_km,
          waarden.banden_per_km,
          waarden.onderhoud_per_km,
          waarden.afschrijving_per_km,
          waarden.uurloon,
          waarden.verzekering_per_maand,
          waarden.wegenbelasting_per_maand,
          waarden.overige_kosten_per_maand,
          waarden.verwachte_uren_per_maand,
        );
        return redirect(res, '/planner/tarieven');
      }

      if (methode === 'POST' && pathname === '/planner/tarieven/tol/nieuw') {
        const v = await leesFormulier(req);
        const bedrag = Number(v.bedrag);
        if (!v.omschrijving || !Number.isFinite(bedrag) || bedrag < 0) {
          return stuurHtml(
            res,
            400,
            layout({
              titel: 'Tarieven',
              actief: 'tarieven',
              gebruiker,
              inhoud: pagTarieven({
                toltarieven: haalToltarieven(),
                tolLandtarieven: haalTolLandtarieven(),
                margePercentage: haalInstellingen().marge_percentage,
                kostprijsInstellingen: haalInstellingen(),
                kostprijsPerKm: berekenKostprijsPerKm(),
                kostprijsPerUur: berekenKostprijsPerUur(),
                routeBerekeningActief: routeBerekeningActief(),
                emailNotificatiesActief: emailNotificatiesActief(),
                fout: 'Vul een omschrijving en een geldig bedrag in.',
              }),
            })
          );
        }
        db.prepare('INSERT INTO toltarieven (id, omschrijving, bedrag) VALUES (?, ?, ?)').run(nieuweId(), v.omschrijving.trim(), bedrag);
        return redirect(res, '/planner/tarieven');
      }

      const tolVerwijderMatch = pathname.match(/^\/planner\/tarieven\/tol\/([^/]+)\/verwijderen$/);
      if (tolVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM toltarieven WHERE id = ?').run(tolVerwijderMatch[1]);
        return redirect(res, '/planner/tarieven');
      }

      // ---- Toltarieven per land (centen per km) ----
      if (methode === 'POST' && pathname === '/planner/tarieven/tolland/nieuw') {
        const v = await leesFormulier(req);
        const centPerKm = Number(v.cent_per_km);
        if (v.land && Number.isFinite(centPerKm) && centPerKm >= 0) {
          db.prepare('INSERT INTO tol_landtarieven (id, land, cent_per_km) VALUES (?, ?, ?)').run(nieuweId(), v.land.trim(), centPerKm);
        }
        return redirect(res, '/planner/tarieven');
      }

      const tolLandVerwijderMatch = pathname.match(/^\/planner\/tarieven\/tolland\/([^/]+)\/verwijderen$/);
      if (tolLandVerwijderMatch && methode === 'POST') {
        db.prepare('DELETE FROM tol_landtarieven WHERE id = ?').run(tolLandVerwijderMatch[1]);
        return redirect(res, '/planner/tarieven');
      }

      // ---- Incidentenoverzicht ----
      if (pathname === '/planner/incidenten' && methode === 'GET') {
        const statusFilter = url.searchParams.get('status') || '';
        const incidenten = haalIncidentenOverzicht(statusFilter || undefined);
        return stuurHtml(
          res,
          200,
          layout({ titel: 'Incidenten', actief: 'incidenten', gebruiker, inhoud: pagIncidenten({ incidenten, statusFilter }) })
        );
      }

      const incidentStatusMatch = pathname.match(/^\/planner\/incidenten\/([^/]+)\/status$/);
      if (incidentStatusMatch && methode === 'POST') {
        const v = await leesFormulier(req);
        if (['open', 'afgehandeld'].includes(v.status)) {
          db.prepare('UPDATE incidenten SET status = ? WHERE id = ?').run(v.status, incidentStatusMatch[1]);
        }
        return redirect(res, '/planner/incidenten');
      }

      // ---- Financieel overzicht ----
      if (pathname === '/planner/financieel' && methode === 'GET') {
        const van = url.searchParams.get('van') || '';
        const tot = url.searchParams.get('tot') || '';
        let query = `
          SELECT r.*, k.naam AS klant_naam
          FROM ritten r
          LEFT JOIN klanten k ON k.id = r.klant_id
          WHERE r.status != 'geannuleerd'
        `;
        const params = [];
        if (van) {
          query += ' AND r.datum >= ?';
          params.push(van);
        }
        if (tot) {
          query += ' AND r.datum <= ?';
          params.push(tot);
        }
        query += ' ORDER BY r.datum DESC, r.aangemaakt_op DESC';
        const ritten = db.prepare(query).all(...params);
        const totalen = ritten.reduce(
          (acc, r) => {
            acc.aantal += 1;
            acc.kostprijs += r.kostprijs || 0;
            acc.klantprijs += r.klantprijs || 0;
            return acc;
          },
          { aantal: 0, kostprijs: 0, klantprijs: 0 }
        );
        totalen.marge = totalen.klantprijs - totalen.kostprijs;
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Financieel overzicht',
            actief: 'financieel',
            gebruiker,
            inhoud: pagFinancieelOverzicht({ ritten, vanDatum: van, totDatum: tot, totalen }),
          })
        );
      }

      // ---- Week-uitdraai (factureerbaar per opdrachtgever) ----
      if (pathname === '/planner/week-uitdraai' && methode === 'GET') {
        const standaard = huidigeWeekBereik();
        const van = url.searchParams.get('van') || standaard.van;
        const tot = url.searchParams.get('tot') || standaard.tot;
        const overzicht = haalWeekUitdraai({ van, tot });
        const perDag = haalOpdrachtenPerDag({ van, tot });
        const klanten = db.prepare('SELECT * FROM klanten ORDER BY naam').all();
        return stuurHtml(
          res,
          200,
          layout({ titel: 'Weekoverzicht', actief: 'week-uitdraai', gebruiker, inhoud: pagWeekUitdraai({ overzicht, perDag, van, tot, klanten }) })
        );
      }

      if (pathname === '/planner/week-uitdraai/gefactureerd' && methode === 'POST') {
        const v = await leesFormulier(req);
        if (v.klant_id && v.van && v.tot) {
          db.prepare(
            `UPDATE opdrachten SET gefactureerd = 1
             WHERE klant_id = ? AND status = 'afgerond'
               AND werkdag_id IN (SELECT id FROM werkdagen WHERE datum BETWEEN ? AND ?)`
          ).run(v.klant_id, v.van, v.tot);
        }
        return redirect(res, `/planner/week-uitdraai?van=${encodeURIComponent(v.van || '')}&tot=${encodeURIComponent(v.tot || '')}`);
      }

      if (pathname === '/planner/week-uitdraai/csv' && methode === 'GET') {
        const standaard = huidigeWeekBereik();
        const van = url.searchParams.get('van') || standaard.van;
        const tot = url.searchParams.get('tot') || standaard.tot;
        const overzicht = haalWeekUitdraai({ van, tot });
        const regels = ['Opdrachtgever;Tariefafspraak;Datum;Chauffeur;Uren;Km;Pallets;Colli;Te factureren (EUR)'];
        for (const k of overzicht) {
          for (const a of k.afspraken) {
            regels.push(
              [
                csvVeld(k.klant_naam),
                csvVeld(a.tarief_naam || 'Geen tariefafspraak'),
                '',
                '',
                csvGetal(a.uren),
                csvGetal(a.totaalKm),
                csvGetal(a.totaalPallets),
                csvGetal(a.totaalColli),
                csvGetal(a.bedrag),
              ].join(';')
            );
            const detailsGesorteerd = [...(a.details || [])].sort((d1, d2) => d1.datum.localeCompare(d2.datum));
            for (const d of detailsGesorteerd) {
              regels.push(
                ['', '', csvVeld(formatDatumKort(d.datum)), csvVeld(d.chauffeur_naam), csvGetal(d.uren), csvGetal(d.km), '', '', ''].join(';')
              );
            }
          }
          if (k.afspraken.length > 1) {
            regels.push(
              [
                csvVeld(`${k.klant_naam} - totaal`),
                '',
                '',
                '',
                csvGetal(k.uren),
                csvGetal(k.km),
                csvGetal(k.pallets),
                csvGetal(k.colli),
                csvGetal(k.bedrag),
              ].join(';')
            );
          }
        }
        const csvInhoud = '﻿' + regels.join('\r\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="week-uitdraai_${van}_${tot}.csv"`,
        });
        res.end(csvInhoud);
        return;
      }

      // ---- Dagstaat (PDF) - te downloaden, filter op periode en/of klant ----
      if (pathname === '/planner/dagstaat.pdf' && methode === 'GET') {
        const standaard = huidigeWeekBereik();
        const van = url.searchParams.get('van') || standaard.van;
        const tot = url.searchParams.get('tot') || standaard.tot;
        const klantId = url.searchParams.get('klant_id') || '';
        const opdrachten = haalOpdrachtenVoorDagstaat({ van, tot, klantId });
        if (!opdrachten.length) {
          return stuurHtml(
            res,
            200,
            layout({
              titel: 'Weekoverzicht',
              actief: 'week-uitdraai',
              gebruiker,
              melding: { type: 'fout', tekst: 'Geen afgeronde ritten gevonden voor deze periode/opdrachtgever.' },
              inhoud: pagWeekUitdraai({
                overzicht: haalWeekUitdraai({ van, tot }),
                perDag: haalOpdrachtenPerDag({ van, tot }),
                van,
                tot,
                klanten: db.prepare('SELECT * FROM klanten ORDER BY naam').all(),
              }),
            })
          );
        }
        const pdfBuffer = genereerDagstaatPdf(opdrachten);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="dagstaat_${van}_${tot}.pdf"`,
          'Content-Length': pdfBuffer.length,
        });
        res.end(pdfBuffer);
        return;
      }
    }

    // ---- Chauffeur-routes (dagelijkse werk-schermen) - toegankelijk voor
    // zowel chauffeurs als de beheerder, want de beheerder registreert hier
    // ook gewoon zijn eigen dag (zie boven: "iedereen mag alles" onder eigen
    // gebruiker.id). Alleen /planner/* hieronder blijft beheerder-only. ----
    if (pathname.startsWith('/chauffeur')) {
      // ---- Beginscherm ----
      if (methode === 'GET' && pathname === '/chauffeur') {
        const datumVandaag = vandaagIso();
        let werkdag = haalWerkdagVanVandaag(gebruiker.id);
        werkdag = werkdag ? haalWerkdagMetKlant(werkdag.id) : null;
        const opdrachtenVandaag = werkdag ? haalOpdrachtenMetDetails(werkdag.id) : [];
        const totalen = berekenWerkdagTotalen(werkdag, opdrachtenVandaag);
        const week = huidigeWeekBereik();

        // Per dag van deze week (ma t/m zo): netto minuten en gereden km.
        const historie = haalWerkdagenHistorie(gebruiker.id, 7).filter((h) => h.werkdag.datum >= week.van);
        const perDag = {};
        for (const h of historie) {
          const d = (perDag[h.werkdag.datum] ||= { minuten: 0, km: 0 });
          d.minuten += h.nettoMinuten;
          d.km += h.kmTotaal || 0;
        }
        if (werkdag && werkdag.datum >= week.van) {
          const d = (perDag[werkdag.datum] ||= { minuten: 0, km: 0 });
          d.minuten += totalen.nettoMinuten;
          d.km += totalen.kmTotaal || 0;
        }
        const weekDagen = Array.from({ length: 7 }, (_, i) => {
          const datum = addDagen(week.van, i);
          return { datum, minuten: (perDag[datum] || {}).minuten || 0, km: (perDag[datum] || {}).km || 0, vandaag: datum === datumVandaag };
        });
        const urenDezeWeekMinuten = weekDagen.reduce((s2, d) => s2 + d.minuten, 0);
        const kmDezeWeek = weekDagen.reduce((s2, d) => s2 + d.km, 0);
        const dagenGewerkt = weekDagen.filter((d) => d.minuten > 0).length;

        // Geplande ritten (gepland/onderweg) en openstaande stops uit toegewezen routes.
        const ritten = haalRittenVoorChauffeur(gebruiker.id);
        const openTaken = db
          .prepare(
            `SELECT t.id, t.type, t.adres, t.tijdvenster_van, t.tijdvenster_tot, t.status, r.datum, k.naam AS klant_naam
             FROM taken t JOIN routes r ON r.id = t.route_id LEFT JOIN klanten k ON k.id = r.klant_id
             WHERE r.chauffeur_id = ? AND t.status != 'afgerond' AND r.datum >= ?
             ORDER BY r.datum, t.volgorde LIMIT 20`
          )
          .all(gebruiker.id, addDagen(datumVandaag, -7));
        const openOpdracht = werkdag && werkdag.status !== 'afgerond' ? haalOpenOpdracht(werkdag.id) : null;
        let openOpdrachtKlant = null;
        if (openOpdracht && openOpdracht.klant_id) {
          const k = db.prepare('SELECT naam FROM klanten WHERE id = ?').get(openOpdracht.klant_id);
          openOpdrachtKlant = k ? k.naam : null;
        }

        const uur = Number(huidigeTijd().slice(0, 2));
        const isMaandag = huidigeDagVanWeek() === 1;
        const isVrijdag = huidigeDagVanWeek() === 5;
        const naam = escapeHtml((gebruiker.naam || 'kerel').split(' ')[0]);
        const begroeting =
          werkdag && werkdag.status === 'afgerond'
            ? begroetingEind(naam, totalen.nettoMinuten, isVrijdag)
            : begroetingStart(naam, uur, isMaandag);

        const ongelezenMeldingen = db
          .prepare('SELECT * FROM meldingen WHERE gebruiker_id = ? AND gelezen = 0 ORDER BY aangemaakt_op DESC LIMIT 10')
          .all(gebruiker.id);

        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Mijn dag',
            actief: 'dashboard',
            gebruiker,
            inhoud: pagChauffeurDashboard({
              begroeting,
              datumVandaag,
              werkdag,
              totalenVandaag: totalen,
              aantalOpdrachtenVandaag: opdrachtenVandaag.length,
              openOpdracht,
              openOpdrachtKlant,
              weekDagen,
              urenDezeWeekMinuten,
              kmDezeWeek,
              dagenGewerkt,
              ritten,
              openTaken,
              ongelezenMeldingen,
            }),
          })
        );
      }

      // ---- Ritopdrachten ----
      if (methode === 'GET' && pathname === '/chauffeur/ritopdrachten') {
        const ritten = haalRittenVoorChauffeur(gebruiker.id);
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Ritopdrachten',
            actief: 'ritopdrachten',
            gebruiker,
            inhoud: pagChauffeurRitopdrachten({ ritten }),
          })
        );
      }

      const statusMatch = pathname.match(/^\/chauffeur\/ritten\/([^/]+)\/status$/);
      if (statusMatch && methode === 'POST') {
        const ritId = statusMatch[1];
        const v = await leesFormulier(req);
        const toegestaneStatussen = ['onderweg', 'afgerond'];
        const rit = db.prepare('SELECT * FROM ritten WHERE id = ? AND chauffeur_id = ?').get(ritId, gebruiker.id);
        if (rit && toegestaneStatussen.includes(v.status)) {
          db.prepare("UPDATE ritten SET status = ?, bijgewerkt_op = datetime('now') WHERE id = ?").run(v.status, ritId);
          const klant = rit.klant_id ? db.prepare('SELECT * FROM klanten WHERE id = ?').get(rit.klant_id) : null;
          if (klant && klant.email) {
            const onderweg = v.status === 'onderweg';
            const onderwerp = onderweg ? `Uw zending is onderweg` : `Uw zending is afgeleverd`;
            const tekst = `Beste ${klant.naam},\n\nUw zending (${rit.ophaal_adres} → ${rit.aflever_adres}) is ${
              onderweg ? 'onderweg.' : 'afgeleverd.'
            }\n\nMet vriendelijke groet,\n${branding.bedrijfsnaam}`;
            stuurKlantEmail({ naar: klant.email, onderwerp, tekst }).catch(() => {});
          }
        }
        return redirect(res, '/chauffeur/ritopdrachten');
      }

      // ---- Meldingen (incident/schade melden) ----
      if (methode === 'GET' && pathname === '/chauffeur/meldingen') {
        const incidenten = db
          .prepare('SELECT * FROM incidenten WHERE chauffeur_id = ? ORDER BY aangemaakt_op DESC LIMIT 30')
          .all(gebruiker.id);
        return stuurHtml(
          res,
          200,
          layout({ titel: 'Meldingen', actief: 'meldingen', gebruiker, inhoud: pagChauffeurMeldingen({ incidenten }) })
        );
      }

      if (methode === 'POST' && pathname === '/chauffeur/meldingen/nieuw') {
        let velden = {};
        let bestanden = [];
        try {
          ({ velden, bestanden } = await leesMultipart(req));
        } catch {
          return redirect(res, '/chauffeur/meldingen');
        }
        if (!velden.omschrijving || !velden.omschrijving.trim()) {
          return redirect(res, '/chauffeur/meldingen');
        }
        let fotoPad = null;
        const fotoBestand = bestanden.find((b) => b.veld === 'foto' && b.data && b.data.length);
        if (fotoBestand) fotoPad = slaBestandOp(fotoBestand.data, fotoBestand.bestandsnaam);
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        db.prepare('INSERT INTO incidenten (id, werkdag_id, chauffeur_id, omschrijving, foto_bestandsnaam) VALUES (?, ?, ?, ?, ?)').run(
          nieuweId(),
          werkdag ? werkdag.id : null,
          gebruiker.id,
          velden.omschrijving.trim(),
          fotoPad
        );
        return redirect(res, '/chauffeur/meldingen');
      }

      // ---- Notificaties (in-app, aanvullend op push) ----
      const notificatieGelezenMatch = pathname.match(/^\/chauffeur\/notificaties\/([^/]+)\/gelezen$/);
      if (notificatieGelezenMatch && methode === 'POST') {
        db.prepare('UPDATE meldingen SET gelezen = 1 WHERE id = ? AND gebruiker_id = ?').run(notificatieGelezenMatch[1], gebruiker.id);
        return redirect(res, '/chauffeur');
      }

      if (methode === 'POST' && pathname === '/chauffeur/notificaties/alles-gelezen') {
        db.prepare('UPDATE meldingen SET gelezen = 1 WHERE gebruiker_id = ?').run(gebruiker.id);
        return redirect(res, '/chauffeur');
      }

      // ---- Persoonlijk weekoverzicht (chauffeur) ----
      if (methode === 'GET' && pathname === '/chauffeur/weekoverzicht') {
        const standaard = huidigeWeekBereik();
        const van = url.searchParams.get('van') || standaard.van;
        const tot = url.searchParams.get('tot') || standaard.tot;
        const { dagen, totaalUren, totaalKm } = haalOpdrachtenPerDagVoorChauffeur(gebruiker.id, { van, tot });
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Weekoverzicht',
            actief: 'weekoverzicht',
            gebruiker,
            inhoud: pagChauffeurWeekoverzicht({ dagen, totaalUren, totaalKm, van, tot }),
          })
        );
      }

      // ---- Urenregistratie ----
      if (methode === 'GET' && pathname === '/chauffeur/uren') {
        let werkdag = haalWerkdagVanVandaag(gebruiker.id);
        werkdag = werkdag ? haalWerkdagMetKlant(werkdag.id) : null;
        const opdrachten = werkdag ? haalOpdrachtenMetDetails(werkdag.id) : [];
        const totalen = berekenWerkdagTotalen(werkdag, opdrachten);
        const klanten = db.prepare('SELECT * FROM klanten ORDER BY naam').all();
        const historie = haalWerkdagenHistorie(gebruiker.id, 14);
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Urenregistratie',
            actief: 'urenregistratie',
            gebruiker,
            inhoud: pagUrenregistratie({
              vandaagWerkdag: werkdag,
              vandaagOpdrachten: opdrachten,
              vandaagTotalen: totalen,
              historie,
              klanten,
              standaardBeginplaats: werkdag ? null : haalLaatsteEindplaats(gebruiker.id),
              actiePrefix: '/chauffeur/uren',
              opgeslagen: url.searchParams.get('succes') === '1',
            }),
          })
        );
      }

      if (methode === 'GET' && pathname === '/chauffeur/uren/nieuw') {
        const klanten = db.prepare('SELECT * FROM klanten ORDER BY naam').all();
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Dag toevoegen',
            actief: 'urenregistratie',
            gebruiker,
            inhoud: pagWerkdagNieuw({ klanten, actiePrefix: '/chauffeur/uren', terugUrl: '/chauffeur/uren' }),
          })
        );
      }

      if (methode === 'POST' && pathname === '/chauffeur/uren/nieuw') {
        const v = await leesFormulier(req);
        if (!v.datum) return redirect(res, '/chauffeur/uren/nieuw');
        const id = maakWerkdagCompleetAan(gebruiker.id, v, { magTarief: false });
        return redirect(res, `/chauffeur/uren/${id}?succes=1`);
      }

      if (methode === 'POST' && pathname === '/chauffeur/uren/dag/starten') {
        if (haalWerkdagVanVandaag(gebruiker.id)) return redirect(res, '/chauffeur/uren');
        const v = await leesFormulier(req);
        if (!v.start_km) return redirect(res, '/chauffeur/uren');
        const datum = vandaagIso();
        const werkdagId = nieuweId();
        db.prepare(`INSERT INTO werkdagen (id, chauffeur_id, datum, start_tijd, status) VALUES (?, ?, ?, ?, 'bezig')`).run(
          werkdagId,
          gebruiker.id,
          datum,
          huidigeTijd()
        );
        maakOpdrachtAan(werkdagId, {
          klant_id: v.klant_id || null,
          start_km: v.start_km,
          start_plaats: v.start_plaats,
        });
        return redirect(res, '/chauffeur/uren');
      }

      // Een lopende opdracht (opdrachtgever-segment) afsluiten: vraagt om de
      // eindkilometerstand, sluit een eventueel nog open stop af.
      if (methode === 'POST' && pathname === '/chauffeur/uren/opdracht/afsluiten') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        const openOpdracht = werkdag ? haalOpenOpdracht(werkdag.id) : null;
        if (openOpdracht) {
          const v = await leesFormulier(req);
          if (v.eind_km) {
            const eindTijd = huidigeTijd();
            const openRegel = haalOpenDagregel(openOpdracht.id);
            if (openRegel) db.prepare('UPDATE dagregels SET tijd_vertrek = ? WHERE id = ?').run(eindTijd, openRegel.id);
            db.prepare("UPDATE opdrachten SET eind_km = ?, eind_tijd = ?, eind_plaats = ?, status = 'afgerond' WHERE id = ?").run(
              Number(v.eind_km),
              eindTijd,
              (v.eind_plaats || '').trim() || null,
              openOpdracht.id
            );
          }
        }
        return redirect(res, '/chauffeur/uren');
      }

      // Een nieuwe opdracht (andere opdrachtgever) starten binnen de lopende
      // dag - alleen mogelijk als er nu geen opdracht open staat.
      if (methode === 'POST' && pathname === '/chauffeur/uren/opdracht/toevoegen') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        if (werkdag && werkdag.status === 'bezig' && !haalOpenOpdracht(werkdag.id)) {
          const v = await leesFormulier(req);
          maakOpdrachtAan(werkdag.id, { klant_id: v.klant_id, start_km: v.start_km, start_plaats: v.start_plaats });
        }
        return redirect(res, '/chauffeur/uren');
      }

      if (methode === 'POST' && pathname === '/chauffeur/uren/dag/afsluiten') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        if (!werkdag || werkdag.status !== 'bezig') return redirect(res, '/chauffeur/uren');
        if (haalOpenOpdracht(werkdag.id)) return redirect(res, '/chauffeur/uren'); // eerst de lopende opdracht afsluiten
        const v = await leesFormulier(req);
        db.prepare("UPDATE werkdagen SET eind_tijd = ?, liters_verbruikt = ?, status = 'afgerond' WHERE id = ?").run(
          huidigeTijd(),
          v.liters_verbruikt !== undefined && v.liters_verbruikt !== '' ? Number(v.liters_verbruikt) : null,
          werkdag.id
        );
        return redirect(res, '/chauffeur/uren');
      }

      // Velden van de dag van VANDAAG bijwerken/verwijderen (bijv. nadat de dag
      // al is afgesloten): deze heeft geen werkdag-id in de URL (het is altijd
      // "vandaag"), dus dit staat los van de /chauffeur/uren/:id/bijwerken route
      // hieronder die voor een historische dag wordt gebruikt.
      if (methode === 'POST' && pathname === '/chauffeur/uren/bijwerken') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        const v = await leesFormulier(req);
        if (werkdag) slaVolledigeDagOp(werkdag.id, v, { magTarief: false });
        return redirect(res, '/chauffeur/uren?succes=1');
      }

      if (methode === 'POST' && pathname === '/chauffeur/uren/verwijderen') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        if (werkdag) db.prepare('DELETE FROM werkdagen WHERE id = ?').run(werkdag.id);
        return redirect(res, '/chauffeur/uren');
      }

      // Aankomst/Vertrek: in plaats van één formulier met aankomst- én
      // vertrektijd tegelijk (moest achteraf worden ingevuld), zijn dit twee
      // losse knoppen. Aankomst legt een nieuwe stop vast met de huidige tijd
      // en de ingevulde gegevens; Vertrek heeft geen invoer nodig en zet
      // alleen de vertrektijd van de op dat moment open stop op nu.
      if (methode === 'POST' && pathname === '/chauffeur/uren/stop/aankomst') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        const openOpdracht = werkdag && werkdag.status === 'bezig' ? haalOpenOpdracht(werkdag.id) : null;
        if (openOpdracht && !haalOpenDagregel(openOpdracht.id)) {
          const v = await leesFormulier(req);
          maakDagregelAan(openOpdracht.id, werkdag.id, {
            plaats: v.plaats,
            activiteit: v.activiteit,
            km_stand: v.km_stand,
          });
        }
        return redirect(res, '/chauffeur/uren');
      }

      if (methode === 'POST' && pathname === '/chauffeur/uren/stop/vertrek') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        const openOpdracht = werkdag && werkdag.status === 'bezig' ? haalOpenOpdracht(werkdag.id) : null;
        const openRegel = openOpdracht ? haalOpenDagregel(openOpdracht.id) : null;
        if (openRegel) {
          db.prepare('UPDATE dagregels SET tijd_vertrek = ? WHERE id = ?').run(huidigeTijd(), openRegel.id);
        }
        return redirect(res, '/chauffeur/uren');
      }

      // Een eerdere stop van vandaag corrigeren (bijv. onderweg een fout
      // hersteld) - alleen de eigen, nog lopende dag van vandaag.
      const stopBijwerkenMatch = pathname.match(/^\/chauffeur\/uren\/stop\/([^/]+)\/bijwerken$/);
      if (stopBijwerkenMatch && methode === 'POST') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        const regel = werkdag
          ? db.prepare('SELECT * FROM dagregels WHERE id = ? AND werkdag_id = ?').get(stopBijwerkenMatch[1], werkdag.id)
          : null;
        if (regel) {
          const v = await leesFormulier(req);
          werkDagregelBij(regel.id, {
            plaats: v.plaats,
            activiteit: v.activiteit,
            tijd_aankomst: v.tijd_aankomst,
            tijd_vertrek: v.tijd_vertrek,
            km_stand: v.km_stand,
          });
        }
        return redirect(res, '/chauffeur/uren');
      }

      // Ritnummer/bijzonderheden van vandaag (los formuliertje, raakt niet
      // aan de opdrachten - vandaar een eigen kleine route i.p.v. de grote
      // "hele dag opslaan"-route hierboven).
      if (methode === 'POST' && pathname === '/chauffeur/uren/ritnummer') {
        const werkdag = haalWerkdagVanVandaag(gebruiker.id);
        if (werkdag) {
          const v = await leesFormulier(req);
          db.prepare('UPDATE werkdagen SET ritnummer = ?, opmerkingen = ? WHERE id = ?').run(
            (v.ritnummer || '').trim() || null,
            (v.opmerkingen || '').trim() || null,
            werkdag.id
          );
        }
        return redirect(res, '/chauffeur/uren');
      }

      const werkdagVerwijderenMatch = pathname.match(/^\/chauffeur\/uren\/([^/]+)\/verwijderen$/);
      if (werkdagVerwijderenMatch && methode === 'POST') {
        const werkdag = haalWerkdagVoorBewerken(werkdagVerwijderenMatch[1], gebruiker.id);
        if (werkdag) db.prepare('DELETE FROM werkdagen WHERE id = ?').run(werkdag.id);
        return redirect(res, '/chauffeur/uren');
      }

      const werkdagBijwerkenMatch = pathname.match(/^\/chauffeur\/uren\/([^/]+)\/bijwerken$/);
      if (werkdagBijwerkenMatch && methode === 'POST') {
        const werkdag = haalWerkdagVoorBewerken(werkdagBijwerkenMatch[1], gebruiker.id);
        const v = await leesFormulier(req);
        if (werkdag) slaVolledigeDagOp(werkdag.id, v, { magTarief: false });
        return redirect(
          res,
          werkdag && werkdag.datum === vandaagIso() ? '/chauffeur/uren?succes=1' : `/chauffeur/uren/${werkdagBijwerkenMatch[1]}?succes=1`
        );
      }

      const werkdagDetailMatch = pathname.match(/^\/chauffeur\/uren\/([^/]+)$/);
      if (werkdagDetailMatch && methode === 'GET') {
        const werkdag = haalWerkdagVoorBewerken(werkdagDetailMatch[1], gebruiker.id);
        if (!werkdag) return stuurHtml(res, 404, 'Dag niet gevonden.');
        const opdrachten = haalOpdrachtenMetDetails(werkdag.id);
        const totalen = berekenWerkdagTotalen(werkdag, opdrachten);
        const klanten = db.prepare('SELECT * FROM klanten ORDER BY naam').all();
        return stuurHtml(
          res,
          200,
          layout({
            titel: 'Urenregistratie',
            actief: 'urenregistratie',
            gebruiker,
            inhoud: pagWerkdagDetail({
              werkdag,
              opdrachten,
              totalen,
              klanten,
              magTariefZien: false,
              actiePrefix: `/chauffeur/uren/${werkdag.id}`,
              terugUrl: '/chauffeur/uren',
              opgeslagen: url.searchParams.get('succes') === '1',
            }),
          })
        );
      }

      // ---- Push-abonnement (voor pushmeldingen) ----
      if (methode === 'POST' && pathname === '/chauffeur/push/abonneren') {
        const abonnement = await leesJson(req);
        slaPushAbonnementOp(gebruiker.id, abonnement);
        return stuurJson(res, 200, { ok: true });
      }

      if (methode === 'POST' && pathname === '/chauffeur/push/opzeggen') {
        const { endpoint } = await leesJson(req);
        verwijderPushAbonnement(endpoint);
        return stuurJson(res, 200, { ok: true });
      }

      // ---- Taken uitvoeren (laden/lossen, incl. documenten & handtekening) ----
      const taakDetailMatch = pathname.match(/^\/chauffeur\/taken\/([^/]+)$/);
      if (taakDetailMatch && methode === 'GET') {
        const taak = haalTaakVoorChauffeur(taakDetailMatch[1], gebruiker.id);
        if (!taak) return stuurHtml(res, 404, 'Taak niet gevonden.');
        const documenten = db.prepare('SELECT * FROM taak_documenten WHERE taak_id = ? ORDER BY aangemaakt_op').all(taak.id);
        return stuurHtml(res, 200, layout({ titel: 'Taak', actief: 'ritopdrachten', gebruiker, inhoud: pagTaakDetail({ taak, documenten }) }));
      }

      const taakAfrondenMatch = pathname.match(/^\/chauffeur\/taken\/([^/]+)\/afronden$/);
      if (taakAfrondenMatch && methode === 'POST') {
        const taakId = taakAfrondenMatch[1];
        const taak = haalTaakVoorChauffeur(taakId, gebruiker.id);
        if (!taak) return stuurHtml(res, 404, 'Taak niet gevonden.');

        let velden = {};
        let bestanden = [];
        try {
          ({ velden, bestanden } = await leesMultipart(req));
        } catch (fout) {
          const documenten = db.prepare('SELECT * FROM taak_documenten WHERE taak_id = ? ORDER BY aangemaakt_op').all(taak.id);
          return stuurHtml(
            res,
            400,
            layout({ titel: 'Taak', actief: 'ritopdrachten', gebruiker, inhoud: pagTaakDetail({ taak, documenten, fout: fout.message }) })
          );
        }

        const TYPE_PER_VELD = { cmr: 'cmr', pakbon: 'pakbon', foto: 'foto_schade' };
        let fotoSchadePad = null;
        for (const bestand of bestanden) {
          const type = TYPE_PER_VELD[bestand.veld];
          if (!type || !bestand.data || !bestand.data.length) continue;
          const pad = slaBestandOp(bestand.data, bestand.bestandsnaam);
          db.prepare('INSERT INTO taak_documenten (id, taak_id, type, bestandsnaam) VALUES (?, ?, ?, ?)').run(nieuweId(), taakId, type, pad);
          if (type === 'foto_schade') fotoSchadePad = pad;
        }
        if (velden.handtekening_data && velden.handtekening_data.startsWith('data:image')) {
          const base64 = velden.handtekening_data.split(',')[1];
          if (base64) {
            const pad = slaBestandOp(Buffer.from(base64, 'base64'), 'handtekening.png');
            db.prepare('INSERT INTO taak_documenten (id, taak_id, type, bestandsnaam) VALUES (?, ?, ?, ?)').run(
              nieuweId(),
              taakId,
              'handtekening',
              pad
            );
          }
        }
        if ((velden.incident_omschrijving && velden.incident_omschrijving.trim()) || fotoSchadePad) {
          db.prepare('INSERT INTO incidenten (id, taak_id, chauffeur_id, omschrijving, foto_bestandsnaam) VALUES (?, ?, ?, ?, ?)').run(
            nieuweId(),
            taakId,
            gebruiker.id,
            (velden.incident_omschrijving && velden.incident_omschrijving.trim()) || 'Foto schade toegevoegd bij taak, zie bijlage.',
            fotoSchadePad
          );
        }
        db.prepare("UPDATE taken SET status = 'afgerond', afgerond_op = datetime('now'), chauffeur_opmerking = ? WHERE id = ?").run(
          velden.chauffeur_opmerking || null,
          taakId
        );
        if (taak.type === 'lossen' && taak.klant_email) {
          const onderwerp = 'Uw zending is afgeleverd';
          const tekst = `Beste ${taak.klant_naam || 'klant'},\n\nUw zending op adres ${taak.adres} is afgeleverd.\n\nMet vriendelijke groet,\n${branding.bedrijfsnaam}`;
          stuurKlantEmail({ naar: taak.klant_email, onderwerp, tekst }).catch(() => {});
        }
        return redirect(res, '/chauffeur/ritopdrachten');
      }
    }

    stuurHtml(res, 404, layout({ titel: 'Niet gevonden', gebruiker, inhoud: '<h1>Pagina niet gevonden</h1>' }));
  } catch (fout) {
    console.error('Serverfout:', fout);
    stuurHtml(res, 500, '<h1>Er ging iets mis</h1><p>Probeer het opnieuw.</p>');
  }
});

zorgVoorEersteBeheerder();

startAutomatischeBackups();

server.listen(POORT, () => {
  console.log(`Transport-app draait op http://localhost:${POORT}`);
});

// Netjes afsluiten bij "docker stop" / redeploy via Portainer: eerst de
// database wegschrijven (WAL-checkpoint), dan stoppen.
function afsluiten(signaal) {
  console.log(`[${signaal}] Transport-app wordt afgesloten...`);
  server.close();
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.close();
  } catch {
    // al gesloten
  }
  process.exit(0);
}
process.on('SIGTERM', () => afsluiten('SIGTERM'));
process.on('SIGINT', () => afsluiten('SIGINT'));
