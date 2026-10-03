// E-mail versturen — zelfde opzet als WorkPortal:
//  1. Microsoft 365 via een app-registratie (Microsoft Graph, Mail.Send):
//     GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET en MAIL_FROM.
//  2. Anders Resend (RESEND_API_KEY), zoals de oude omgeving deed.
//  3. Anders testmodus: de mail (met inlogcode) komt in het containerlog
//     (Portainer → Containers → transportmanager-app → Logs).
import branding from './branding.js';

let graphToken = { waarde: null, verloopt: 0 };

export function graphIngesteld() {
  return ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'MAIL_FROM'].every((k) => process.env[k]);
}

export function mailIngesteld() {
  return graphIngesteld() || Boolean(process.env.RESEND_API_KEY);
}

export function mailMethode() {
  if (graphIngesteld()) return 'Microsoft 365 (app-registratie)';
  if (process.env.RESEND_API_KEY) return 'Resend';
  return null;
}

async function haalGraphToken() {
  if (graphToken.waarde && graphToken.verloopt > Date.now() + 60_000) return graphToken.waarde;
  const resp = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID,
      client_secret: process.env.GRAPH_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!resp.ok) throw new Error(`token aanvragen mislukt (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  const js = await resp.json();
  graphToken = { waarde: js.access_token, verloopt: Date.now() + (js.expires_in || 3600) * 1000 };
  return graphToken.waarde;
}

async function verstuurViaGraph(naar, onderwerp, html) {
  const afzender = process.env.MAIL_FROM;
  const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(afzender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await haalGraphToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: onderwerp,
        body: { contentType: 'HTML', content: html },
        toRecipients: [].concat(naar).map((a) => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: true,
    }),
  });
  if (resp.status !== 200 && resp.status !== 202) {
    throw new Error(`sendMail gaf ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
}

async function verstuurViaResend(naar, onderwerp, html, tekst) {
  const afzender = process.env.RESEND_AFZENDER || process.env.MAIL_FROM || 'onboarding@resend.dev';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${branding.bedrijfsnaam} <${afzender}>`, to: [].concat(naar), subject: onderwerp, html, text: tekst }),
  });
  if (!resp.ok) throw new Error(`Resend gaf ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
}

const FONT = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function tekstNaarHtml(tekst) {
  return esc(tekst || '')
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 11pt">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function handtekeningHtml() {
  const basis = (process.env.APP_URL || '').replace(/\/+$/, '');
  const logo = basis
    ? `<p style="margin:12px 0 0"><img src="${basis}/img/logo.png" alt="${esc(branding.bedrijfsnaam)}" width="220" height="51" style="display:inline-block;border:0"></p>`
    : '';
  return (
    `<div style="font-family:${FONT};font-size:10pt;line-height:1.35;color:#000;margin-top:22px">` +
    `<p style="margin:0">Met vriendelijke groeten,</p><p style="margin:0">&nbsp;</p>` +
    `<p style="margin:0">Systeembeheer | ${esc(branding.bedrijfsnaam)}</p>${logo}</div>`
  );
}

/** Alle mails in hetzelfde kader: blauwe kop TRANSPORTMANAGER, inhoud en handtekening. */
export function kaderHtml(inhoud) {
  return (
    `<div style="font-family:${FONT};font-size:11pt;max-width:640px;color:#000000">` +
    `<div style="background:#0A0A96;color:#fff;padding:16px 22px;border-radius:10px 10px 0 0;font-weight:bold;` +
    `letter-spacing:.1em;font-size:12pt">${esc(branding.appLabel)}</div>` +
    `<div style="border:1px solid #E1E5F0;border-top:0;padding:20px 22px;border-radius:0 0 10px 10px">` +
    `${inhoud}${handtekeningHtml()}</div></div>`
  );
}

export function codeMailHtml(naam, code, minuten) {
  return (
    `<p style="margin:0 0 12px">Hallo ${esc(naam)},</p>` +
    `<p style="margin:0 0 12px">Je inlogcode voor ${esc(branding.appNaamKort)} is:</p>` +
    `<p style="font-size:26pt;font-weight:bold;letter-spacing:8px;color:#0A0A96;margin:14px 0">${esc(code)}</p>` +
    `<p style="margin:0">De code is ${minuten} minuten geldig. Heb je niet geprobeerd in te loggen? Dan kun je deze mail negeren.</p>`
  );
}

/**
 * Verstuurt een mail in de huisstijl. Geeft true terug als het gelukt is (of
 * in testmodus in het log is gezet).
 */
export async function verstuurMail({ naar, onderwerp, tekst = '', html = null }) {
  const inhoud = html || tekstNaarHtml(tekst);
  const volledig = kaderHtml(inhoud);
  try {
    if (graphIngesteld()) {
      await verstuurViaGraph(naar, onderwerp, volledig);
      return true;
    }
    if (process.env.RESEND_API_KEY) {
      await verstuurViaResend(naar, onderwerp, volledig, tekst);
      return true;
    }
  } catch (fout) {
    console.error(`[TransportManager] E-mail versturen mislukt naar ${naar}: ${fout.message}`);
    return false;
  }
  console.log('='.repeat(60));
  console.log(`[TransportManager] E-MAIL (mail niet ingesteld) aan: ${naar}`);
  console.log(`Onderwerp: ${onderwerp}`);
  console.log(tekst);
  console.log('='.repeat(60));
  return true;
}
