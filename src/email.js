// E-mailnotificaties naar klanten (bijv. "onderweg" / "afgeleverd"), via de
// Resend API (https://resend.com/docs/api-reference/emails/send-email).
// Werkt alleen als RESEND_API_KEY is ingesteld als omgevingsvariabele — zonder
// sleutel slaat de app dit gewoon over (geen crash), precies zoals de
// automatische routeberekening met ORS_API_KEY.
import branding from './branding.js';

export function emailNotificatiesActief() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function stuurKlantEmail({ naar, onderwerp, tekst }) {
  if (!emailNotificatiesActief() || !naar) return { verzonden: false };
  const afzender = process.env.RESEND_AFZENDER || 'onboarding@resend.dev';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${branding.bedrijfsnaam} <${afzender}>`,
        to: [naar],
        subject: onderwerp,
        text: tekst,
      }),
    });
    if (!resp.ok) {
      const details = await resp.text().catch(() => '');
      console.error('E-mail versturen mislukt:', resp.status, details);
      return { verzonden: false };
    }
    return { verzonden: true };
  } catch (fout) {
    console.error('E-mail versturen mislukt:', fout.message);
    return { verzonden: false };
  }
}
