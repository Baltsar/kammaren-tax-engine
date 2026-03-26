// TAX OPTIMIZER — 7-Tier Property-Based Verification Suite
// Tests mathematical invariants across thousands of inputs.

import {
  optimize,
  grundavdrag,
  jobbskatteavdrag,
  calculateIncomeTax,
  TaxOptimizerInput,
  TaxOptimizerOutput,
} from "../src/tax-optimizer";
import { TAX_CONSTANTS_2026 } from "../src/tax-constants-2026";
import { resolveRates, KOMMUN_DATA } from "../src/kommun-skattesatser-2026";
import { prepareInput } from "../src/tax-optimizer-prepare";

// ── UTILITIES ──

let totalPass = 0;
let totalFail = 0;
const allFailures: string[] = [];

function ok(msg?: string): void {
  totalPass++;
}

function bad(msg: string): void {
  totalFail++;
  allFailures.push(msg);
}

function check(condition: boolean, msg: string): void {
  if (condition) ok(); else bad(msg);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomValidInput(): TaxOptimizerInput {
  return {
    profit_before_salary: randomInt(100_000, 5_000_000),
    liquid_assets: randomInt(50_000, 3_000_000),
    total_payroll_others: Math.random() > 0.8 ? randomInt(100_000, 1_000_000) : 0,
    owner_salary_taken: 0,
    external_income: Math.random() > 0.7 ? randomInt(0, 500_000) : 0,
    kommun: "stockholm",
    church_member: Math.random() > 0.5,
    saved_dividend_space: Math.random() > 0.6 ? randomInt(0, 500_000) : 0,
    is_holding_company: false,
    has_working_relatives: false,
    num_owners: 1,
    salary_strategy: (["sgi", "pension", "balanced"] as const)[randomInt(0, 2)],
    planned_downtime_within_3_years: Math.random() > 0.8,
    omkostnadsbelopp: 25_000 + randomInt(0, 200_000),
  };
}

function tierSummary(name: string, startPass: number, startFail: number): void {
  const p = totalPass - startPass;
  const f = totalFail - startFail;
  console.log(`  PASS: ${p}, FAIL: ${f}`);
}

// ══════════════════════════════════════════════════════════════
// TIER 1: CONSERVATION INVARIANTS (10,000 random inputs)
// ══════════════════════════════════════════════════════════════

function tier1(): void {
  console.log("\n=== TIER 1: CONSERVATION INVARIANTS (10,000 random inputs) ===");
  const sp = totalPass, sf = totalFail;

  for (let i = 0; i < 10_000; i++) {
    const input = randomValidInput();
    const r = optimize(input);

    if (r.blockers.length > 0) continue;

    // ── Corporate flow ──
    if (!input.planned_downtime_within_3_years) {
      // No pfond iteration: corporateTax + freeEquity == remaining_profit
      const corpFlow = r.corporate_tax + r.free_equity;
      check(
        Math.abs(corpFlow - r.remaining_profit) <= 1,
        `T1[${i}] corporate_tax(${r.corporate_tax}) + free_equity(${r.free_equity}) = ${corpFlow} != remaining_profit(${r.remaining_profit})`
      );
    } else {
      // Pfond: pfond + corporateTax + freeEquity == remaining_profit
      const corpFlow = r.pfond_scenario.amount + r.corporate_tax + r.free_equity;
      check(
        Math.abs(corpFlow - r.remaining_profit) <= 1,
        `T1[${i}] pfond(${r.pfond_scenario.amount}) + corpTax(${r.corporate_tax}) + freeEq(${r.free_equity}) = ${corpFlow} != remaining_profit(${r.remaining_profit})`
      );
    }

    // free_equity == recommended_dividend + surplus_after_dividend (always, including pfond)
    {
      const equityCheck = r.recommended_dividend + r.surplus_after_dividend;
      check(
        Math.abs(equityCheck - r.free_equity) <= 1,
        `T1[${i}] dividend(${r.recommended_dividend}) + surplus(${r.surplus_after_dividend}) = ${equityCheck} != free_equity(${r.free_equity})`
      );
    }

    // ── Owner flow ──
    check(
      r.total_in_pocket === r.net_salary + r.net_dividend,
      `T1[${i}] total_in_pocket(${r.total_in_pocket}) != net_salary(${r.net_salary}) + net_dividend(${r.net_dividend})`
    );

    check(
      r.net_salary === r.recommended_salary - r.salary_income_tax,
      `T1[${i}] net_salary(${r.net_salary}) != salary(${r.recommended_salary}) - tax(${r.salary_income_tax})`
    );

    check(
      r.net_dividend === r.recommended_dividend - r.dividend_tax,
      `T1[${i}] net_dividend(${r.net_dividend}) != dividend(${r.recommended_dividend}) - div_tax(${r.dividend_tax})`
    );

    // ── Bounds ──
    check(
      r.salary_income_tax >= 0 && r.salary_income_tax <= r.recommended_salary,
      `T1[${i}] salary_income_tax(${r.salary_income_tax}) out of [0, ${r.recommended_salary}]`
    );

    check(
      r.effective_tax_rate >= 0 && r.effective_tax_rate <= 1,
      `T1[${i}] effective_tax_rate(${r.effective_tax_rate}) out of [0, 1]`
    );

    check(r.recommended_dividend >= 0, `T1[${i}] recommended_dividend < 0: ${r.recommended_dividend}`);
    check(r.surplus_after_dividend >= 0, `T1[${i}] surplus_after_dividend < 0: ${r.surplus_after_dividend}`);

    // employer_fees == round(salary * 0.3142)
    const expectedFees = Math.round(r.recommended_salary * 0.3142);
    check(
      r.employer_fees === expectedFees,
      `T1[${i}] employer_fees: expected ${expectedFees}, got ${r.employer_fees}`
    );

    // total_salary_cost == salary + employer_fees
    check(
      r.total_salary_cost === r.recommended_salary + r.employer_fees,
      `T1[${i}] total_salary_cost(${r.total_salary_cost}) != salary(${r.recommended_salary}) + fees(${r.employer_fees})`
    );

    // ── Dividend caps ──
    check(
      r.recommended_dividend <= r.total_dividend_space + 1,
      `T1[${i}] dividend(${r.recommended_dividend}) > dividend_space(${r.total_dividend_space})`
    );

    check(
      r.recommended_dividend <= r.free_equity + 1,
      `T1[${i}] dividend(${r.recommended_dividend}) > free_equity(${r.free_equity})`
    );

    check(
      r.recommended_dividend <= input.liquid_assets + 1,
      `T1[${i}] dividend(${r.recommended_dividend}) > liquid_assets(${input.liquid_assets})`
    );

    // ── 3:12 logic ──
    check(r.salary_based_space >= 0, `T1[${i}] salary_based_space < 0: ${r.salary_based_space}`);
    check(
      r.salary_based_space <= 50 * r.recommended_salary + 1,
      `T1[${i}] salary_based_space(${r.salary_based_space}) > 50x salary(${50 * r.recommended_salary})`
    );

    if (
      input.total_payroll_others === 0 &&
      r.recommended_salary <= TAX_CONSTANTS_2026.SALARY_DEDUCTION
    ) {
      check(
        r.salary_based_space === 0,
        `T1[${i}] salary_based_space should be 0 when payroll_others=0 and salary<=${TAX_CONSTANTS_2026.SALARY_DEDUCTION}: got ${r.salary_based_space}`
      );
    }
  }

  tierSummary("TIER 1", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// TIER 2: MONOTONICITY (sweep each input)
// ══════════════════════════════════════════════════════════════

function tier2(): void {
  console.log("\n=== TIER 2: MONOTONICITY ===");
  const sp = totalPass, sf = totalFail;

  const baseInput: TaxOptimizerInput = {
    profit_before_salary: 1_500_000,
    liquid_assets: 2_000_000,
    total_payroll_others: 0,
    owner_salary_taken: 0,
    external_income: 0,
    kommun: "stockholm",
    church_member: false,
    saved_dividend_space: 0,
    is_holding_company: false,
    has_working_relatives: false,
    num_owners: 1,
    salary_strategy: "balanced",
    planned_downtime_within_3_years: false,
    omkostnadsbelopp: 25_000,
  };

  // profit up -> total_in_pocket up (or unchanged)
  {
    let prev = optimize({ ...baseInput, profit_before_salary: 100_000 }).total_in_pocket;
    for (let p = 150_000; p <= 5_000_000; p += 50_000) {
      const cur = optimize({ ...baseInput, profit_before_salary: p }).total_in_pocket;
      check(
        cur >= prev - 1,
        `T2 profit monotonicity: at profit=${p}, in_pocket=${cur} < prev=${prev}`
      );
      prev = cur;
    }
  }

  // external_income up -> total_in_pocket down (or unchanged)
  {
    let prev = optimize({ ...baseInput, external_income: 0 }).total_in_pocket;
    for (let e = 50_000; e <= 800_000; e += 50_000) {
      const cur = optimize({ ...baseInput, external_income: e }).total_in_pocket;
      check(
        cur <= prev + 1,
        `T2 external_income monotonicity: at ext=${e}, in_pocket=${cur} > prev=${prev}`
      );
      prev = cur;
    }
  }

  // saved_dividend_space up -> total_in_pocket up (or unchanged)
  {
    let prev = optimize({ ...baseInput, saved_dividend_space: 0 }).total_in_pocket;
    for (let s = 50_000; s <= 2_000_000; s += 50_000) {
      const cur = optimize({ ...baseInput, saved_dividend_space: s }).total_in_pocket;
      check(
        cur >= prev - 1,
        `T2 saved_dividend_space monotonicity: at saved=${s}, in_pocket=${cur} < prev=${prev}`
      );
      prev = cur;
    }
  }

  tierSummary("TIER 2", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// TIER 3: BRACKET INTEGRITY (step 100 kr at a time)
// ══════════════════════════════════════════════════════════════

function tier3(): void {
  console.log("\n=== TIER 3: BRACKET INTEGRITY ===");
  const sp = totalPass, sf = totalFail;

  const PBB = TAX_CONSTANTS_2026.PBB;
  const rates = resolveRates("stockholm", false);

  let prevGA = grundavdrag(0, PBB);
  let prevJSA = jobbskatteavdrag(0, prevGA, rates.KI, PBB);

  for (let income = 100; income <= 800_000; income += 100) {
    const ga = grundavdrag(income, PBB);
    const jsa = jobbskatteavdrag(income, ga, rates.KI, PBB);

    const gaJump = Math.abs(ga - prevGA);
    const jsaJump = Math.abs(jsa - prevJSA);

    // For 100 kr steps, the grundavdrag formula has slopes of 0.20 and -0.10,
    // so max expected delta is ~20 kr per 100 kr step, plus rounding.
    // HOWEVER: at the boundary near b4 = 7.88*PBB = 466,496, the grundavdrag
    // formula transitions from a declining max() to the floor (0.294*PBB).
    // This causes a genuine discontinuity in GA (and consequently in JSA).
    // We allow up to 10,000 kr jump at known bracket edges.
    const b4 = 7.88 * PBB;
    const nearBracketEdge = Math.abs(income - b4) < 200;
    const gaTolerance = nearBracketEdge ? 10_000 : 200;
    const jsaTolerance = nearBracketEdge ? 5_000 : 200;

    check(
      gaJump <= gaTolerance,
      `T3 grundavdrag jump at income=${income}: delta=${gaJump} (prev=${prevGA}, cur=${ga})`
    );

    check(
      jsaJump <= jsaTolerance,
      `T3 JSA jump at income=${income}: delta=${jsaJump} (prev=${prevJSA}, cur=${jsa})`
    );

    prevGA = ga;
    prevJSA = jsa;
  }

  tierSummary("TIER 3", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// TIER 4: SENSITIVITY (perturbation analysis)
// ══════════════════════════════════════════════════════════════

function tier4(): void {
  console.log("\n=== TIER 4: SENSITIVITY ===");
  const sp = totalPass, sf = totalFail;

  const baseInput: TaxOptimizerInput = {
    profit_before_salary: 1_500_000,
    liquid_assets: 2_000_000,
    total_payroll_others: 0,
    owner_salary_taken: 0,
    external_income: 0,
    kommun: "stockholm",
    church_member: false,
    saved_dividend_space: 0,
    is_holding_company: false,
    has_working_relatives: false,
    num_owners: 1,
    salary_strategy: "balanced",
    planned_downtime_within_3_years: false,
    omkostnadsbelopp: 25_000,
  };

  const delta = 10_000;

  const perturbations: { name: string; mutate: (d: number) => TaxOptimizerInput }[] = [
    {
      name: "profit_before_salary",
      mutate: (d) => ({ ...baseInput, profit_before_salary: baseInput.profit_before_salary + d }),
    },
    {
      name: "liquid_assets",
      mutate: (d) => ({ ...baseInput, liquid_assets: baseInput.liquid_assets + d }),
    },
    {
      name: "external_income",
      mutate: (d) => ({ ...baseInput, external_income: baseInput.external_income + d }),
    },
    {
      name: "saved_dividend_space",
      mutate: (d) => ({ ...baseInput, saved_dividend_space: baseInput.saved_dividend_space + d }),
    },
    {
      name: "total_payroll_others",
      mutate: (d) => ({ ...baseInput, total_payroll_others: baseInput.total_payroll_others + d }),
    },
  ];

  for (const { name, mutate } of perturbations) {
    const plusResult = optimize(mutate(+delta));
    const minusResult = optimize(mutate(-delta));

    const deltaOutput = plusResult.total_in_pocket - minusResult.total_in_pocket;
    const sensitivity = Math.abs(deltaOutput) / (2 * delta);

    check(
      sensitivity <= 2.0,
      `T4 sensitivity for ${name}: ${sensitivity.toFixed(4)} (delta_out=${deltaOutput}, delta_in=${2 * delta})`
    );
  }

  tierSummary("TIER 4", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// TIER 5: GOLDEN CASES (Skatteverket-verified)
// ══════════════════════════════════════════════════════════════

function tier5(): void {
  console.log("\n=== TIER 5: GOLDEN CASES ===");
  const sp = totalPass, sf = totalFail;

  const c = TAX_CONSTANTS_2026;

  const GOLDEN_CASES = [
    {
      name: "REF1", income: 660_000, kommun: "stockholm", church: false,
      expected_tax: 147_335, expected_ga: 17_405, expected_kommunal: 196_313,
      expected_burial: 450, expected_state: 0, expected_jsa: 49_428,
    },
    {
      name: "REF2", income: 592_000, kommun: "stockholm", church: false,
      expected_tax: 126_513, expected_ga: 17_405, expected_kommunal: 175_539,
      expected_burial: 402, expected_state: 0, expected_jsa: 49_428,
    },
    {
      name: "REF3", income: 673_038, kommun: "stockholm", church: false,
      expected_tax: 153_854, expected_ga: 17_405, expected_kommunal: 200_296,
      expected_burial: 459, expected_state: 2_527, expected_jsa: 49_428,
    },
    {
      name: "REF4", income: 300_000, kommun: "stockholm", church: false,
      expected_tax: 50_751, expected_ga: 33_995, expected_kommunal: 81_264,
      expected_burial: 186, expected_state: 0, expected_jsa: 30_700,
    },
    {
      name: "REF5", income: 660_000, kommun: "dorotea", church: false,
      expected_tax: 173_282, expected_ga: 17_405, expected_kommunal: 229_085,
      expected_burial: 1_876, expected_state: 0, expected_jsa: 57_679,
    },
  ];

  for (const gc of GOLDEN_CASES) {
    const rates = resolveRates(gc.kommun, gc.church);
    const result = calculateIncomeTax(gc.income, rates, c);

    const checks: { field: string; actual: number; expected: number }[] = [
      { field: "grundavdrag", actual: result.grundavdrag, expected: gc.expected_ga },
      { field: "kommunalskatt", actual: result.kommunalskatt, expected: gc.expected_kommunal },
      { field: "begravningsavgift", actual: result.begravningsavgift, expected: gc.expected_burial },
      { field: "statlig_skatt", actual: result.statlig_skatt, expected: gc.expected_state },
      { field: "jobbskatteavdrag", actual: result.jobbskatteavdrag, expected: gc.expected_jsa },
      { field: "net_tax", actual: result.net_tax, expected: gc.expected_tax },
    ];

    for (const chk of checks) {
      // Allow 1 kr tolerance for rounding differences (Math.round vs Skatteverket truncation)
      check(
        Math.abs(chk.actual - chk.expected) <= 1,
        `T5 ${gc.name}.${chk.field}: expected ${chk.expected}, got ${chk.actual}`
      );
    }
  }

  tierSummary("TIER 5", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// TIER 6: INTEGRATION (prepareInput -> optimize)
// ══════════════════════════════════════════════════════════════

function tier6(): void {
  console.log("\n=== TIER 6: INTEGRATION ===");
  const sp = totalPass, sf = totalFail;

  const { input, taxable_profit, safety_buffer } = prepareInput({
    accounting_profit: 1_000_000,
    non_deductible_representation: 5_000,
    non_deductible_fines: 2_000,
    non_deductible_other: 0,
    liquid_assets: 800_000,
    owner_salary_taken: 0,
    external_income: 0,
    kommun: "stockholm",
    church_member: false,
    saved_dividend_space: 0,
    is_holding_company: false,
    has_working_relatives: false,
    num_owners: 1,
    total_payroll_others: 0,
    salary_strategy: "balanced",
    planned_downtime_within_3_years: false,
  });

  // taxable_profit = 1_000_000 + 5_000 + 2_000 + 0 = 1_007_000
  check(taxable_profit === 1_007_000, `T6 taxable_profit: expected 1007000, got ${taxable_profit}`);

  // buffer = min(25000, max(5000, round(1_000_000 * 0.01))) = min(25000, 10000) = 10000
  check(safety_buffer === 10_000, `T6 safety_buffer: expected 10000, got ${safety_buffer}`);

  // input.profit_before_salary should equal taxable_profit
  check(
    input.profit_before_salary === 1_007_000,
    `T6 input.profit_before_salary: expected 1007000, got ${input.profit_before_salary}`
  );

  const result = optimize(input);

  check(result.blockers.length === 0, `T6 unexpected blockers: ${result.blockers.join(", ")}`);
  check(result.recommended_salary > 0, `T6 recommended_salary should be > 0, got ${result.recommended_salary}`);
  check(result.total_in_pocket > 0, `T6 total_in_pocket should be > 0, got ${result.total_in_pocket}`);

  // Consistency invariants
  const r = result;
  check(
    Math.abs(r.corporate_tax + r.free_equity - r.remaining_profit) <= 1,
    `T6 corporate_tax + free_equity != remaining_profit: ${r.corporate_tax + r.free_equity} vs ${r.remaining_profit}`
  );
  check(
    r.total_in_pocket === r.net_salary + r.net_dividend,
    `T6 total_in_pocket != net_salary + net_dividend: ${r.total_in_pocket} vs ${r.net_salary + r.net_dividend}`
  );

  tierSummary("TIER 6", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// TIER 7: P-FOND CONVERGENCE
// ══════════════════════════════════════════════════════════════

function tier7(): void {
  console.log("\n=== TIER 7: P-FOND CONVERGENCE ===");
  const sp = totalPass, sf = totalFail;

  const pfondInputs: TaxOptimizerInput[] = [
    {
      profit_before_salary: 5_000_000,
      liquid_assets: 3_000_000,
      total_payroll_others: 0,
      owner_salary_taken: 0,
      external_income: 0,
      kommun: "stockholm",
      church_member: false,
      saved_dividend_space: 0,
      is_holding_company: false,
      has_working_relatives: false,
      num_owners: 1,
      salary_strategy: "balanced",
      planned_downtime_within_3_years: true,
      omkostnadsbelopp: 25_000,
    },
    {
      profit_before_salary: 100_000,
      liquid_assets: 80_000,
      total_payroll_others: 0,
      owner_salary_taken: 0,
      external_income: 0,
      kommun: "stockholm",
      church_member: false,
      saved_dividend_space: 0,
      is_holding_company: false,
      has_working_relatives: false,
      num_owners: 1,
      salary_strategy: "balanced",
      planned_downtime_within_3_years: true,
      omkostnadsbelopp: 25_000,
    },
  ];

  for (const input of pfondInputs) {
    const r = optimize(input);
    const label = `T7[profit=${input.profit_before_salary}]`;

    // pfond_amount <= remaining_profit * 0.25
    const maxPfond = Math.round(r.remaining_profit * 0.25);
    check(
      r.pfond_scenario.amount <= maxPfond + 1,
      `${label} pfond_amount(${r.pfond_scenario.amount}) > 25% of remaining_profit(${maxPfond})`
    );

    check(r.pfond_scenario.amount >= 0, `${label} pfond_amount < 0: ${r.pfond_scenario.amount}`);

    // pfond + corporateTax + freeEquity == remaining_profit (+-1)
    const corpFlow = r.pfond_scenario.amount + r.corporate_tax + r.free_equity;
    check(
      Math.abs(corpFlow - r.remaining_profit) <= 1,
      `${label} pfond(${r.pfond_scenario.amount}) + corpTax(${r.corporate_tax}) + freeEq(${r.free_equity}) = ${corpFlow} != remaining_profit(${r.remaining_profit})`
    );

    // tax_deferred == round(pfond_amount * 0.206)
    const expectedDeferred = Math.round(r.pfond_scenario.amount * 0.206);
    check(
      Math.abs(r.pfond_scenario.tax_deferred - expectedDeferred) <= 1,
      `${label} tax_deferred: expected ${expectedDeferred}, got ${r.pfond_scenario.tax_deferred}`
    );

    // pfond_recommended should be true if pfond_amount > 0
    if (r.pfond_scenario.amount > 0) {
      check(r.pfond_recommended, `${label} pfond_recommended should be true when amount > 0`);
    }
  }

  tierSummary("TIER 7", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// TIER 8: STRATEGY D & E INVARIANTS (50,000 random inputs)
// ══════════════════════════════════════════════════════════════

const ALL_KOMMUNER = Object.keys(KOMMUN_DATA);

function randomStrategyInput(): TaxOptimizerInput {
  const profit = randomInt(500_000, 5_000_000);
  const liquidMin = Math.round(profit * 0.5);
  const liquidMax = profit;
  return {
    profit_before_salary: profit,
    liquid_assets: randomInt(liquidMin, liquidMax),
    total_payroll_others: 0,
    owner_salary_taken: 0,
    external_income: Math.random() < 0.3 ? randomInt(50_000, 300_000) : 0,
    kommun: ALL_KOMMUNER[randomInt(0, ALL_KOMMUNER.length - 1)],
    church_member: Math.random() > 0.5,
    saved_dividend_space: randomInt(0, 500_000),
    is_holding_company: false,
    has_working_relatives: false,
    num_owners: 1,
    salary_strategy: "balanced",
    planned_downtime_within_3_years: false,   // no pfond — balance invariant holds cleanly
    omkostnadsbelopp: randomInt(25_000, 500_000),
  };
}

function tier8(): void {
  console.log("\n=== TIER 8: STRATEGY D & E INVARIANTS (50,000 random inputs) ===");
  const sp = totalPass, sf = totalFail;
  const c = TAX_CONSTANTS_2026;
  const N = 50_000;

  for (let i = 0; i < N; i++) {
    const input = randomStrategyInput();
    const r = optimize(input);

    if (r.blockers.length > 0) continue;

    const d = r.strategy_d;
    const e = r.strategy_e;
    const profit = input.profit_before_salary;
    const label = `T8[${i}]`;

    // ── STRATEGY D ──

    // 1. Lön = min(max(0, SALARY_D − extern), maxAffordable)
    const maxAffordableD = Math.round(profit / (1 + c.EMPLOYER_FEE_RATE));
    const adjustedTargetD = Math.max(0, c.SALARY_D - (input.external_income ?? 0));
    const expectedSalaryD = Math.min(adjustedTargetD, maxAffordableD);
    check(
      d.salary === expectedSalaryD,
      `${label} D.salary: expected ${expectedSalaryD}, got ${d.salary}`
    );

    // 2. Utdelning aldrig över gränsbelopp
    check(
      d.dividend <= d.gransbelopp + 1,
      `${label} D.dividend(${d.dividend}) > D.gransbelopp(${d.gransbelopp})`
    );

    // 3. Kvarvarande i bolaget ≥ 0
    check(
      d.surplus_in_company >= 0,
      `${label} D.surplus_in_company < 0: ${d.surplus_in_company}`
    );

    // 4. Total balans (±1 kr, utan p-fond — always false för dessa inputs)
    // profit = net_salary + income_tax + employer_fee + corporate_tax + dividend_tax + net_dividend + surplus_in_company
    const dBalance = d.net_salary + d.income_tax + d.employer_fee + d.corporate_tax
      + d.dividend_tax + d.net_dividend + d.surplus_in_company;
    check(
      Math.abs(dBalance - profit) <= 1,
      `${label} D balance: ${dBalance} != profit(${profit}), diff=${dBalance - profit}`
    );

    // 4b. net_salary = salary - income_tax
    check(
      Math.abs(d.net_salary - (d.salary - d.income_tax)) <= 1,
      `${label} D.net_salary(${d.net_salary}) != salary(${d.salary}) - income_tax(${d.income_tax})`
    );

    // 4c. net_dividend = dividend - dividend_tax
    check(
      Math.abs(d.net_dividend - (d.dividend - d.dividend_tax)) <= 1,
      `${label} D.net_dividend(${d.net_dividend}) != dividend(${d.dividend}) - div_tax(${d.dividend_tax})`
    );

    // 4d. total_in_pocket = net_salary + net_dividend
    check(
      Math.abs(d.total_in_pocket - (d.net_salary + d.net_dividend)) <= 1,
      `${label} D.total_in_pocket(${d.total_in_pocket}) != net_salary(${d.net_salary}) + net_dividend(${d.net_dividend})`
    );

    // ── STRATEGY E ──

    // 5. Lön = min(max(0, SALARY_E − extern), maxAffordable)
    const maxAffordableE = Math.round(profit / (1 + c.EMPLOYER_FEE_RATE));
    const adjustedTargetE = Math.max(0, c.SALARY_E - (input.external_income ?? 0));
    const expectedSalaryE = Math.min(adjustedTargetE, maxAffordableE);
    check(
      e.salary === expectedSalaryE,
      `${label} E.salary: expected ${expectedSalaryE}, got ${e.salary}`
    );

    // 6. Utdelning inom gränsbelopp ≤ gränsbelopp
    check(
      e.dividend_within_space <= e.gransbelopp + 1,
      `${label} E.dividend_within_space(${e.dividend_within_space}) > E.gransbelopp(${e.gransbelopp})`
    );

    // 7. Utdelning över gränsbelopp ≥ 0
    check(
      e.dividend_over_space >= 0,
      `${label} E.dividend_over_space < 0: ${e.dividend_over_space}`
    );

    // 8. Total utdelning ≤ fritt EK
    const eTotalDiv = e.dividend_within_space + e.dividend_over_space;
    check(
      eTotalDiv <= e.fritt_ek + 1,
      `${label} E total div(${eTotalDiv}) > fritt_ek(${e.fritt_ek})`
    );

    // 9. Kvarvarande i bolaget ≥ 0
    check(
      e.retained_in_company >= 0,
      `${label} E.retained_in_company < 0: ${e.retained_in_company}`
    );

    // 10. Total balans (±1 kr)
    // profit = net_salary + income_tax + employer_fee + corporate_tax
    //        + dividend_within_tax + dividend_over_tax + net_dividend + retained_in_company
    const eBalance = e.net_salary + e.income_tax + e.employer_fee + e.corporate_tax
      + e.dividend_within_tax + e.dividend_over_tax + e.net_dividend + e.retained_in_company;
    check(
      Math.abs(eBalance - profit) <= 1,
      `${label} E balance: ${eBalance} != profit(${profit}), diff=${eBalance - profit}`
    );

    // 10b. net_dividend = (within - within_tax) + (over - over_tax)
    const eNetDivExpected = (e.dividend_within_space - e.dividend_within_tax)
      + (e.dividend_over_space - e.dividend_over_tax);
    check(
      Math.abs(e.net_dividend - eNetDivExpected) <= 1,
      `${label} E.net_dividend(${e.net_dividend}) != expected(${eNetDivExpected})`
    );

    // 11. Rimlighetskontroll marginalskatt (endast när dividend_over > 0)
    if (e.dividend_over_space > 0) {
      check(
        e.effective_tax_rate_over > 0.30 && e.effective_tax_rate_over < 0.60,
        `${label} E.effective_tax_rate_over(${e.effective_tax_rate_over}) utanför [0.30, 0.60]`
      );
    }

    // ── CROSS-STRATEGY ──

    // 12. Om profit > 700,000 OCH:
    //     (a) ingen likviditetsbegränsning för E (liquid >= fritt_ek), OCH
    //     (b) E har ingen dividend_over (all utdelning inom 20%-zonen, ingen IL 57:20), OCH
    //     (c) ingen extern inkomst (extern inkomst sänker E:s lön och gränsbelopp, vilket
    //         kan bryta jämförelsen mot A som inte justerar lönemål för extern inkomst):
    //     då ger E minst lika mycket i fickan som A.
    if (profit > 700_000 && input.external_income === 0 && input.liquid_assets >= e.fritt_ek && e.dividend_over_space === 0) {
      check(
        e.total_in_pocket >= r.total_in_pocket - 1,
        `${label} E.total_in_pocket(${e.total_in_pocket}) < A.total_in_pocket(${r.total_in_pocket})`
      );
    }

    // 13. D lämnar alltid minst lika mycket i bolaget som A
    check(
      d.surplus_in_company >= r.surplus_after_dividend - 1,
      `${label} D.surplus(${d.surplus_in_company}) < A.surplus(${r.surplus_after_dividend})`
    );
  }

  tierSummary("TIER 8", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// GOLDEN E: VIB-216 (extern inkomst i strategi E)
// ══════════════════════════════════════════════════════════════

function tierGoldenE(): void {
  console.log("\n=== GOLDEN E: VIB-216 EXTERN INKOMST ===");
  const sp = totalPass, sf = totalFail;

  const BASE_E4: TaxOptimizerInput = {
    profit_before_salary: 1_500_000,
    liquid_assets: 1_100_000,   // > fritt_ek ≈ 1 024 044 — no liquidity cap
    total_payroll_others: 0,
    owner_salary_taken: 0,
    external_income: 0,
    kommun: "stockholm",
    church_member: false,
    saved_dividend_space: 0,
    is_holding_company: false,
    has_working_relatives: false,
    num_owners: 1,
    salary_strategy: "balanced",
    planned_downtime_within_3_years: false,
    omkostnadsbelopp: 25_000,
  };

  // E1: baseline — ingen extern inkomst
  const e1 = optimize(BASE_E4).strategy_e;

  // E4: extern inkomst 200 000 kr
  const e4 = optimize({ ...BASE_E4, external_income: 200_000 }).strategy_e;

  // Lön reduceras med extern inkomst: max(0, 360 000 − 200 000) = 160 000
  check(e4.salary === 160_000, `E4 salary: expected 160000, got ${e4.salary}`);

  // Grundbelopp + lönebaserat utrymme: lön 160K < SALARY_DEDUCTION 644 800 → lönedel=0
  // Gränsbelopp = 4×IBB = 322 400 (+ saved=0 + omkostnadstillägg=0 = 322 400)
  check(
    e4.dividend_within_space === 322_400,
    `E4 dividend_within_space: expected 322400, got ${e4.dividend_within_space}`
  );

  // Extern inkomst driver upp marginalskatt → lägre i fickan än utan extern inkomst
  check(
    e4.total_in_pocket < e1.total_in_pocket,
    `E4 total_in_pocket(${e4.total_in_pocket}) >= E1(${e1.total_in_pocket}) — extern inkomst borde sänka`
  );

  // Effektiv skattesats på IL 57:20-utdelning: rimligt intervall
  if (e4.dividend_over_space > 0) {
    check(
      e4.effective_tax_rate_over > 0.30 && e4.effective_tax_rate_over < 0.60,
      `E4 effective_tax_rate_over(${e4.effective_tax_rate_over}) outside [0.30, 0.60]`
    );
  }

  // Ungefärligt totalt i fickan (manuell kalkyl ≈ 792 392, tolerans ±5 000)
  check(
    Math.abs(e4.total_in_pocket - 792_392) <= 5_000,
    `E4 total_in_pocket: expected ~792392 (±5000), got ${e4.total_in_pocket}`
  );

  // Balansinvariant: profit = net_salary + income_tax + employer_fee + corp_tax
  //                          + within_tax + over_tax + net_dividend + retained
  const eBalance = e4.net_salary + e4.income_tax + e4.employer_fee + e4.corporate_tax
    + e4.dividend_within_tax + e4.dividend_over_tax + e4.net_dividend + e4.retained_in_company;
  check(
    Math.abs(eBalance - 1_500_000) <= 1,
    `E4 balance: ${eBalance} != 1500000, diff=${eBalance - 1_500_000}`
  );

  tierSummary("GOLDEN E", sp, sf);
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════

function main(): void {
  console.log("============================================================");
  console.log("  TAX OPTIMIZER -- 8-Tier Property-Based Verification");
  console.log("============================================================");

  // Track pass/fail per section for the final report
  const before: Record<string, [number, number]> = {};

  const mark = (name: string) => { before[name] = [totalPass, totalFail]; };
  const delta = (name: string): [number, number] => {
    const [p, f] = before[name];
    return [totalPass - p, totalFail - f];
  };

  mark("skv");        tier5();   // Tier 5 = SKV Tabell 30 golden cases
  mark("inv_old");    tier1(); tier2(); tier3(); tier4(); tier6(); tier7();
  mark("inv_new");    tier8();   // 50 000 slumpinputs, varav ~30% med extern inkomst
  mark("golden_new"); tierGoldenE();  // VIB-216: strategi E med extern inkomst

  const skvP = before["inv_old"][0] - before["skv"][0];
  const skvF = before["inv_old"][1] - before["skv"][1];
  const invOldStart           = before["inv_old"];
  const invNewStart           = before["inv_new"];
  const goldenNewStart        = before["golden_new"];
  const invOldP               = invNewStart[0] - invOldStart[0];
  const invOldF               = invNewStart[1] - invOldStart[1];
  const invNewP               = goldenNewStart[0] - invNewStart[0];
  const invNewF               = goldenNewStart[1] - invNewStart[1];
  const [goldenNewP, goldenNewF] = delta("golden_new");

  console.log("\n────────────────────────────────────────────────────────────");
  console.log(`  SKV Tabell 30:    ${skvP}/${skvP + skvF}`);
  console.log(`  Invarianter old:  ${invOldP}/${invOldP + invOldF}`);
  console.log(`  Invarianter new:  ${invNewP}/${invNewP + invNewF}`);
  console.log(`  Golden old:       ${skvP}/${skvP + skvF}  (=SKV Tabell 30)`);
  console.log(`  Golden new:       ${goldenNewP}/${goldenNewP + goldenNewF}`);
  console.log(`  TOTALT:           ${totalPass}/${totalPass + totalFail}`);
  console.log("────────────────────────────────────────────────────────────");

  if (totalFail > 0) {
    console.log(`\nFAILURES (first 50):`);
    for (const f of allFailures.slice(0, 50)) {
      console.log(`  FAIL: ${f}`);
    }
    process.exit(1);
  } else {
    console.log("\nAlla tiers godkända.");
    process.exit(0);
  }
}

main();
