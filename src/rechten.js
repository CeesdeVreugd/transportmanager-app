// Rechten per module, op vier niveaus — zelfde opzet als WorkPortal:
// Geen (0) · Lezen (1) · Bewerken (2) · Beheer (3, ook verwijderen).
//
// Rechten berekenen:
//  1. Beheerder aangevinkt → overal Beheer.
//  2. Anders per module het hoogste niveau van alle functierollen.
//  3. Daarbovenop extra rechten per gebruiker; ook dan telt het hoogste niveau.
import db, { initialiseerRollen } from './db.js';

export const GEEN = 0;
export const LEZEN = 1;
export const BEWERKEN = 2;
export const BEHEER = 3;
export const NIVEAU_NAMEN = { 0: 'Geen', 1: 'Lezen', 2: 'Bewerken', 3: 'Beheer' };

export const MODULES = [
  ['mijnwerk', 'Mijn werk (ritopdrachten, uren, meldingen)'],
  ['planning', 'Planning (dashboard, ritten, sjablonen)'],
  ['overzichten', 'Weekoverzicht, financieel & prijscalculator'],
  ['wagenpark', 'Wagenpark (voertuigen & incidenten)'],
  ['relaties', 'Relaties (klanten & tarieven)'],
  ['chauffeurs', 'Chauffeurs & uren'],
  ['beheer', 'Beheer (gebruikers, rechten & back-ups)'],
];
export const MODULE_SLEUTELS = MODULES.map(([m]) => m);
export const MODULE_LABELS = Object.fromEntries(MODULES);

// Modules gegroepeerd onder koppen (menu en rechtenpagina)
export const MODULE_GROEPEN = [
  ['Mijn werk', ['mijnwerk']],
  ['Planning', ['planning']],
  ['Overzichten & financiën', ['overzichten']],
  ['Wagenpark', ['wagenpark']],
  ['Relaties', ['relaties', 'chauffeurs']],
  ['Systeem', ['beheer']],
];

// Functierollen (sleutel, naam). De kleuren staan in de CSS (.role-<sleutel>).
export const ROLLEN = [
  ['administratie', 'Administratie'],
  ['directie', 'Directie'],
  ['planning', 'Planning'],
  ['chauffeur', 'Chauffeur'],
];

// Beginstand, aan te passen in Beheer → Rechten per functierol.
export const STANDAARD_MATRIX = {
  mijnwerk: { administratie: 0, directie: 2, planning: 2, chauffeur: 2 },
  planning: { administratie: 1, directie: 3, planning: 3, chauffeur: 0 },
  overzichten: { administratie: 3, directie: 3, planning: 2, chauffeur: 0 },
  wagenpark: { administratie: 1, directie: 3, planning: 3, chauffeur: 0 },
  relaties: { administratie: 3, directie: 3, planning: 2, chauffeur: 0 },
  chauffeurs: { administratie: 2, directie: 3, planning: 2, chauffeur: 0 },
  beheer: { administratie: 3, directie: 3, planning: 0, chauffeur: 0 },
};

initialiseerRollen({ ROLLEN, STANDAARD_MATRIX });

export function laadRechten(gebruiker) {
  const rechten = Object.fromEntries(MODULE_SLEUTELS.map((m) => [m, 0]));
  if (!gebruiker) return rechten;
  if (gebruiker.is_beheerder) return Object.fromEntries(MODULE_SLEUTELS.map((m) => [m, BEHEER]));
  for (const r of db
    .prepare(
      `SELECT rr.module, MAX(rr.niveau) AS niveau FROM rol_rechten rr
       JOIN gebruiker_rollen gr ON gr.rol_id = rr.rol_id WHERE gr.gebruiker_id = ? GROUP BY rr.module`
    )
    .all(gebruiker.id)) {
    rechten[r.module] = r.niveau;
  }
  for (const r of db.prepare('SELECT module, niveau FROM gebruiker_rechten WHERE gebruiker_id = ?').all(gebruiker.id)) {
    rechten[r.module] = Math.max(rechten[r.module] || 0, r.niveau);
  }
  return rechten;
}

export function kan(gebruiker, module, niveau = LEZEN) {
  return !!gebruiker && ((gebruiker.rechten || {})[module] || 0) >= niveau;
}

export function rollenVanGebruiker(gebruikerId) {
  return db
    .prepare(
      `SELECT f.* FROM functierollen f JOIN gebruiker_rollen gr ON gr.rol_id = f.id
       WHERE gr.gebruiker_id = ? ORDER BY f.volgorde`
    )
    .all(gebruikerId);
}

/** Houdt de oude kolom "rol" in lijn: wie de functierol Chauffeur heeft, is chauffeur. */
export function synchroniseerRolKolom(gebruikerId) {
  const isChauffeur = db
    .prepare(
      `SELECT 1 FROM gebruiker_rollen gr JOIN functierollen f ON f.id = gr.rol_id
       WHERE gr.gebruiker_id = ? AND f.sleutel = 'chauffeur'`
    )
    .get(gebruikerId);
  db.prepare('UPDATE gebruikers SET rol = ? WHERE id = ?').run(isChauffeur ? 'chauffeur' : 'planner', gebruikerId);
}

/**
 * Welke module (en welk minimaal niveau) hoort bij een adres? Elk scherm valt
 * zo centraal onder één module: bekijken = Lezen, opslaan = Bewerken,
 * verwijderen/deactiveren = Beheer.
 */
export function vereisteVoorPad(pathname, methode) {
  let module = null;
  if (pathname.startsWith('/chauffeur')) module = 'mijnwerk';
  else if (pathname.startsWith('/beheer') || pathname.startsWith('/planner/backups')) module = 'beheer';
  else if (/^\/planner\/(voertuigen|incidenten)(\/|$)/.test(pathname)) module = 'wagenpark';
  else if (/^\/planner\/(klanten|tarieven)(\/|$)/.test(pathname)) module = 'relaties';
  else if (/^\/planner\/chauffeurs(\/|$)/.test(pathname)) module = 'chauffeurs';
  else if (/^\/planner\/(week-uitdraai|financieel|prijscalculator)(\/|$|\.)/.test(pathname)) module = 'overzichten';
  else if (pathname === '/planner' || pathname.startsWith('/planner/')) module = 'planning';
  if (!module) return null;

  let niveau = LEZEN;
  if (methode !== 'GET' && methode !== 'HEAD') {
    niveau = /\/(verwijderen|deactiveren)$/.test(pathname) ? BEHEER : BEWERKEN;
    // Eigen werk (eigen uren/meldingen corrigeren of wissen) valt onder Bewerken.
    if (module === 'mijnwerk') niveau = BEWERKEN;
    // Berekenen zonder op te slaan: lezen is genoeg.
    if (pathname === '/planner/route-berekenen') niveau = LEZEN;
    // Eigen pushmeldingen en "gelezen" zetten mag iedereen met toegang tot Mijn werk.
    if (/^\/chauffeur\/(push|notificaties)\//.test(pathname)) niveau = LEZEN;
  }
  return { module, niveau };
}
