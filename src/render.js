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

// ---- Iconen: eigen inline SVG-lijniconen (24 × 24, lijndikte 2), zoals WorkPortal ----
const ICONEN = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  klanten: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5"/>',
  beheer: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  home: '<path d="M3 11l9-7 9 7v9H3z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  nacalculatie: '<path d="M3 3v18h18M7 15l4-4 3 3 5-6"/>',
  calculatie: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>',
  order: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  project: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  kalender: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  waarschuwing: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  euro: '<path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  kopie: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  stuur: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 14v7M10.2 11L3.5 9.5M13.8 11l6.7-1.5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
};

export function icoon(naam) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONEN[naam] || ''}</svg>`;
}

export const APP_VERSIE = '3.0.0';

function kanModule(gebruiker, module) {
  return !!gebruiker && ((gebruiker.rechten || {})[module] || 0) >= 1;
}

// Menu: groepen met koppen, zoals in WorkPortal. [href, label, icoon, actief-sleutel, module]
function menuGroepen(gebruiker) {
  const mijnwerk = kanModule(gebruiker, 'mijnwerk');
  return [
    [null, [[mijnwerk ? '/chauffeur' : '/planner/dashboard', 'Dashboard', 'dashboard', mijnwerk ? 'dashboard' : 'bedrijfsdashboard', null]]],
    ['Mijn werk', [
      ['/chauffeur/ritopdrachten', 'Ritopdrachten', 'route', 'ritopdrachten', 'mijnwerk'],
      ['/chauffeur/uren', 'Urenregistratie', 'timer', 'urenregistratie', 'mijnwerk'],
      ['/chauffeur/weekoverzicht', 'Mijn weekoverzicht', 'kalender', 'weekoverzicht', 'mijnwerk'],
      ['/chauffeur/meldingen', 'Meldingen & schade', 'waarschuwing', 'meldingen', 'mijnwerk'],
    ]],
    ['Planning', [
      ...(mijnwerk ? [['/planner/dashboard', 'Bedrijfsdashboard', 'nacalculatie', 'bedrijfsdashboard', 'planning']] : []),
      ['/planner', 'Ritten', 'truck', 'ritten', 'planning'],
      ['/planner/sjablonen', 'Sjablonen', 'kopie', 'sjablonen', 'planning'],
    ]],
    ['Overzichten & financiën', [
      ['/planner/week-uitdraai', 'Weekoverzicht', 'kalender', 'week-uitdraai', 'overzichten'],
      ['/planner/financieel', 'Financieel', 'euro', 'financieel', 'overzichten'],
      ['/planner/prijscalculator', 'Prijscalculator', 'calculatie', 'prijscalculator', 'overzichten'],
    ]],
    ['Wagenpark', [
      ['/planner/voertuigen', 'Voertuigen', 'truck', 'voertuigen', 'wagenpark'],
      ['/planner/incidenten', 'Incidenten', 'waarschuwing', 'incidenten', 'wagenpark'],
    ]],
    ['Relaties', [
      ['/planner/klanten', 'Klanten', 'klanten', 'klanten', 'relaties'],
      ['/planner/tarieven', 'Tarieven', 'tag', 'tarieven', 'relaties'],
      ['/planner/chauffeurs', 'Chauffeurs', 'stuur', 'chauffeurs', 'chauffeurs'],
    ]],
    ['Systeem', [['/beheer/gebruikers', 'Beheer', 'beheer', 'beheer', 'beheer']]],
  ]
    .map(([kop, items]) => [kop, items.filter((i) => !i[4] || kanModule(gebruiker, i[4]))])
    .filter(([, items]) => items.length);
}

const BEHEER_SLEUTELS = ['beheer', 'backups', 'beheer-rechten', 'beheer-instellingen', 'beheer-logboek'];

function navHtml(gebruiker, actief) {
  return menuGroepen(gebruiker)
    .map(([kop, items]) =>
      (kop ? `<div class="navhead">${escapeHtml(kop)}</div>` : '') +
      items
        .map(([href, label, ico, sleutel]) => {
          const isActief = sleutel === actief || (sleutel === 'beheer' && BEHEER_SLEUTELS.includes(actief));
          return `<a href="${href}" class="${isActief ? 'active' : ''}">${icoon(ico)}<span>${escapeHtml(label)}</span></a>`;
        })
        .join('')
    )
    .join('');
}

function initialen(naam) {
  const delen = String(naam || '').trim().split(/\s+/);
  return ((delen[0] || '')[0] || '').toUpperCase() + (delen.length > 1 ? (delen[delen.length - 1][0] || '').toUpperCase() : '');
}

// Onderbalk op de telefoon: Start + de eerste drie toegestane snelkoppelingen + Meer.
function onderbalkHtml(gebruiker, actief) {
  const opties = [
    ['/chauffeur/ritopdrachten', 'Ritten', 'route', ['ritopdrachten'], 'mijnwerk'],
    ['/chauffeur/uren', 'Uren', 'timer', ['urenregistratie'], 'mijnwerk'],
    ['/planner', 'Planning', 'truck', ['ritten', 'sjablonen', 'bedrijfsdashboard'], 'planning'],
    ['/chauffeur/meldingen', 'Meldingen', 'waarschuwing', ['meldingen'], 'mijnwerk'],
    ['/planner/voertuigen', 'Wagenpark', 'truck', ['voertuigen', 'incidenten'], 'wagenpark'],
    ['/planner/klanten', 'Klanten', 'klanten', ['klanten', 'tarieven'], 'relaties'],
  ].filter((o) => kanModule(gebruiker, o[4]));
  const mijnwerk = kanModule(gebruiker, 'mijnwerk');
  const snel = opties.slice(0, 3);
  const inSnel = snel.some((o) => o[3].includes(actief));
  const start = mijnwerk ? '/chauffeur' : '/planner/dashboard';
  return `<nav class="bottomnav" aria-label="Snelmenu">
  <a href="${start}" class="${actief === 'dashboard' || (!mijnwerk && actief === 'bedrijfsdashboard') ? 'active' : ''}">${icoon('home')}Start</a>
  ${snel.map(([href, label, ico, sleutels]) => `<a href="${href}" class="${sleutels.includes(actief) ? 'active' : ''}">${icoon(ico)}${label}</a>`).join('\n  ')}
  <a href="/menu" class="${actief === 'menu' || (!inSnel && actief !== 'dashboard' && !(actief === 'bedrijfsdashboard' && !mijnwerk)) ? 'active' : ''}">${icoon('menu')}Meer</a>
