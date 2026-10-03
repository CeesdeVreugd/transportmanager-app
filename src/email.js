// E-mailnotificaties naar klanten (bijv. "onderweg" / "afgeleverd"). Gaat via
// dezelfde mailmodule als de inlogcodes: Microsoft 365 (Graph) of Resend.
// Zonder mailinstellingen wordt er niets naar klanten verstuurd.
import { graphIngesteld, verstuurMail } from './mail.js';

export function emailNotificatiesActief() {
  return graphIngesteld() || Boolean(process.env.RESEND_API_KEY);
}

export async function stuurKlantEmail({ naar, onderwerp, tekst }) {
  if (!emailNotificatiesActief() || !naar) return { verzonden: false };
  const verzonden = await verstuurMail({ naar, onderwerp, tekst });
  return { verzonden };
}
