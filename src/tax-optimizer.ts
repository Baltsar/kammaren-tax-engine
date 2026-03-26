// TAX OPTIMIZER — Deterministisk beräkningsmotor v2
// Noll beroenden. Noll LLM. Ren matematik.
// Stöder grundavdrag, jobbskatteavdrag, lönstrategier, 50x-cap,
// omkostnadsbelopp, iterativ P-fond, och kommun-lookup.

import { TAX_CONSTANTS_2026, TaxConstants } from "./tax-constants-2026";
import { resolveRates, ResolvedRates } from "./kommun-skattesatser-2026";

// ── INTERFACES ──

export interface TaxOptimizerInput {
  profit_before_salary: number;
  liquid_assets: number;
  total_payroll_others: number;
  owner_salary_taken: number;
  external_income: number;
  kommun: string;
  church_member: boolean;
  municipal_tax_rate_override?: number;
  saved_dividend_space: number;
  is_holding_company: boolean;
  has_working_relatives: boolean;
  num_owners: number;
  salary_strategy: "sgi" | "pension" | "balanced";
  planned_downtime_within_3_years: boolean;
  omkostnadsbelopp?: number;
  is_over_66?: boolean;
  safety_buffer?: number;
}

export interface TaxBreakdown {
  grundavdrag: number;
  kommunalskatt: number;
  begravningsavgift: number;
  kyrkoavgift: number;
  statlig_skatt: number;
  gross_tax: number;
  jobbskatteavdrag: number;
  net_tax: number;
}

export interface SalaryScenario {
  salary: number;
  net_salary: number;
  total_in_pocket: number;
  note: string;
  // Breakdown fields (for invariant verification and detail display)
  gransbelopp: number;
  dividend: number;
  dividend_tax: number;
  net_dividend: number;
  employer_fee: number;
  income_tax: number;
  corporate_tax: number;
  surplus_in_company: number;
}

export interface StrategyEScenario {
  salary: number;
  net_salary: number;
  total_in_pocket: number;
  note: string;
  gransbelopp: number;
  fritt_ek: number;
  employer_fee: number;
  income_tax: number;
  corporate_tax: number;
  dividend_within_space: number;
  dividend_over_space: number;
  dividend_within_tax: number;
  dividend_over_tax: number;
  net_dividend: number;
  retained_in_company: number;
  effective_tax_rate: number;
  effective_tax_rate_over: number;
  warnings: string[];
}

export interface PfondScenario {
  amount: number;
  tax_deferred: number;
  reversal_year: number;
  net_effect_5yr: number;
}

export interface RetainScenario {
  amount: number;
  tax_paid_now: number;
  available_for_investment: number;
}

export interface TaxOptimizerOutput {
  recommended_salary: number;
  employer_fees: number;
  total_salary_cost: number;
  salary_income_tax: number;
  net_salary: number;
  tax_breakdown: TaxBreakdown;

  salary_scenarios: {
    sgi: SalaryScenario;
    pension: SalaryScenario;
    balanced: SalaryScenario;
  };

  strategy_d: SalaryScenario;
  strategy_e: StrategyEScenario;

  base_amount: number;
  salary_based_space: number;
  total_dividend_space: number;
  recommended_dividend: number;
  safety_buffer: number;
  recommended_dividend_after_buffer: number;
  dividend_tax: number;
  net_dividend: number;
  saved_space_next_year: number;
  dividend_cap_reason: "space" | "equity" | "liquidity";

  remaining_profit: number;
  corporate_tax: number;
  free_equity: number;
  surplus_after_dividend: number;
  pfond_scenario: PfondScenario;
  pfond_recommended: boolean;
  retain_scenario: RetainScenario;

  omkostnadsbelopp_tillagg: number;

  total_in_pocket: number;
  effective_tax_rate: number;
  tax_saved_vs_all_salary: number;

  warnings: string[];
  blockers: string[];
  disclaimer: string;
  constants_version: string;
}

// ── HELPERS ──

function round(n: number): number {
  return Math.round(n);
}

// ── GRUNDAVDRAG (under 66, SKV 433) ──

export function grundavdrag(income: number, PBB: number): number {
  if (income <= 0) return 0;
  const b1 = 0.99 * PBB;
  const b2 = 2.72 * PBB;
  const b3 = 3.11 * PBB;
  const b4 = 7.88 * PBB;
  if (income <= b1) return Math.min(Math.round(0.423 * PBB), income);
  if (income <= b2) return Math.round(0.423 * PBB + 0.20 * (income - b1));
  if (income <= b3) return Math.round(0.77 * PBB);
  if (income <= b4) {
    return Math.max(
      Math.round(0.423 * PBB),
      Math.round(0.77 * PBB - 0.10 * (income - b3))
    );
  }
  return Math.round(0.294 * PBB);
}

