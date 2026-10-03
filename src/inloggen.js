// Inloggen zonder wachtwoord — zelfde werking als WorkPortal:
//
//  Eerste keer op een apparaat
//   1. E-mailadres invullen. Altijd dezelfde melding (niet te zien of een adres bestaat).
//   2. Code van 6 cijfers per mail, 10 minuten geldig. Een nieuwe code maakt de vorige
//      ongeldig. Maximaal 5 codes per kwartier.
//   3. Code invullen, maximaal 5 pogingen per code. Het apparaat wordt geregistreerd met
//      cookie tm_apparaat (willekeurige sleutel, 400 dagen, HttpOnly, SameSite=Lax).
//   4. Pincode instellen: 4 tot 8 cijfers (minimum instelbaar); 1111, 1234, 4321 e.d. geweigerd.
//  Daarna opent de app direct het pinscherm. Na 5 foute pincodes worden pincode en
//  verificatie van het apparaat gewist en is weer een e-mailcode nodig.
//
//  Instellingen (Beheer → Instellingen): verify_days (14), unlock_hours (12), pin_min_length (4).
//  Codes en apparaatsleutels: HMAC-SHA256 met SECRET_KEY. Pincodes: PBKDF2-SHA256, 200.000
//  rondes, eigen salt per apparaat. Wie SECRET_KEY wijzigt, logt iedereen uit.
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomInt, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import db, { DATA_DIR, appInstelling, nieuweId } from './db.js';
import { parseCookies } from './auth.js';
import { laadRechten, rollenVanGebruiker } from './rechten.js';
import { verstuurMail, codeMailHtml, mailIngesteld } from './mail.js';
import { authPagina, escapeHtml } from './render.js';
import branding from './branding.js';

export const APPARAAT_COOKIE = 'tm_apparaat';
const SESSIE_COOKIE = 'sessie';
const LOGIN_COOKIE = 'tm_login';
const CODE_MINUTEN = 10;
const MAX_CODE_POGINGEN = 5;
const MAX_PIN_POGINGEN = 5;
const SESSIE_DAGEN = 30;

// ---- Geheime sleutel ----
let geheim = process.env.SECRET_KEY || '';
if (!geheim || geheim.length < 40) {
  const pad = path.join(DATA_DIR, 'secret_key');
  try {
    geheim = fs.readFileSync(pad, 'utf8').trim();
  } catch {
    geheim = '';
  }
  if (!geheim) {
    geheim = randomBytes(48).toString('hex');
    fs.writeFileSync(pad, geheim, { mode: 0o600 });
    console.log('[TransportManager] SECRET_KEY niet ingesteld: zelf aangemaakt in /data/secret_key');
  }
}

export function hashGeheim(waarde) {
  return createHmac('sha256', geheim).update(String(waarde)).digest('hex');
}

function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pin, salt, 200000, 32, 'sha256');
  return `pbkdf2_sha256$200000$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function controleerPin(pin, opgeslagen) {
  try {
    const [, rondes, saltHex, hashHex] = opgeslagen.split('$');
    const verwacht = Buffer.from(hashHex, 'hex');
    const gevonden = pbkdf2Sync(pin, Buffer.from(saltHex, 'hex'), Number(rondes), verwacht.length, 'sha256');
    return timingSafeEqual(gevonden, verwacht);
  } catch {
    return false;
  }
}

// ---- Instellingen ----
const getal = (v, std) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : std;
};
export const verifyDagen = () => getal(appInstelling('verify_days'), 14);
export const ontgrendelUren = () => getal(appInstelling('unlock_hours'), 12);
export const pinMinLengte = () => Math.min(8, Math.max(4, getal(appInstelling('pin_min_length'), 4)));

const nu = () => new Date();
const iso = (d) => d.toISOString();
const veiligSecure = () => (process.env.APP_URL || '').startsWith('https');

function cookie(naam, waarde, { maxAge, verwijder = false } = {}) {
  let c = `${naam}=${verwijder ? '' : encodeURIComponent(waarde)}; Path=/; HttpOnly; SameSite=Lax`;
  if (veiligSecure()) c += '; Secure';
  if (verwijder) c += '; Max-Age=0';
  else if (maxAge) c += `; Max-Age=${maxAge}`;
  return c;
}

// Kleine, ondertekende cookie voor de stappen tussen e-mail, code en pincode.
function teken(obj) {
  const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${data}.${hashGeheim('login:' + data).slice(0, 32)}`;
}
function leesGetekend(waarde) {
  if (!waarde || !waarde.includes('.')) return null;
  const [data, sig] = waarde.split('.');
  if (hashGeheim('login:' + data).slice(0, 32) !== sig) return null;
  try {
    const obj = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (obj.tot && obj.tot < Date.now()) return null;
    return obj;
  } catch {
    return null;
  }
}