</nav>`;
}

function headHtml(titel) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0A0A96">
<title>${escapeHtml(titel)} – ${escapeHtml(branding.appNaam)}</title>
<meta name="application-name" content="${escapeHtml(branding.appNaam)}">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(branding.appNaam)}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.ico?v=${APP_VERSIE}" sizes="any">
<link rel="icon" type="image/png" sizes="192x192" href="/img/wp-round-192.png?v=${APP_VERSIE}">
<link rel="apple-touch-icon" sizes="180x180" href="/img/wp-app-180.png?v=${APP_VERSIE}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/styles.css?v=${APP_VERSIE}">`;
}

/** Het menu als losse pagina (telefoon: "Meer"). */
export function menuPaginaInhoud(gebruiker) {
  return `<h1>Menu</h1>
<div class="card flush"><div class="nav" style="padding:8px">
  ${navHtml(gebruiker, 'menu')}
  <div class="navhead">Persoonlijk</div>
  <a href="/account">${icoon('bell')}<span>Mijn account &amp; meldingen</span></a>
</div></div>
<p class="small muted">${escapeHtml(branding.appNaamKort)} v${APP_VERSIE} · ${escapeHtml(gebruiker.naam)} · ${escapeHtml(gebruiker.rolNamen || '')}</p>`;
}