// ── JOBBSKATTEAVDRAG (under 66, SKV 433) ──

export function jobbskatteavdrag(
  income: number,
  grundavdragAmount: number,
  KI: number,
  PBB: number
): number {
  if (income <= 0) return 0;
  const AI = income;
  const GA = grundavdragAmount;
  const b1 = 0.91 * PBB;
  const b2 = 3.24 * PBB;
  const b3 = 8.08 * PBB;
  let jsa: number;
  if (AI <= b1) {
    jsa = (AI - GA) * KI;
  } else if (AI <= b2) {
    jsa = (0.91 * PBB + 0.3874 * (AI - b1) - GA) * KI;
  } else if (AI <= b3) {
    jsa = (1.813 * PBB + 0.251 * (AI - b2) - GA) * KI;
  } else {
    jsa = (3.027 * PBB - GA) * KI;
  }
  return Math.max(0, Math.round(jsa));
}

// ── FULL INCOME TAX MODEL ──

export function calculateIncomeTax(
  income: number,
  rates: ResolvedRates,
  c: TaxConstants
): TaxBreakdown {
  if (income <= 0) {
    return {
      grundavdrag: 0,
      kommunalskatt: 0,
      begravningsavgift: 0,
      kyrkoavgift: 0,
      statlig_skatt: 0,
      gross_tax: 0,
      jobbskatteavdrag: 0,
      net_tax: 0,
    };
  }
  const GA = grundavdrag(income, c.PBB);
  const taxable = Math.max(0, income - GA);
  const kommunalskatt = round(taxable * rates.KI);
  const begravningsavgift = round(taxable * rates.burial);
  const kyrkoavgift = round(taxable * rates.church);
  const statlig_skatt = round(Math.max(0, taxable - c.SKIKTGRANS) * c.STATE_TAX_RATE);
  const gross_tax = kommunalskatt + begravningsavgift + kyrkoavgift + statlig_skatt;
  const jsa = jobbskatteavdrag(income, GA, rates.KI, c.PBB);
  const jsa_capped = Math.min(jsa, kommunalskatt); // JSA cannot exceed kommunalskatt
  const net_tax = Math.max(0, gross_tax - jsa_capped);
  return {
    grundavdrag: GA,
    kommunalskatt,
    begravningsavgift,
    kyrkoavgift,
    statlig_skatt,
    gross_tax,
    jobbskatteavdrag: jsa_capped,
    net_tax,
  };
}

// ── MARGINAL INCOME TAX ──
// Returns the marginal tax on salary given that external_income already occupies
// lower brackets, along with the full breakdown for total income.

function salaryIncomeTax(
  salary: number,
  externalIncome: number,
  rates: ResolvedRates,
  c: TaxConstants
): { marginalTax: number; totalBreakdown: TaxBreakdown } {
  const totalBreakdown = calculateIncomeTax(externalIncome + salary, rates, c);
  const externalBreakdown = calculateIncomeTax(externalIncome, rates, c);
  const marginalTax = totalBreakdown.net_tax - externalBreakdown.net_tax;
  return { marginalTax, totalBreakdown };
}

// ── SALARY STRATEGY TARGETS ──

interface SalaryTargets {
  sgi: number;
  pension: number;
  balanced: number;
}

function getSalaryTargets(c: TaxConstants): SalaryTargets {
  return {
    sgi: c.SGI_MAX,         // 592,000
    pension: c.PENSION_MAX_GROSS, // 673,038
    balanced: c.BRYTPUNKT,       // 660,400
  };
}

// ── BUILD SALARY SCENARIO ──

function buildSalaryScenario(
  targetSalary: number,
  externalIncome: number,
  profit: number,
  rates: ResolvedRates,
  c: TaxConstants,
  note: string,
  computeDetailFn: (salary: number) => DividendDetail
): SalaryScenario {
  const maxAffordable = round(profit / (1 + c.EMPLOYER_FEE_RATE));
  const adjustedTarget = Math.max(0, targetSalary - externalIncome);
  const salary = Math.max(0, Math.min(adjustedTarget, maxAffordable));
  const employerFee = round(salary * c.EMPLOYER_FEE_RATE);
  const { marginalTax } = salaryIncomeTax(salary, externalIncome, rates, c);
  const net_salary = salary - marginalTax;
  const detail = computeDetailFn(salary);
  return {
    salary,
    net_salary,
    total_in_pocket: net_salary + detail.net_dividend,
    note,
    gransbelopp: detail.gransbelopp,
    dividend: detail.dividend,
    dividend_tax: detail.dividend_tax,
    net_dividend: detail.net_dividend,
    employer_fee: employerFee,
    income_tax: marginalTax,
    corporate_tax: detail.corporate_tax,
    surplus_in_company: detail.surplus_in_company,
  };
}