function veiligeVolgende(doel) {
  return doel && doel.startsWith('/') && !doel.startsWith('//') ? doel : '/';
}

function maskeer(email) {
  if (!email.includes('@')) return email;
  const [naam, domein] = email.split('@');
  return `${naam.slice(0, 1)}${'•'.repeat(Math.max(2, naam.length - 1))}@${domein}`;
}

export function logActie(gebruiker, actie, onderdeel = null, onderdeelId = null, details = null) {
  db.prepare(
    'INSERT INTO logboek (gebruiker_id, wie, actie, onderdeel, onderdeel_id, details, aangemaakt_op) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(gebruiker ? gebruiker.id : null, gebruiker ? gebruiker.naam : null, actie, onderdeel, onderdeelId ? String(onderdeelId) : null, details, iso(nu()));
}

// ---- Apparaat en sessie ----
function huidigApparaat(cookies) {
  const tok = cookies[APPARAAT_COOKIE];
  if (!tok) return null;
  return db.prepare('SELECT * FROM apparaten WHERE token_hash = ?').get(hashGeheim(tok)) || null;
}

function apparaatGeverifieerd(apparaat) {
  if (!apparaat || !apparaat.geverifieerd_op) return false;
  return nu() - new Date(apparaat.geverifieerd_op) < verifyDagen() * 864e5;
}

/**
 * Geeft de ingelogde (ontgrendelde) gebruiker terug, met rechten, functierollen
 * en apparaat — of null. Controleert bij elke aanvraag of het apparaat nog bij
 * de gebruiker hoort, nog geverifieerd is en of de gebruiker nog actief is.
 */
export function huidigeGebruiker(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSIE_COOKIE];
  if (!token) return null;
  const sessie = db.prepare('SELECT * FROM sessies WHERE token = ?').get(hashGeheim(token));
  if (!sessie || !sessie.apparaat_id || !sessie.ontgrendeld_op) return null;
  if (new Date(sessie.verloopt_op) < nu()) return null;
  if (nu() - new Date(sessie.ontgrendeld_op) > ontgrendelUren() * 36e5) return null;
  const apparaat = huidigApparaat(cookies);
  if (!apparaat || apparaat.id !== sessie.apparaat_id || apparaat.gebruiker_id !== sessie.gebruiker_id || !apparaatGeverifieerd(apparaat)) {
    return null;
  }
  const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE id = ? AND actief = 1').get(sessie.gebruiker_id);
  if (!gebruiker) return null;
  gebruiker.rechten = laadRechten(gebruiker);
  gebruiker.rollen = rollenVanGebruiker(gebruiker.id);
  gebruiker.rolNamen = gebruiker.rollen.map((r) => r.naam).join(', ');
  gebruiker.apparaat = apparaat;
  return gebruiker;
}

function ontgrendel(gebruikerId, apparaatId) {
  const token = randomBytes(32).toString('hex');
  const verloopt = new Date(Date.now() + SESSIE_DAGEN * 864e5);
  db.prepare('DELETE FROM sessies WHERE verloopt_op < ?').run(iso(nu()));
  db.prepare(
    'INSERT INTO sessies (token, gebruiker_id, verloopt_op, apparaat_id, ontgrendeld_op) VALUES (?, ?, ?, ?, ?)'
  ).run(hashGeheim(token), gebruikerId, iso(verloopt), apparaatId, iso(nu()));
  db.prepare('UPDATE gebruikers SET laatst_ingelogd = ? WHERE id = ?').run(iso(nu()), gebruikerId);
  db.prepare('UPDATE apparaten SET laatst_gebruikt = ?, pin_pogingen = 0 WHERE id = ?').run(iso(nu()), apparaatId);
  return cookie(SESSIE_COOKIE, token, { maxAge: SESSIE_DAGEN * 86400 });
}

/** Alle apparaten (en sessies) van een gebruiker afmelden. */
export function meldAlleApparatenAf(gebruikerId) {
  db.prepare('DELETE FROM sessies WHERE gebruiker_id = ?').run(gebruikerId);
  db.prepare('DELETE FROM apparaten WHERE gebruiker_id = ?').run(gebruikerId);
}

