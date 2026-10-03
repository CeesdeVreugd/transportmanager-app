// Genereert app-iconen (voor het PWA-manifest) op basis van de huisstijl in
// src/branding.js. Alleen nodig tijdens ontwikkeling/build - draait NIET mee
// met de live server, dus de gedeployde app heeft hier geen dependency op.
//
// Gebruik: NODE_PATH="$(npm root -g)" node scripts/generate-icons.cjs
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');

async function main() {
  const brandingUrl = require('node:url').pathToFileURL(
    path.join(__dirname, '..', 'src', 'branding.js')
  ).href;
  const { default: branding } = await import(brandingUrl);

  const outDir = path.join(__dirname, '..', 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  const iconBron = path.join(__dirname, '..', 'src', 'assets', 'icoon-bron.png');
  const heeftEchtLogo = fs.existsSync(iconBron);
  const initiaal = (branding.bedrijfsnaam || 'T').trim().charAt(0).toUpperCase();

  // Het icoontje (lichtblauw) hoort op een WITTE achtergrond te staan, nooit
  // op het donkerblauw — donkerblauw is voorbehouden aan knoppen/details in
  // de app zelf. Een dun randje in de rand-kleur geeft net genoeg contrast
  // op een puur witte ondergrond (bijv. een wit startscherm op de telefoon).
  const maakAchtergrondSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${size * 0.02}" y="${size * 0.02}" width="${size * 0.96}" height="${size * 0.96}" rx="${size * 0.18}" fill="#ffffff" stroke="#e1e5f0" stroke-width="${Math.max(1, size * 0.012)}"/>
</svg>`;

  const maakLetterSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${size * 0.02}" y="${size * 0.02}" width="${size * 0.96}" height="${size * 0.96}" rx="${size * 0.18}" fill="#ffffff" stroke="#e1e5f0" stroke-width="${Math.max(1, size * 0.012)}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, sans-serif" font-weight="700"
        font-size="${size * 0.52}" fill="${branding.kleurAccent}">${initiaal}</text>
</svg>`;

  for (const size of [192, 512]) {
    const bestandsPad = path.join(outDir, `icon-${size}.png`);
    if (heeftEchtLogo) {
      const achtergrond = Buffer.from(maakAchtergrondSvg(size));
      const logoGrootte = Math.round(size * 0.62);
      const logo = await sharp(iconBron).resize({ width: logoGrootte, height: logoGrootte, fit: 'inside' }).toBuffer();
      const logoMeta = await sharp(logo).metadata();
      await sharp(achtergrond)
        .composite([
          {
            input: logo,
            left: Math.round((size - logoMeta.width) / 2),
            top: Math.round((size - logoMeta.height) / 2),
          },
        ])
        .png()
        .toFile(bestandsPad);
    } else {
      await sharp(Buffer.from(maakLetterSvg(size))).png().toFile(bestandsPad);
    }
  }

  // Favicon (kleiner formaat, zelfde stijl)
  const faviconPad = path.join(outDir, 'favicon.png');
  if (heeftEchtLogo) {
    const size = 64;
    const achtergrond = Buffer.from(maakAchtergrondSvg(size));
    const logoGrootte = Math.round(size * 0.62);
    const logo = await sharp(iconBron).resize({ width: logoGrootte, height: logoGrootte, fit: 'inside' }).toBuffer();
    const logoMeta = await sharp(logo).metadata();
    await sharp(achtergrond)
      .composite([{ input: logo, left: Math.round((size - logoMeta.width) / 2), top: Math.round((size - logoMeta.height) / 2) }])
      .png()
      .toFile(faviconPad);
  } else {
    await sharp(Buffer.from(maakLetterSvg(64))).png().toFile(faviconPad);
  }

  console.log(`Iconen gegenereerd in public/icons/ (${heeftEchtLogo ? 'met echt logo-merkteken' : 'met letter-placeholder'}).`);
}

main().catch((err) => {
  console.error('Genereren van iconen is mislukt:', err);
  process.exit(1);
});