// ── P-FOND ITERATION HELPER ──
// Computes optimal pfond amount via convergence loop.

function computePfondAmount(
  remainingProfit: number,
  totalDividendSpace: number,
  liquidAssets: number,
  c: TaxConstants
): number {
  let pfond = 0;
  for (let i = 0; i < 10; i++) {
    const taxableAfterPfond = remainingProfit - pfond;
    const corpTax = round(taxableAfterPfond * c.CORP_TAX_RATE);
    const freeEq = taxableAfterPfond - corpTax;
    const dividend = Math.max(
      0,
      round(Math.min(totalDividendSpace, freeEq, liquidAssets))
    );
    const pretaxForDiv =
      dividend > 0 ? round(dividend / (1 - c.CORP_TAX_RATE)) : 0;
    const newPfond = Math.min(
      round(remainingProfit * c.PFOND_MAX_SHARE),
      Math.max(0, remainingProfit - pretaxForDiv)
    );
    if (Math.abs(newPfond - pfond) < 1) break;
    pfond = newPfond;
  }
  return pfond;
}

// ── DIVIDEND DETAIL for a given salary ──
// Returns full breakdown for salary scenarios (balance invariants, display).
// Accounts for P-fond when planned_downtime_within_3_years is true.

interface DividendDetail {
  gransbelopp: number;
  dividend: number;
  dividend_tax: number;
  net_dividend: number;
  corporate_tax: number;
  surplus_in_company: number;
}

function computeDividendDetail(
  salary: number,
  input: TaxOptimizerInput,
  c: TaxConstants
): DividendDetail {
  const employerFees = round(salary * c.EMPLOYER_FEE_RATE);
  const totalCost = salary + employerFees;
  const remainingProfit = input.profit_before_salary - totalCost;
  if (remainingProfit <= 0) {
    return { gransbelopp: 0, dividend: 0, dividend_tax: 0, net_dividend: 0, corporate_tax: 0, surplus_in_company: 0 };
  }

  const totalPayroll = salary + input.total_payroll_others;
  let salaryBasedSpace = round(
    Math.max(0, c.SALARY_BASED_SHARE * (totalPayroll - c.SALARY_DEDUCTION))
  );
  // 50x cap
  salaryBasedSpace = Math.min(salaryBasedSpace, 50 * salary);

  const baseAmount = c.BASE_AMOUNT;
  const omkostnadsbelopp = input.omkostnadsbelopp ?? 25_000;
  const omkostnadsTillagg = Math.max(
    0,
    round((omkostnadsbelopp - c.OMKOSTNADSBELOPP_THRESHOLD) * (c.SLR + c.OMKOSTNADSBELOPP_RATE_ADDON))
  );
  const totalDividendSpace =
    baseAmount + salaryBasedSpace + omkostnadsTillagg + input.saved_dividend_space;

  // P-fond reduces tax base when sabbatical is planned
  let pfondAmount = 0;
  if (input.planned_downtime_within_3_years) {
    pfondAmount = computePfondAmount(remainingProfit, totalDividendSpace, input.liquid_assets, c);
  }

  const taxableAfterPfond = remainingProfit - pfondAmount;
  const corporateTax = round(taxableAfterPfond * c.CORP_TAX_RATE);
  const freeEquity = taxableAfterPfond - corporateTax;

  const recommendedDividend = Math.max(
    0,
    round(Math.min(totalDividendSpace, freeEquity, input.liquid_assets))
  );
  const dividendTax = round(recommendedDividend * c.DIVIDEND_TAX_RATE);
  const netDividend = recommendedDividend - dividendTax;
  const surplusInCompany = Math.max(0, freeEquity - recommendedDividend);

  return {
    gransbelopp: totalDividendSpace,
    dividend: recommendedDividend,
    dividend_tax: dividendTax,
    net_dividend: netDividend,
    corporate_tax: corporateTax,
    surplus_in_company: surplusInCompany,
  };
}