export function verwijderApparaat(apparaatId) {
  db.prepare('DELETE FROM sessies WHERE apparaat_id = ?').run(apparaatId);
  db.prepare('DELETE FROM apparaten WHERE id = ?').run(apparaatId);
}

/** Welkomstmail bij een nieuw account. */
export async function stuurWelkomstmail(gebruiker) {
  const adres = (process.env.APP_URL || '').replace(/\/+$/, '') || 'de app';
  const html =
    `<p style="margin:0 0 12px">Hallo ${escapeHtml(gebruiker.naam)},</p>` +
    `<p style="margin:0 0 12px">Er is een account voor je aangemaakt in ${escapeHtml(branding.appNaamKort)} van ${escapeHtml(branding.bedrijfsnaam)}.</p>` +
    `<p style="margin:0 0 12px">Ga naar <a href="${escapeHtml(adres)}">${escapeHtml(adres)}</a> en log in met dit e-mailadres (${escapeHtml(gebruiker.email)}). ` +
    `Je krijgt dan een code per mail en stelt daarna een eigen pincode in.</p>` +
    `<p style="margin:0">Tip: zet de app op het beginscherm van je telefoon (Delen → Zet op beginscherm).</p>`;
  return verstuurMail({
    naar: gebruiker.email,
    onderwerp: `Welkom bij ${branding.appNaamKort}`,
    tekst: `Hallo ${gebruiker.naam},\n\nEr is een account voor je aangemaakt in ${branding.appNaamKort}. Ga naar ${adres} en log in met ${gebruiker.email}.`,
    html,
  });
}

// ---- Schermen ----
const MELDINGEN = {
  verlopen: ['info', () => `Je moet je elke ${verifyDagen()} dagen opnieuw verifiëren met een e-mailcode.`],
  pinfout: ['error', () => 'Te vaak een onjuiste pincode. Log opnieuw in met een e-mailcode.'],
  vergrendeld: ['info', () => 'De app is vergrendeld. Voer je pincode in.'],
};

function flash(type, tekst) {
  return `<div class="flash ${type}">${escapeHtml(tekst)}</div>`;
}

function loginScherm({ email = '', volgende = '', melding = '' }) {
  return authPagina(
    'Inloggen',
    `${melding}
<h1>Inloggen</h1>
<p>Vul je e-mailadres in. Je ontvangt een code van 6 cijfers per e-mail.</p>
<form method="post" action="/login" class="form">
  <input type="hidden" name="volgende" value="${escapeHtml(volgende)}">
  <label class="f">E-mailadres
    <input type="email" name="email" value="${escapeHtml(email)}" required autofocus autocomplete="email" inputmode="email" placeholder="naam@voorbeeld.nl">
  </label>
  <button class="btn primary block" type="submit">Stuur inlogcode</button>
</form>`
  );
}

function codeScherm({ email, melding = '' }) {
  return authPagina(
    'Code invoeren',
    `${melding}
<h1>Voer je inlogcode in</h1>
<p>Als ${escapeHtml(maskeer(email))} bekend is, is er een code van 6 cijfers naartoe gestuurd. De code is ${CODE_MINUTEN} minuten geldig.</p>
${mailIngesteld() ? '' : flash('info', 'Testmodus: e-mail is nog niet ingesteld. De code staat in het containerlog (Portainer → container → Logs).')}
<form method="post" action="/login/code" class="form">
  <label class="f">Inlogcode
    <input class="code-input" type="text" name="code" required autofocus inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" placeholder="••••••">
  </label>
  <button class="btn primary block" type="submit">Verifiëren</button>
</form>
<a href="/login?ander=1" style="align-self:center;padding:8px">Ander e-mailadres of nieuwe code</a>`
  );
}

function pinInstellenScherm({ melding = '' }) {
  const min = pinMinLengte();
  return authPagina(
    'Pincode instellen',
    `${melding}
<h1>Stel je pincode in</h1>
<p>Met deze pincode log je op dit apparaat snel in. Kies ${min} tot 8 cijfers.</p>
<form method="post" action="/pin/instellen" class="form">
  <label class="f">Nieuwe pincode
    <input class="code-input" type="password" name="pin" required autofocus inputmode="numeric" pattern="[0-9]*" minlength="${min}" maxlength="8" autocomplete="new-password">
  </label>
  <label class="f">Herhaal pincode
    <input class="code-input" type="password" name="pin2" required inputmode="numeric" pattern="[0-9]*" minlength="${min}" maxlength="8" autocomplete="new-password">
  </label>
  <button class="btn primary block" type="submit">Pincode opslaan</button>
</form>`
  );
}

