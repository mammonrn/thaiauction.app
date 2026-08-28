import { chromium } from "playwright";
const S = process.argv[2];
for (const locale of ["th-TH", "en-US"]) {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale });
  const p = await ctx.newPage();
  await p.goto(`file://${S}/dt.html`);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${S}/dt-${locale}.png`, fullPage: true });
  // Intl for comparison: what the page COULD render itself
  const intl = await p.evaluate(() => new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:false
  }).format(new Date("2026-08-28T14:30:00")));
  console.log(`${locale}: Intl can render -> ${intl}`);
  await b.close();
}