function computeDividendNet(salary: number, input: TaxOptimizerInput, c: TaxConstants): number {
  return computeDividendDetail(salary, input, c).net_dividend;
}

// ── STRATEGY E: UTDELNINGSMAX ──
// Lön 30 000/mån + ALLT fritt eget kapital som utdelning.
// Utdelning inom gränsbelopp: 20% kapitalskatt (IL 57:20).
// Utdelning över gränsbelopp: beskattas som tjänst (IL 57:20).
// JSA: enbart på lön, INTE utdelning-som-tjänst (IL 67:6 → 59 kap SFB).

function computeStrategyE(
  input: TaxOptimizerInput,
  rates: ResolvedRates,
  c: TaxConstants
): StrategyEScenario {
  const maxAffordable = round(input.profit_before_salary / (1 + c.EMPLOYER_FEE_RATE));
  const adjustedTarget = Math.max(0, c.SALARY_E - input.external_income);
  const salary = Math.max(0, Math.min(adjustedTarget, maxAffordable));
  const employerFees = round(salary * c.EMPLOYER_FEE_RATE);
  const totalSalaryCost = salary + employerFees;
  const remainingProfit = input.profit_before_salary - totalSalaryCost;

  if (remainingProfit <= 0) {
    return {
      salary,
      net_salary: salary,
      total_in_pocket: salary,
      note: "Ej tillräckligt rörelseresultat för Strategi E.",
      gransbelopp: 0,
      fritt_ek: 0,
      employer_fee: employerFees,
      income_tax: 0,
      corporate_tax: 0,
      dividend_within_space: 0,
      dividend_over_space: 0,
      dividend_within_tax: 0,
      dividend_over_tax: 0,
      net_dividend: 0,
      retained_in_company: 0,
      effective_tax_rate: 0,
      effective_tax_rate_over: 0,
      warnings: [],
    };
  }

  // ── Gränsbelopp ──
  const totalPayroll = salary + input.total_payroll_others;
  let salaryBasedSpace = round(
    Math.max(0, c.SALARY_BASED_SHARE * (totalPayroll - c.SALARY_DEDUCTION))
  );
  salaryBasedSpace = Math.min(salaryBasedSpace, 50 * salary);
  const omkostnadsbelopp = input.omkostnadsbelopp ?? 25_000;
  const omkostnadsTillagg = Math.max(
    0,
    round((omkostnadsbelopp - c.OMKOSTNADSBELOPP_THRESHOLD) * (c.SLR + c.OMKOSTNADSBELOPP_RATE_ADDON))
  );
  const totalDividendSpace =
    c.BASE_AMOUNT + salaryBasedSpace + omkostnadsTillagg + input.saved_dividend_space;

  // ── Bolagsskatt & fritt eget kapital (ingen p-fond: allt tas ut) ──
  const corporateTax = round(remainingProfit * c.CORP_TAX_RATE);
  const freeEquity = remainingProfit - corporateTax;

  // ── Utdelning: ALLT tillgängligt (begränsat av likviditet) ──
  const availableForDistribution = Math.max(0, Math.min(freeEquity, input.liquid_assets));

  // Utdelning inom gränsbelopp → 20% kapitalskatt
  const dividendWithin = Math.max(0, Math.min(totalDividendSpace, availableForDistribution));
  const dividendWithinTax = round(dividendWithin * c.DIVIDEND_TAX_RATE);
  const netDividendWithin = dividendWithin - dividendWithinTax;

  // Utdelning över gränsbelopp → tjänsteinkomst (IL 57:20), ingen AG
  const dividendOver = Math.max(0, availableForDistribution - dividendWithin);

  // ── Personlig inkomstskatt: marginalmetod med JSA-separation ──
  // VIB-216: extern inkomst inkluderas i skatteberäkningen.
  const externalIncome = input.external_income ?? 0;

  // Steg 1: Pre-existing skatt på extern inkomst (ej hänförlig till strategi E)
  const taxFromExtern = calculateIncomeTax(externalIncome, rates, c);
  const jsaFromExtern = jobbskatteavdrag(externalIncome, taxFromExtern.grundavdrag, rates.KI, c.PBB);
  const netTaxExtern = Math.max(0, taxFromExtern.gross_tax - Math.min(jsaFromExtern, taxFromExtern.kommunalskatt));

  // Steg 2: Total tjänsteinkomst = lön + utdelning-som-tjänst + extern inkomst
  const taxFromTotal = calculateIncomeTax(salary + dividendOver + externalIncome, rates, c);
  const gaFromTotal = taxFromTotal.grundavdrag;

  // Steg 3: JSA enbart på arbetsinkomst (lön + extern inkomst, EJ IL 57:20-utdelning).
  // IL 67:6 → 59 kap SFB definierar "arbetsinkomst" — utdelning-som-tjänst ingår ej.
  const jsaFromLaborIncome = jobbskatteavdrag(salary + externalIncome, gaFromTotal, rates.KI, c.PBB);
  const jsaCapped = Math.min(jsaFromLaborIncome, taxFromTotal.kommunalskatt);
  const netTaxTotal = Math.max(0, taxFromTotal.gross_tax - jsaCapped);

  // Steg 4: Marginalskatt från strategi E (exkl. pre-existing extern inkomstskatt)
  const marginalNetTax = Math.max(0, netTaxTotal - netTaxExtern);

  // Steg 5: Fördelning — löndelen givet extern inkomst (marginalmetoden)
  const taxFromSalaryAndExtern = calculateIncomeTax(salary + externalIncome, rates, c);
  const jsaFromSalaryAndExtern = jobbskatteavdrag(salary + externalIncome, taxFromSalaryAndExtern.grundavdrag, rates.KI, c.PBB);
  const netTaxSalaryAndExtern = Math.max(0, taxFromSalaryAndExtern.gross_tax - Math.min(jsaFromSalaryAndExtern, taxFromSalaryAndExtern.kommunalskatt));
  const netTaxSalaryGivenExternal = Math.max(0, netTaxSalaryAndExtern - netTaxExtern);
  const dividendOverTax = Math.max(0, marginalNetTax - netTaxSalaryGivenExternal);

  // ── Nettoresultat ──
  const netSalary = salary - netTaxSalaryGivenExternal;
  const netDividendOver = dividendOver - dividendOverTax;
  const netDividend = netDividendWithin + netDividendOver;
  const totalInPocket = netSalary + netDividendWithin + netDividendOver;
  const retainedInCompany = Math.max(0, freeEquity - dividendWithin - dividendOver);

  // ── Effektiva skattesatser ──
  const totalTaxPaid = employerFees + marginalNetTax + corporateTax + dividendWithinTax;
  const effectiveTaxRate =
    input.profit_before_salary > 0 ? totalTaxPaid / input.profit_before_salary : 0;
  const effectiveTaxRateOver = dividendOver > 0 ? dividendOverTax / dividendOver : 0;

  const warnings: string[] = [];
  if (dividendOver > 0) {
    warnings.push(
      "Utdelning över gränsbeloppet ger mer i fickan idag men bygger inte SGI, pension eller sjukpenningunderlag. Överväg privat sjukförsäkring."
    );
  }

  return {
    salary,
    net_salary: netSalary,
    total_in_pocket: totalInPocket,
    note: "Lön 30 000/mån + ALLT fritt eget kapital som utdelning. Utdelning över gränsbelopp beskattas som tjänst (IL 57:20). Ingen SGI/pension byggs på utdelningsdelen.",
    gransbelopp: totalDividendSpace,
    fritt_ek: freeEquity,
    employer_fee: employerFees,
    income_tax: netTaxSalaryGivenExternal,
    corporate_tax: corporateTax,
    dividend_within_space: dividendWithin,
    dividend_over_space: dividendOver,
    dividend_within_tax: dividendWithinTax,
    dividend_over_tax: dividendOverTax,
    net_dividend: netDividend,
    retained_in_company: retainedInCompany,
    effective_tax_rate: Math.round(effectiveTaxRate * 10000) / 10000,
    effective_tax_rate_over: Math.round(effectiveTaxRateOver * 10000) / 10000,
    warnings,
  };
}

