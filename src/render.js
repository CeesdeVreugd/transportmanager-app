import branding from './branding.js';
import { vapidPublicKey } from './push.js';

export function escapeHtml(waarde) {
  if (waarde === null || waarde === undefined) return '';
  return String(waarde)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function layout({ titel, actief, gebruiker, inhoud, melding }) {
  const navItem = (href, label, key) =>
    `<a href="${href}" class="navlink${actief === key ? ' actief' : ''}">${label}</a>`;

  // Basismenu: exact hetzelfde voor iedereen (chauffeur én beheerder) - dit is
  // het dagelijkse-werk-menu (eigen dag, uren, weekoverzicht). De beheerder
  // krijgt daar bovenop nog een los "Beheer"-menu met de bedrijfsfuncties.
  const basisMenuItems = [
    ['/chauffeur', 'Dashboard', 'dashboard'],
    ['/chauffeur/ritopdrachten', 'Planning', 'ritopdrachten'],
    ['/chauffeur/uren', 'Urenregistratie', 'urenregistratie'],
    ['/chauffeur/weekoverzicht', 'Weekoverzicht', 'weekoverzicht'],
    ['/chauffeur/meldingen', 'Meldingen', 'meldingen'],
    ['/account/instellingen', 'Instellingen', 'instellingen'],
  ];

  const beheerGroepen = [
    {
      naam: 'Overzichten',
      items: [
        ['/planner/dashboard', 'Dashboard', 'beheer-dashboard'],
        ['/planner', 'Ritten', 'ritten'],
        ['/planner/sjablonen', 'Sjablonen', 'sjablonen'],
        ['/planner/week-uitdraai', 'Weekoverzicht', 'week-uitdraai'],
        ['/planner/financieel', 'Financieel', 'financieel'],
        ['/planner/prijscalculator', 'Prijscalculator', 'prijscalculator'],
      ],
    },
    {
      naam: 'Wagenpark',
      items: [
        ['/planner/voertuigen', 'Voertuigen', 'voertuigen'],
        ['/planner/incidenten', 'Incidenten', 'incidenten'],
      ],
    },
    {
      naam: 'Relaties',
      items: [
        ['/planner/klanten', 'Klanten', 'klanten'],
        ['/planner/tarieven', 'Tarieven', 'tarieven'],
        ['/planner/chauffeurs', 'Chauffeurs', 'chauffeurs'],
      ],
    },
    {
      naam: 'Beheer',
      items: [['/planner/backups', 'Back-ups', 'backups']],
    },
  ];

  const basisMenuHtml = `<details class="navgroup chauffeurmenu" name="navgroep"><summary class="navlink">☰ Menu</summary><div class="navdropdown">${basisMenuItems
    .map(([href, label, key]) => navItem(href, label, key))
    .join('')}</div></details>`;

  const beheerMenuHtml = beheerGroepen
    .map((groep) => {
      const heeftActief = groep.items.some(([, , key]) => key === actief);
      const links = groep.items.map(([href, label, key]) => navItem(href, label, key)).join('');
      return `<details class="navgroup" name="navgroep"><summary class="navlink${heeftActief ? ' actief' : ''}">${groep.naam}</summary><div class="navdropdown">${links}</div></details>`;
    })
    .join('');

  const nav = gebruiker ? basisMenuHtml + (gebruiker.rol === 'planner' ? beheerMenuHtml : '') : '';
  const topnavClass = 'topnav topnav-chauffeur';

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(titel)} · ${escapeHtml(branding.bedrijfsnaam)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#ffffff">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="icon" href="/icons/favicon.png">
<link rel="stylesheet" href="/styles.css">
<style>:root{--kleur-primair:${branding.kleurPrimair};--kleur-primair-donker:${branding.kleurPrimairDonker};--kleur-accent:${branding.kleurAccent};--kleur-tekst-op-primair:${branding.kleurTekstOpPrimair};--lettertype:${branding.lettertype};}</style>
${gebruiker && gebruiker.rol === 'chauffeur' && vapidPublicKey() ? `<meta name="vapid-public-key" content="${escapeHtml(vapidPublicKey())}">` : ''}
</head>
<body>
${gebruiker ? `
<header class="topbar">
  <a href="/" class="topbar-merk" aria-label="Naar beginscherm">
    ${branding.logoUrl ? `<img src="${branding.logoUrl}" alt="${escapeHtml(branding.bedrijfsnaam)}" class="logo">` : `<span>${escapeHtml(branding.bedrijfsnaam)}</span><span class="merk-subtitel">Transport</span>`}
  </a>
  <nav class="${topnavClass}">${nav}</nav>
  <div class="topbar-gebruiker">
    <span>${escapeHtml(gebruiker.naam)}</span>
    <form method="post" action="/uitloggen" class="inline-form">
      <button type="submit" class="link-knop">Uitloggen</button>
    </form>
  </div>
</header>` : ''}
<main class="inhoud">
${melding ? `<div class="melding melding-${melding.type}">${escapeHtml(melding.tekst)}</div>` : ''}
${inhoud}
</main>
<script src="/app.js" defer></script>
</body>
</html>`;
}

// Gedeelde pagina-romp voor alle inlogschermen (hoofdlogin, chauffeur-
// codelogin-kiezer, code-invoer) - scheelt herhaling van de <head>.
function loginSkeleton(titel, inhoud) {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titel)} · ${escapeHtml(branding.bedrijfsnaam)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="${branding.kleurPrimair}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="icon" href="/icons/favicon.png">
<link rel="stylesheet" href="/styles.css">
<style>:root{--kleur-primair:${branding.kleurPrimair};--kleur-primair-donker:${branding.kleurPrimairDonker};--kleur-accent:${branding.kleurAccent};--kleur-tekst-op-primair:${branding.kleurTekstOpPrimair};--lettertype:${branding.lettertype};}</style>
</head>
<body class="login-body">
<main class="login-kaart">
  ${branding.logoUrl ? `<img src="${branding.logoUrl}" alt="${escapeHtml(branding.bedrijfsnaam)}" class="login-logo">` : `<h1>${escapeHtml(branding.bedrijfsnaam)}</h1><p class="login-subtitel">Transport</p>`}
  ${inhoud}
</main>
</body>
</html>`;
}

export function loginPagina({ fout } = {}) {
  return loginSkeleton(
    'Inloggen',
    `${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
  <form method="post" action="/inloggen" class="form">
    <label>E-mailadres
      <input type="email" name="email" required autofocus>
    </label>
    <label>Wachtwoord
      <input type="password" name="wachtwoord" required>
    </label>
    <button type="submit" class="knop knop-primair">Inloggen</button>
  </form>
  <p style="text-align:center;margin-top:1rem;"><a href="/chauffeur-login">Chauffeur? Log in met je persoonlijke code</a></p>`
  );
}

// ---- Chauffeur: inloggen met een persoonlijke code in plaats van
// e-mail/wachtwoord. Stap 1: kies wie je bent; stap 2: voer je code in (of
// stel er - bij eerste gebruik - zelf één in). ----
export function chauffeurLoginKiezerPagina({ chauffeurs = [] } = {}) {
  const knoppen = chauffeurs.length
    ? chauffeurs.map((c) => `<a href="/chauffeur-login/${c.id}" class="knop knop-primair" style="display:block;margin-bottom:0.6rem;">${escapeHtml(c.naam)}</a>`).join('')
    : `<p class="rit-meta">Nog geen chauffeurs ingesteld.</p>`;
  return loginSkeleton(
    'Chauffeur inloggen',
    `<p class="rit-meta" style="text-align:center;margin-top:0;">Wie ben jij?</p>
  ${knoppen}
  <p style="text-align:center;margin-top:1rem;"><a href="/login">Inloggen met e-mail en wachtwoord</a></p>`
  );
}

export function chauffeurLoginCodePagina({ chauffeur, heeftPincode, fout } = {}) {
  return loginSkeleton(
    `Inloggen · ${chauffeur.naam}`,
    `<p class="rit-meta" style="text-align:center;margin-top:0;">${escapeHtml(chauffeur.naam)}</p>
  ${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
  ${
    heeftPincode
      ? `<form method="post" action="/chauffeur-login/${chauffeur.id}" class="form">
          <label>Jouw code
            <input type="password" inputmode="numeric" pattern="[0-9]*" name="code" required autofocus autocomplete="off">
          </label>
          <button type="submit" class="knop knop-primair">Inloggen</button>
        </form>`
      : `<p class="rit-meta">Je hebt nog geen persoonlijke code. Kies er hier zelf één (4 tot 6 cijfers) - die gebruik je vanaf nu om in te loggen.</p>
        <form method="post" action="/chauffeur-login/${chauffeur.id}/instellen" class="form">
          <label>Nieuwe code
            <input type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" name="nieuwe_code" required autofocus autocomplete="off">
          </label>
          <label>Nieuwe code herhalen
            <input type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" name="nieuwe_code_herhaald" required autocomplete="off">
          </label>
          <button type="submit" class="knop knop-primair">Code instellen en inloggen</button>
        </form>`
  }
  <p style="text-align:center;margin-top:1rem;"><a href="/chauffeur-login">← Ik ben iemand anders</a></p>`
  );
}

export function statusLabel(status) {
  const labels = {
    gepland: 'Gepland',
    onderweg: 'Onderweg',
    afgerond: 'Afgerond',
    geannuleerd: 'Geannuleerd',
  };
  return labels[status] || status;
}