function pinScherm({ gebruiker, volgende = '', melding = '' }) {
  return authPagina(
    'Pincode',
    `${melding}
<h1>Welkom terug, ${escapeHtml(gebruiker.naam.split(' ')[0])}</h1>
<p>Voer je pincode in om ${escapeHtml(branding.appNaamKort)} te openen.</p>
<form method="post" action="/pin" class="form">
  <input type="hidden" name="volgende" value="${escapeHtml(volgende)}">
  <label class="f">Pincode
    <input class="code-input" type="password" name="pin" required autofocus inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="current-password">
  </label>
  <button class="btn primary block" type="submit">Openen</button>
</form>
<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
  <a href="/login?ander=1" style="padding:8px 0">Pincode vergeten?</a>
  <form method="post" action="/apparaat-vergeten"><button class="btn ghost sm" type="submit">Ander account</button></form>
</div>`
  );
}

/**
 * Behandelt de inlogroutes. Geeft true terug als de aanvraag is afgehandeld.
 * h = { leesFormulier, stuurHtml, redirect }
 */
export async function behandelInloggen(req, res, url, h) {
  const { pathname } = url;
  const methode = req.method;
  const cookies = parseCookies(req.headers.cookie);
  const html = (body, status = 200, headers = {}) => h.stuurHtml(res, status, body, headers);

  // ---- E-mailadres ----
  if (pathname === '/login') {
    const apparaat = huidigApparaat(cookies);
    if (methode === 'GET') {
      if (huidigeGebruiker(req)) {
        h.redirect(res, veiligeVolgende(url.searchParams.get('volgende')));
        return true;
      }
      if (apparaat && apparaat.pin_hash && apparaatGeverifieerd(apparaat) && !url.searchParams.get('ander')) {
        const v = url.searchParams.get('volgende');
        h.redirect(res, '/pin' + (v ? `?volgende=${encodeURIComponent(v)}` : ''));
        return true;
      }
      const m = MELDINGEN[url.searchParams.get('m')];
      const vorige = leesGetekend(cookies[LOGIN_COOKIE]);
      html(
        loginScherm({
          email: (vorige && vorige.email) || '',
          volgende: url.searchParams.get('volgende') || '',
          melding: m ? flash(m[0], m[1]()) : '',
        })
      );
      return true;
    }
    if (methode === 'POST') {
      const v = await h.leesFormulier(req);
      const email = (v.email || '').trim().toLowerCase();
      const volgende = v.volgende || '';
      const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE lower(email) = ? AND actief = 1').get(email);
      if (gebruiker) {
        const recent = db
          .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE gebruiker_id = ? AND aangemaakt_op > ?')
          .get(gebruiker.id, iso(new Date(Date.now() - 15 * 60e3))).n;
        if (recent >= 5) {
          html(loginScherm({ email, volgende, melding: flash('error', 'Te veel codes aangevraagd. Wacht een kwartier en probeer het opnieuw.') }), 429);
          return true;
        }
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        db.prepare('UPDATE login_codes SET gebruikt = 1 WHERE gebruiker_id = ? AND gebruikt = 0').run(gebruiker.id);
        db.prepare('INSERT INTO login_codes (gebruiker_id, code_hash, verloopt_op, aangemaakt_op) VALUES (?, ?, ?, ?)').run(
          gebruiker.id,
          hashGeheim(code),
          iso(new Date(Date.now() + CODE_MINUTEN * 60e3)),
          iso(nu())
        );
        await verstuurMail({
          naar: gebruiker.email,
          onderwerp: `Je inlogcode voor ${branding.appNaamKort}: ${code}`,
          tekst: `Hallo ${gebruiker.naam},\n\nJe inlogcode voor ${branding.appNaamKort} is: ${code}\n\nDe code is ${CODE_MINUTEN} minuten geldig.`,
          html: codeMailHtml(gebruiker.naam, code, CODE_MINUTEN),
        });
      }
      // Altijd dezelfde melding, zodat niet te zien is welke adressen bestaan.
      h.redirect(res, '/login/code', {
        'Set-Cookie': cookie(LOGIN_COOKIE, teken({ email, volgende, tot: Date.now() + 30 * 60e3 }), { maxAge: 1800 }),
      });
      return true;
    }
  }

  // ---- Code uit de mail ----
  if (pathname === '/login/code') {
    const login = leesGetekend(cookies[LOGIN_COOKIE]);
    if (!login || !login.email) {
      h.redirect(res, '/login');
      return true;
    }
    if (methode === 'GET') {
      html(codeScherm({ email: login.email }));
      return true;
    }
    if (methode === 'POST') {
      const v = await h.leesFormulier(req);
      const ingevuld = String(v.code || '').replace(/\D/g, '');
      const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE lower(email) = ? AND actief = 1').get(login.email);
      const rij = gebruiker
        ? db.prepare('SELECT * FROM login_codes WHERE gebruiker_id = ? AND gebruikt = 0 ORDER BY id DESC LIMIT 1').get(gebruiker.id)
        : null;
      if (!rij || new Date(rij.verloopt_op) < nu() || rij.pogingen >= MAX_CODE_POGINGEN) {
        html(codeScherm({ email: login.email, melding: flash('error', 'Deze code is verlopen of ongeldig. Vraag een nieuwe code aan.') }), 400);
        return true;
      }
      if (hashGeheim(ingevuld) !== rij.code_hash) {
        db.prepare('UPDATE login_codes SET pogingen = pogingen + 1 WHERE id = ?').run(rij.id);
        const over = MAX_CODE_POGINGEN - rij.pogingen - 1;
        html(
          codeScherm({
            email: login.email,
            melding: flash('error', over > 0 ? `Onjuiste code. Nog ${over} poging(en).` : 'Te veel pogingen. Vraag een nieuwe code aan.'),
          }),
          400
        );
        return true;
      }
      db.prepare('UPDATE login_codes SET gebruikt = 1 WHERE id = ?').run(rij.id);

      const apparaat = huidigApparaat(cookies);
      const headers = [cookie(LOGIN_COOKIE, '', { verwijder: true })];
      let apparaatId;
      let heeftPin;
      if (apparaat && apparaat.gebruiker_id === gebruiker.id) {
        db.prepare('UPDATE apparaten SET geverifieerd_op = ?, pin_pogingen = 0 WHERE id = ?').run(iso(nu()), apparaat.id);
        apparaatId = apparaat.id;
        heeftPin = Boolean(apparaat.pin_hash);
      } else {
        const token = randomBytes(40).toString('base64url');
        const r = db
          .prepare('INSERT INTO apparaten (gebruiker_id, token_hash, geverifieerd_op, user_agent, aangemaakt_op) VALUES (?, ?, ?, ?, ?)')
          .run(gebruiker.id, hashGeheim(token), iso(nu()), String(req.headers['user-agent'] || '').slice(0, 250), iso(nu()));
        apparaatId = Number(r.lastInsertRowid);
        heeftPin = false;
        headers.push(cookie(APPARAAT_COOKIE, token, { maxAge: 400 * 86400 }));
      }
      logActie(gebruiker, 'Ingelogd', 'gebruiker', gebruiker.id, 'e-mailcode');
      if (heeftPin) {
        headers.push(ontgrendel(gebruiker.id, apparaatId));
        h.redirect(res, veiligeVolgende(login.volgende), { 'Set-Cookie': headers });
      } else {
        headers.push(
          cookie(LOGIN_COOKIE, teken({ pinVoor: apparaatId, gebruiker: gebruiker.id, volgende: login.volgende, tot: Date.now() + 30 * 60e3 }), {
            maxAge: 1800,
          })
        );
        h.redirect(res, '/pin/instellen', { 'Set-Cookie': headers });
      }
      return true;
    }
  }

  // ---- Pincode instellen ----
  if (pathname === '/pin/instellen') {
    const login = leesGetekend(cookies[LOGIN_COOKIE]);
    if (!login || !login.pinVoor) {
      h.redirect(res, '/login');
      return true;
    }
    if (methode === 'GET') {
      html(pinInstellenScherm({}));
      return true;
    }
    if (methode === 'POST') {
      const v = await h.leesFormulier(req);
      const p1 = String(v.pin || '').trim();
      const p2 = String(v.pin2 || '').trim();
      const min = pinMinLengte();
      let fout = '';
      if (!/^\d+$/.test(p1) || p1.length < min || p1.length > 8) fout = `Kies een pincode van ${min} tot 8 cijfers.`;
      else if (p1 !== p2) fout = 'De pincodes zijn niet gelijk.';
      else if (new Set(p1).size === 1 || '0123456789'.includes(p1) || '9876543210'.includes(p1)) {
        fout = 'Kies een minder voorspelbare pincode (niet 1111 of 1234).';
      }
      if (fout) {
        html(pinInstellenScherm({ melding: flash('error', fout) }), 400);
        return true;
      }
      db.prepare('UPDATE apparaten SET pin_hash = ?, pin_pogingen = 0 WHERE id = ? AND gebruiker_id = ?').run(
        hashPin(p1),
        login.pinVoor,
        login.gebruiker
      );
      h.redirect(res, veiligeVolgende(login.volgende), {
        'Set-Cookie': [cookie(LOGIN_COOKIE, '', { verwijder: true }), ontgrendel(login.gebruiker, login.pinVoor)],
      });
      return true;
    }
  }

  // ---- Pincode (ontgrendelen) ----
  if (pathname === '/pin') {
    const apparaat = huidigApparaat(cookies);
    const volgende = url.searchParams.get('volgende') || '';
    if (!apparaat || !apparaat.pin_hash || !apparaatGeverifieerd(apparaat)) {
      const m = apparaat && apparaat.pin_hash && !apparaatGeverifieerd(apparaat) ? '&m=verlopen' : '';
      h.redirect(res, `/login?ander=1${m}${volgende ? `&volgende=${encodeURIComponent(volgende)}` : ''}`);
      return true;
    }
    const gebruiker = db.prepare('SELECT * FROM gebruikers WHERE id = ? AND actief = 1').get(apparaat.gebruiker_id);
    if (!gebruiker) {
      h.redirect(res, '/login?ander=1');
      return true;
    }
    if (methode === 'GET') {
      html(pinScherm({ gebruiker, volgende }));
      return true;
    }
    if (methode === 'POST') {
      const v = await h.leesFormulier(req);
      if (controleerPin(String(v.pin || '').trim(), apparaat.pin_hash)) {
        h.redirect(res, veiligeVolgende(v.volgende), { 'Set-Cookie': ontgrendel(gebruiker.id, apparaat.id) });
        return true;
      }
      const pogingen = apparaat.pin_pogingen + 1;
      if (pogingen >= MAX_PIN_POGINGEN) {
        db.prepare('UPDATE apparaten SET pin_hash = NULL, geverifieerd_op = NULL, pin_pogingen = 0 WHERE id = ?').run(apparaat.id);
        h.redirect(res, '/login?ander=1&m=pinfout', {
          'Set-Cookie': cookie(LOGIN_COOKIE, teken({ email: gebruiker.email, tot: Date.now() + 30 * 60e3 }), { maxAge: 1800 }),
        });
        return true;
      }
      db.prepare('UPDATE apparaten SET pin_pogingen = ? WHERE id = ?').run(pogingen, apparaat.id);
      html(pinScherm({ gebruiker, volgende: v.volgende || '', melding: flash('error', `Onjuiste pincode. Nog ${MAX_PIN_POGINGEN - pogingen} poging(en).`) }), 400);
      return true;
    }
  }

  // ---- Vergrendelen (uitloggen vergrendelt alleen de sessie) ----
  if ((pathname === '/uitloggen' || pathname === '/vergrendelen') && methode === 'POST') {
    const token = cookies[SESSIE_COOKIE];
    if (token) db.prepare('DELETE FROM sessies WHERE token = ?').run(hashGeheim(token));
    h.redirect(res, '/pin', { 'Set-Cookie': cookie(SESSIE_COOKIE, '', { verwijder: true }) });
    return true;
  }

  // ---- Apparaat vergeten ----
  if (pathname === '/apparaat-vergeten' && methode === 'POST') {
    const apparaat = huidigApparaat(cookies);
    if (apparaat) verwijderApparaat(apparaat.id);
    h.redirect(res, '/login?ander=1', {
      'Set-Cookie': [
        cookie(SESSIE_COOKIE, '', { verwijder: true }),
        cookie(APPARAAT_COOKIE, '', { verwijder: true }),
        cookie(LOGIN_COOKIE, '', { verwijder: true }),
      ],
    });
    return true;
  }

  return false;
}

export { nieuweId };