// ── OPTIMIZER: MAIN ──

export function optimize(
  input: TaxOptimizerInput,
  constants: TaxConstants = TAX_CONSTANTS_2026
): TaxOptimizerOutput {
  const c = constants;
  const warnings: string[] = [];
  const blockers: string[] = [];

  // ── RESOLVE RATES ──
  const rates = resolveRates(
    input.kommun,
    input.church_member,
    input.municipal_tax_rate_override
  );

  // ── FAILSAFES ──

  if (input.is_holding_company) {
    blockers.push(
      "MVP stöder inte koncernstrukturer. Kontakta rådgivare."
    );
  }
  if (input.num_owners > 1) {
    blockers.push("MVP stöder enbart enägare-AB. Kontakta rådgivare.");
  }
  if (input.profit_before_salary < 0) {
    blockers.push(
      "Bolaget går med förlust. Ingen optimering möjlig."
    );
  }
  if (input.is_over_66) {
    blockers.push(
      "MVP stöder ej förhöjt grundavdrag (66+). Kontakta rådgivare."
    );
  }
  if (input.has_working_relatives) {
    warnings.push(
      "Närståenderegeln kan påverka beräkningen. Kontakta rådgivare."
    );
  }
  if (input.total_payroll_others > 0) {
    warnings.push(
      "B2C MVP: Optimerad för ensamkonsulter utan anställda."
    );
  }

  // If blockers, return zeroed output
  if (blockers.length > 0) {
    return zeroedOutput(blockers, warnings, c);
  }

  // ── STEP 1: SALARY ──

  const targets = getSalaryTargets(c);
  const maxAffordable = round(
    input.profit_before_salary / (1 + c.EMPLOYER_FEE_RATE)
  );

  // Chosen strategy target
  const chosenTarget = targets[input.salary_strategy];
  const adjustedTarget = Math.max(0, chosenTarget - input.external_income);
  const salary = Math.max(0, round(Math.min(adjustedTarget, maxAffordable)));

  const employerFees = round(salary * c.EMPLOYER_FEE_RATE);
  const totalSalaryCost = salary + employerFees;

  const { marginalTax: salaryTax, totalBreakdown: taxBreakdown } =
    salaryIncomeTax(salary, input.external_income, rates, c);
  const netSalary = salary - salaryTax;

  // ── BUILD ALL SALARY SCENARIOS ──

  const dividendDetailFn = (s: number) => computeDividendDetail(s, input, c);

  const salaryScenarios = {
    sgi: buildSalaryScenario(
      targets.sgi,
      input.external_income,
      input.profit_before_salary,
      rates,
      c,
      "Maximerar SGI (sjukpenninggrundande inkomst). 10 × PBB.",
      dividendDetailFn
    ),
    pension: buildSalaryScenario(
      targets.pension,
      input.external_income,
      input.profit_before_salary,
      rates,
      c,
      "Maximerar pensionsgrundande inkomst (PGI). Ger max allmän pension.",
      dividendDetailFn
    ),
    balanced: buildSalaryScenario(
      targets.balanced,
      input.external_income,
      input.profit_before_salary,
      rates,
      c,
      "Lön upp till brytpunkten. Balans mellan skatt och trygghet.",
      dividendDetailFn
    ),
  };

  // ── STRATEGY D: MINIMILÖN ──
  const strategy_d = buildSalaryScenario(
    c.SALARY_D,
    input.external_income,
    input.profit_before_salary,
    rates,
    c,
    "Minimilön (28 000/mån). Minimal personlig skatt — maximerar kvarliggande kapital i bolaget.",
    dividendDetailFn
  );

  // ── STRATEGY E: UTDELNINGSMAX ──
  const strategy_e = computeStrategyE(input, rates, c);

  // ── STEP 2: DIVIDEND SPACE ──

  const totalPayroll = salary + input.total_payroll_others;
  let salaryBasedSpace = round(
    Math.max(0, c.SALARY_BASED_SHARE * (totalPayroll - c.SALARY_DEDUCTION))
  );
  // 50x cap
  salaryBasedSpace = Math.min(salaryBasedSpace, 50 * salary);

  const baseAmount = c.BASE_AMOUNT;

  // Omkostnadsbelopp
  const omkostnadsbelopp = input.omkostnadsbelopp ?? 25_000;
  const omkostnadsTillagg = Math.max(
    0,
    round(
      (omkostnadsbelopp - c.OMKOSTNADSBELOPP_THRESHOLD) *
        (c.SLR + c.OMKOSTNADSBELOPP_RATE_ADDON)
    )
  );

  const totalDividendSpace =
    baseAmount + salaryBasedSpace + omkostnadsTillagg + input.saved_dividend_space;

  const remainingProfit = input.profit_before_salary - totalSalaryCost;

  // ── STEP 3: P-FOND (sabbatical — applied BEFORE dividend) ──

  let appliedPfond = 0;
  let pfondRecommended = false;

  if (input.planned_downtime_within_3_years && remainingProfit > 0) {
    appliedPfond = computePfondAmount(
      remainingProfit, totalDividendSpace, input.liquid_assets, c
    );
    pfondRecommended = appliedPfond > 0;
  }

  // ── STEP 4: CORPORATE TAX & EQUITY (pfond reduces tax base) ──

  const taxableAfterPfond = remainingProfit - appliedPfond;
  const corporateTax = round(taxableAfterPfond * c.CORP_TAX_RATE);
  const freeEquity = taxableAfterPfond - corporateTax;

  // ── STEP 5: THREE-CAP DIVIDEND ──

  let recommendedDividend: number;
  let capReason: "space" | "equity" | "liquidity";

  if (
    totalDividendSpace <= freeEquity &&
    totalDividendSpace <= input.liquid_assets
  ) {
    recommendedDividend = totalDividendSpace;
    capReason = "space";
  } else if (
    freeEquity <= totalDividendSpace &&
    freeEquity <= input.liquid_assets
  ) {
    recommendedDividend = freeEquity;
    capReason = "equity";
  } else {
    recommendedDividend = input.liquid_assets;
    capReason = "liquidity";
  }

  recommendedDividend = Math.max(0, round(recommendedDividend));

  if (
    recommendedDividend > input.liquid_assets &&
    capReason !== "liquidity"
  ) {
    warnings.push(
      "Utdelningen överstiger tillgänglig kassa. Risk för likviditetsbrist."
    );
  }

  // Safety buffer
  const safetyBuffer = input.safety_buffer ?? 0;
  const recommendedDividendAfterBuffer = Math.max(
    0, recommendedDividend - safetyBuffer
  );

  const dividendTax = round(recommendedDividend * c.DIVIDEND_TAX_RATE);
  const netDividend = recommendedDividend - dividendTax;
  const savedSpaceNextYear = Math.max(
    0,
    totalDividendSpace - recommendedDividend
  );

  // ── STEP 6: SURPLUS ──

  const surplusAfterDividend = Math.max(0, freeEquity - recommendedDividend);

  // ── P-FOND SCENARIO ──
  // For sabbatical: appliedPfond is the actual deduction.
  // For non-sabbatical: compute as a display-only scenario.
  let scenarioPfondAmount: number;
  if (input.planned_downtime_within_3_years) {
    scenarioPfondAmount = appliedPfond;
  } else {
    const pfondMax = round(remainingProfit * c.PFOND_MAX_SHARE);
    const pretaxSurplus = round(
      surplusAfterDividend / (1 - c.CORP_TAX_RATE)
    );
    scenarioPfondAmount = Math.min(pretaxSurplus, pfondMax);
  }

  const pfondTaxDeferred = round(scenarioPfondAmount * c.CORP_TAX_RATE);
  const reversalYear = new Date().getFullYear() + c.PFOND_REVERSAL_YEARS;
  const discountFactor =
    1 - 1 / Math.pow(1 + c.PFOND_DISCOUNT_RATE, c.PFOND_REVERSAL_YEARS);
  const pfondNetEffect = round(pfondTaxDeferred * discountFactor);

  // ── RETAIN SCENARIO ──

  const retainAmount = surplusAfterDividend;
  const retainTaxPaid = round(
    (surplusAfterDividend / (1 - c.CORP_TAX_RATE)) * c.CORP_TAX_RATE
  );

  // ── TOTALS ──

  const totalInPocket = netSalary + netDividend;

  const totalTaxPaid =
    salaryTax + employerFees + corporateTax + dividendTax;
  const effectiveTaxRate =
    input.profit_before_salary > 0
      ? totalTaxPaid / input.profit_before_salary
      : 0;

  // Compare: what if everything was taken as salary?
  const allSalarySalary = round(
    input.profit_before_salary / (1 + c.EMPLOYER_FEE_RATE)
  );
  const { marginalTax: allSalaryTax } = salaryIncomeTax(
    allSalarySalary,
    input.external_income,
    rates,
    c
  );
  const allSalaryNet = allSalarySalary - allSalaryTax;
  const taxSavedVsAllSalary =
    allSalaryNet > 0 ? totalInPocket - allSalaryNet : 0;

  return {
    recommended_salary: salary,
    employer_fees: employerFees,
    total_salary_cost: totalSalaryCost,
    salary_income_tax: salaryTax,
    net_salary: netSalary,
    tax_breakdown: taxBreakdown,

    salary_scenarios: salaryScenarios,

    strategy_d,
    strategy_e,

    base_amount: baseAmount,
    salary_based_space: salaryBasedSpace,
    total_dividend_space: totalDividendSpace,
    recommended_dividend: recommendedDividend,
    safety_buffer: safetyBuffer,
    recommended_dividend_after_buffer: recommendedDividendAfterBuffer,
    dividend_tax: dividendTax,
    net_dividend: netDividend,
    saved_space_next_year: savedSpaceNextYear,
    dividend_cap_reason: capReason,

    remaining_profit: remainingProfit,
    corporate_tax: corporateTax,
    free_equity: freeEquity,
    surplus_after_dividend: surplusAfterDividend,
    pfond_scenario: {
      amount: scenarioPfondAmount,
      tax_deferred: pfondTaxDeferred,
      reversal_year: reversalYear,
      net_effect_5yr: pfondNetEffect,
    },
    pfond_recommended: pfondRecommended,
    retain_scenario: {
      amount: retainAmount,
      tax_paid_now: retainTaxPaid,
      available_for_investment: retainAmount,
    },

    omkostnadsbelopp_tillagg: omkostnadsTillagg,

    total_in_pocket: totalInPocket,
    effective_tax_rate: Math.round(effectiveTaxRate * 10000) / 10000,
    tax_saved_vs_all_salary: taxSavedVsAllSalary,

    warnings,
    blockers,
    disclaimer: DISCLAIMER,
    constants_version: c.VERSION,
  };
}