export function layout({ titel, actief, gebruiker, inhoud, melding }) {
  if (!gebruiker) {
    return `<!doctype html><html lang="nl"><head>${headHtml(titel)}</head><body><main class="content">${inhoud}</main></body></html>`;
  }
  const isChauffeur = gebruiker.rol === 'chauffeur';
  const sub = `${gebruiker.is_beheerder ? 'Beheerder · ' : ''}${gebruiker.rolNamen || ''}`;
  return `<!doctype html>
<html lang="nl">
<head>
${headHtml(titel)}
${isChauffeur && vapidPublicKey() ? `<meta name="vapid-public-key" content="${escapeHtml(vapidPublicKey())}">` : ''}
</head>
<body>
<div class="app">
  <nav class="sidebar" aria-label="Hoofdmenu">
    <a class="brand" href="/">
      <img src="${branding.logoUrl}" alt="${escapeHtml(branding.bedrijfsnaam)}">
      <span>${escapeHtml(branding.appLabel)}</span>
    </a>
    <div class="nav">${navHtml(gebruiker, actief)}</div>
    <div style="margin-top:auto" class="small muted">
      <div style="padding:0 8px"><a href="/account" style="text-decoration:none">Mijn account &amp; meldingen</a><br>
      <span>${escapeHtml(branding.appNaamKort)} v${APP_VERSIE}</span></div>
    </div>
  </nav>
  <div class="main">
    <header class="topbar">
      <form class="search" action="/zoeken" method="get" role="search">
        ${icoon('search')}<input type="search" name="q" placeholder="Zoek rit, klant, kenteken of chauffeur" aria-label="Zoeken">
      </form>
      <div class="userbox">
        <div class="who"><b>${escapeHtml(gebruiker.naam)}</b><span>${escapeHtml(sub)}</span></div>
        <a class="avatar" href="/account" style="text-decoration:none;color:#fff" aria-label="Mijn account">${escapeHtml(initialen(gebruiker.naam))}</a>
        <form method="post" action="/vergrendelen"><button class="iconbtn" title="Vergrendelen" aria-label="Vergrendelen">${icoon('lock')}</button></form>
      </div>
    </header>
    <header class="mobile-top">
      <a href="/"><img src="${branding.logoWitUrl}" alt="${escapeHtml(branding.bedrijfsnaam)}"></a>
      <div class="actions" style="gap:8px">
        <a class="iconbtn" href="/zoeken" aria-label="Zoeken">${icoon('search')}</a>
        <a class="iconbtn" href="/account" aria-label="Mijn account">${icoon('bell')}</a>
        <form method="post" action="/vergrendelen"><button class="iconbtn" aria-label="Vergrendelen">${icoon('lock')}</button></form>
      </div>
    </header>
    <main class="content inhoud">
${melding ? `<div class="flash ${melding.type === 'fout' ? 'error' : melding.type === 'succes' ? 'ok' : 'info'}">${escapeHtml(melding.tekst)}</div>` : ''}
${inhoud}
    </main>
  </div>
</div>
${onderbalkHtml(gebruiker, actief)}
<script src="/app.js?v=${APP_VERSIE}" defer></script>
</body>
</html>`;
}

/** Inlogschermen: wit, gecentreerde kaart met het label in accentblauw (zoals WorkPortal). */
export function authPagina(titel, inhoud) {
  return `<!doctype html>
<html lang="nl">
<head>
${headHtml(titel)}
</head>
<body class="authbody">
<main class="auth">
  <div class="auth-card">
    <div class="auth-brand">
      <img class="logo" src="${branding.logoUrl}" alt="${escapeHtml(branding.bedrijfsnaam)}">
      <div class="eyebrow">${escapeHtml(branding.appLabel)}</div>
    </div>
    ${inhoud}
  </div>
</main>
</body>
</html>`;
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
