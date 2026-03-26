// SKATTETABELL-VERIFIERING — Tabell 30, Kolumn 1, Stockholm 2026
// Jämför calculateTableTax() mot Skatteverkets officiella tabell.
// Källa: SKV FS 2025:20 "Skatteavdrag för månadslön 2026", SKV 433
//
// ALGORITM (SKV 433):
//   TABLE_RATE = 0.30           tabellnummer = total standardiserad skattesats
//   KI_NET     = 0.2884         kommunal + landsting (= TABLE_RATE - 1.16%)
//   BURIAL_CHURCH = 0.0116      standardiserad begravningsavgift + kyrkoavgift
//   Årsinkoms   = hi × 12       SKV 433: "det högsta beloppet × lönetillfällen"
//   ai_trunc    = floor(ai/100)*100   avrundas ned till jämnt hundratal
//   GA          = ceil(raw/100)*100   avrundas UPPÅT till jämnt hundratal
//   GA_FLOOR_FACTOR = 0.293     (0.294 ger 17 500 med ceiling, 0.293 ger 17 400 ✓)
//   APA         = round(income*0.07/100)*100  om ai_trunc >= 25 042, annars 0
//   PS_CAP      = 1.42 × IBB    = 118 428
//
// Run: npx tsx TAXOPTMIZER/tax-tabell-verify.ts

import { TABELL_30_2026 } from "./skv-tabell-30-2026";

// ── KONSTANTER (standardiserade tabell-värden, ej faktiska kommunala) ──
const PBB  = 59_200;
const IBB  = 83_400;
const TABLE_RATE    = 0.30;
const BURIAL_CHURCH = 0.0116;
const KI_NET        = TABLE_RATE - BURIAL_CHURCH; // 0.2884
const SKIKTGRANS    = 643_000;
const PS_CAP        = 1.42 * IBB;                 // 118,428
const APA_INCOME_CAP = 8.07 * IBB;                // 673,038
const APA_THRESHOLD  = 0.423 * PBB;               // 25,041.6 (APA betalas ej under detta)

// ── GRUNDAVDRAG (under 66, avrundas UPPÅT till jämnt hundratal) ──
function gaTable(aiTrunc: number): number {
  const b1 = 0.99  * PBB;  //  58,608
  const b2 = 2.72  * PBB;  // 161,024
  const b3 = 3.11  * PBB;  // 184,112
  const b4 = 7.88  * PBB;  // 466,496
  let raw: number;
  if      (aiTrunc <= b1) raw = 0.423 * PBB;
  else if (aiTrunc <= b2) raw = 0.423 * PBB + 0.20 * (aiTrunc - b1);
  else if (aiTrunc <= b3) raw = 0.77  * PBB;
  else if (aiTrunc <= b4) raw = 0.77  * PBB - 0.10 * (aiTrunc - b3);
  else                    raw = 0.293 * PBB;       // 17,345.6 → ceil → 17,400
  return Math.min(Math.ceil(raw / 100) * 100, aiTrunc);
}

// ── JOBBSKATTEAVDRAG (floor, ej round) ──
function jsaTable(aiTrunc: number, ga: number): number {
  const b1 = 0.91  * PBB;  //  53,872
  const b2 = 3.24  * PBB;  // 191,808
  const b3 = 8.08  * PBB;  // 478,336
  let jsa: number;
  if      (aiTrunc <= b1) jsa = (aiTrunc - ga) * KI_NET;
  else if (aiTrunc <= b2) jsa = (0.91  * PBB + 0.3874 * (aiTrunc - b1) - ga) * KI_NET;
  else if (aiTrunc <= b3) jsa = (1.813 * PBB + 0.251  * (aiTrunc - b2) - ga) * KI_NET;
  else                    jsa = (3.027 * PBB - ga) * KI_NET;
  return Math.max(0, Math.floor(jsa));
}

// ── TABELL-SKATT (månadsskatt för en given hi-lön) ──
function calculateTableTax(hiSalary: number): number {
  const ai      = hiSalary * 12;
  const aiTrunc = Math.floor(ai / 100) * 100;

  const ga      = gaTable(aiTrunc);
  const taxable = Math.max(0, aiTrunc - ga);

  const statlig       = Math.floor(Math.max(0, taxable - SKIKTGRANS) * 0.20);
  // Använd heltalsaritmetik för att undvika IEEE 754-avrundningsfel
  // (t.ex. 295000 * 0.0116 = 3421.999... i JS → floor ger 3421 istället för 3422)
  const kommunal      = Math.floor(taxable * 2884 / 10000);
  const burialChurch  = Math.floor(taxable * 116  / 10000);

  // APA: 7% av inkomst, avrundas till närmaste 100. Betalas ej om ai_trunc < APA_THRESHOLD.
  const apaIncome = Math.min(aiTrunc, APA_INCOME_CAP);
  const apa = aiTrunc < APA_THRESHOLD
    ? 0
    : Math.round(apaIncome * 0.07 / 100) * 100;

  const sktApa = Math.min(apa, statlig + kommunal);

  const jsaRaw = jsaTable(aiTrunc, ga);
  const jsaEff = Math.min(jsaRaw, Math.max(0, kommunal - sktApa));

  const sktForv = taxable <= 40_000  ? 0
                : taxable <= 240_000 ? Math.floor((taxable - 40_000) * 0.0075)
                :                      1_500;
  const sktForvEff = Math.min(sktForv, Math.max(0, kommunal - sktApa - jsaEff));

  const ps = Math.floor(Math.min(taxable, PS_CAP) * 0.01);

  const net = statlig + kommunal + burialChurch + apa + ps - sktApa - jsaEff - sktForvEff;
  return Math.max(0, Math.floor(net / 12));
}

// ── KÖR VERIFIERING ──

console.log("=== SKATTETABELL-VERIFIERING ===");
console.log(`Tabell 30, Kolumn 1, Stockholm 2026 (${TABELL_30_2026.length} rader)`);
console.log(`Täckning: 1–65 000 kr/mån = 12–780 000 kr/år\n`);

let failures = 0;
const failDetails: string[] = [];

for (const row of TABELL_30_2026) {
  const ours = calculateTableTax(row.hi);
  const diff = ours - row.col1;
  if (diff !== 0) {
    failures++;
    failDetails.push(
      `  lön ${row.lo}–${row.hi} kr/mån  hi*12=${row.hi * 12}` +
      `  vår=${ours}  kol1=${row.col1}  diff=${diff > 0 ? "+" : ""}${diff}`
    );
  }
}

if (failures === 0) {
  console.log(`✅ PERFEKT: Noll avvikelse mot tabell 30 kol 1 för alla ${TABELL_30_2026.length} rader!`);
} else {
  console.log(`❌ AVVIKELSER MOT KOL 1: ${failures} av ${TABELL_30_2026.length} rader`);
  failDetails.forEach(d => console.log(d));
}