// ── ZEROED OUTPUT (for blockers) ──

function zeroedOutput(
  blockers: string[],
  warnings: string[],
  c: TaxConstants
): TaxOptimizerOutput {
  const zeroBreakdown: TaxBreakdown = {
    grundavdrag: 0,
    kommunalskatt: 0,
    begravningsavgift: 0,
    kyrkoavgift: 0,
    statlig_skatt: 0,
    gross_tax: 0,
    jobbskatteavdrag: 0,
    net_tax: 0,
  };
  const zeroScenario: SalaryScenario = {
    salary: 0,
    net_salary: 0,
    total_in_pocket: 0,
    note: "",
    gransbelopp: 0,
    dividend: 0,
    dividend_tax: 0,
    net_dividend: 0,
    employer_fee: 0,
    income_tax: 0,
    corporate_tax: 0,
    surplus_in_company: 0,
  };
  return {
    recommended_salary: 0,
    employer_fees: 0,
    total_salary_cost: 0,
    salary_income_tax: 0,
    net_salary: 0,
    tax_breakdown: zeroBreakdown,
    salary_scenarios: {
      sgi: zeroScenario,
      pension: zeroScenario,
      balanced: zeroScenario,
    },
    strategy_d: zeroScenario,
    strategy_e: {
      salary: 0,
      net_salary: 0,
      total_in_pocket: 0,
      note: "",
      gransbelopp: 0,
      fritt_ek: 0,
      employer_fee: 0,
      income_tax: 0,
      corporate_tax: 0,
      dividend_within_space: 0,
      dividend_over_space: 0,
      dividend_within_tax: 0,
      dividend_over_tax: 0,
      net_dividend: 0,
      retained_in_company: 0,
      effective_tax_rate: 0,
      effective_tax_rate_over: 0,
      warnings: [],
    },
    base_amount: 0,
    salary_based_space: 0,
    total_dividend_space: 0,
    recommended_dividend: 0,
    safety_buffer: 0,
    recommended_dividend_after_buffer: 0,
    dividend_tax: 0,
    net_dividend: 0,
    saved_space_next_year: 0,
    dividend_cap_reason: "space",
    remaining_profit: 0,
    corporate_tax: 0,
    free_equity: 0,
    surplus_after_dividend: 0,
    pfond_scenario: {
      amount: 0,
      tax_deferred: 0,
      reversal_year: 0,
      net_effect_5yr: 0,
    },
    pfond_recommended: false,
    retain_scenario: {
      amount: 0,
      tax_paid_now: 0,
      available_for_investment: 0,
    },
    omkostnadsbelopp_tillagg: 0,
    total_in_pocket: 0,
    effective_tax_rate: 0,
    tax_saved_vs_all_salary: 0,
    warnings,
    blockers,
    disclaimer: DISCLAIMER,
    constants_version: c.VERSION,
  };
}

const DISCLAIMER =
  "Detta är ett matematiskt beslutsstöd baserat på publicerade skatteregler " +
  "för inkomståret 2026. Det utgör inte skatterådgivning, juridisk rådgivning " +
  "eller revisionsutlåtande. Beräkningarna bygger på förenklade modeller. " +
  "Användaren bär fullt deklarationsansvar. Konsultera alltid redovisningskonsult " +
  "eller auktoriserad revisor innan inkomstdeklaration.";
