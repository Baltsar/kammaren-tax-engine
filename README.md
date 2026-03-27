# kammaren-tax-engine

> **⚠️ INKOMSTÅRET 2026 ONLY**
> All constants, formulas and tax tables in this engine are for Swedish income year 2026 (deklaration 2027). They are static values published by SCB, Skatteverket and Riksgälden. This engine does NOT auto-update. When PBB, IBB or tax rules change (typically January each year), the constants in `tax-constants-2026.ts` must be manually updated and all tests re-run. Using this engine for any other income year will produce incorrect results.

Deterministic Swedish 3:12 tax optimization engine for sole-owner AB companies (fåmansbolag).

No AI. No guessing. Pure math. Verified against Skatteverket's official tax table, row by row.

## What it does

Given a company's profit, cash, salary level and municipality, the engine calculates five strategies for optimal salary/dividend split under Sweden's 2026 3:12 rules:

| Strategy | Salary | Goal |
|----------|--------|------|
| **Balanced** | 660,400 kr | Highest salary without state tax |
| **SGI** | 592,000 kr | Maximizes sickness/parental benefits |
| **Pension** | 673,038 kr | Maximizes public pension |
| **Minimum** | 336,000 kr | Maximizes capital retained in company |
| **Dividend Max** | 360,000 kr | Maximizes take-home (incl. dividend above allowance) |

Each strategy returns exact figures: net salary, dividend (within and above allowance), tax breakdown, surplus in company, and an action plan.

## Verification

This engine is tested more rigorously than any comparable tool in Sweden.

```
SKV Table 30 (row-by-row match):     406/406
Property-based invariants:           977,700/977,700
Golden reference cases:              168/168
Edge cases (extreme inputs):         20/20
Wiring audit (input→output):         10/10
Total:                               978,304 tests, 0 failures
```

The SKV Table 30 test compares our `calculateIncomeTax()` output against every row of Skatteverket's official 2026 tax table (SKV 433, Table 30, Column 1, Stockholm). Zero deviation. Not "close enough." Zero.

## Key design decisions

**LLM never calculates.** This is a pure TypeScript function. No AI, no temperature, no hallucination. Same input always produces same output.

**All constants from a single source.** `tax-constants-2026.ts` contains every tax parameter for income year 2026. Zero hardcoded numbers in the optimizer itself.

**JSA separation for Dividend Max.** Jobbskatteavdrag (employment tax credit) is calculated on salary only, not on dividend-as-employment-income (IL 67:6 → SFB ch. 59). This is a legal interpretation verified against Skatteverket's documentation.

**Integer arithmetic where it matters.** IEEE 754 floating-point errors (e.g. `295000 × 0.0116 = 3421.999...`) are avoided using scaled integer math for burial/church fee calculations.

**Safety buffer.** 1% of profit (clamped 5K–25K) is reserved and excluded from dividend recommendations. All displayed figures use post-buffer amounts.

## Use as MCP server

This engine ships as a ready-to-use MCP server. Any MCP-compatible AI client (Claude Desktop, Cursor, VS Code with Continue, etc.) can call it directly.

### Install

```bash
npm install -g kammaren-tax-engine
```

Or use without installing via `npx`:

```json
"command": "npx",
"args": ["-y", "kammaren-tax-engine"]
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "kammaren-tax-engine": {
      "command": "kammaren-tax-engine"
    }
  }
}
```

Restart Claude Desktop. The tool `optimize_312` will appear in Claude's tool list.

### Cursor / VS Code

Add to your MCP config (`.cursor/mcp.json` or `.vscode/mcp.json`):

```json
{
  "servers": {
    "kammaren-tax-engine": {
      "type": "stdio",
      "command": "kammaren-tax-engine"
    }
  }
}
```

### Available tool

| Tool | Description |
|------|-------------|
| `optimize_312` | Returns all five salary/dividend strategies for a Swedish sole-owner AB |

**Required inputs:** `profit_before_salary`, `municipality`, `liquid_assets`, `current_monthly_salary`, `church_member`

**Optional:** `saved_dividend_space`, `external_income`, `total_payroll_others`, `salary_strategy`, `omkostnadsbelopp`, `safety_buffer`

Example prompt once connected:

> "Mitt bolag har 1 500 000 kr i vinst före lön, jag tar 55 000/mån, bor i Stockholm och är inte kyrkomedlem. Vad är optimal lön och utdelning för 2026?"

The engine returns exact figures for all five strategies — no AI math, no guessing.

---

## Quick start

```bash
npm install
npm run test:all
```

```typescript
import { optimize } from './src/tax-optimizer';

const result = optimize({
  profit_before_salary: 1_500_000,
  current_monthly_salary: 55_000,
  liquid_assets: 1_200_000,
  municipality: 'Stockholm',
  church_member: false,
  saved_dividend_space: 0,
  omkostnadsbelopp: 25_000,
  external_income: 0,
  sabbatical: false,
  non_deductible_expenses: 0,
});

console.log(result.strategy_a.in_pocket);  // 777,103
console.log(result.strategy_e.in_pocket);  // 856,885
```

## Tax constants (2026)

| Constant | Value | Source |
|----------|-------|--------|
| PBB | 59,200 | SCB |
| IBB (3:12) | 80,600 | SCB (2025, used for 2026 allowance) |
| IBB (current) | 83,400 | SCB (2026) |
| Base amount | 322,400 | 4 × IBB_3:12 |
| Salary deduction | 644,800 | 8 × IBB_3:12 |
| Bracket threshold | 643,000 | Skatteverket |
| Break point | 660,400 | Bracket + GA floor |
| Corporate tax | 20.6% | IL |
| Employer fees | 31.42% | Skatteverket |
| Dividend tax | 20% | IL 57:20 |
| SLR (Nov 30, 2025) | 2.55% | Riksgälden |
| Cost basis threshold | 100,000 | IL 57 kap (new 2026) |
| Dormant period | 4 years | IL 57 kap (new 2026, was 5) |

## Supported municipalities

290 Swedish municipalities with exact tax rates (kommunalskatt + landstingsskatt). Stockholm's burial fee (0.07%) is handled as a special case. All others use the national average (0.292%).

## Legal references

- IL 57 kap (Inkomstskattelagen, chapter 57) — 3:12 rules
- IL 57:20 — Dividend above allowance → employment income (100%, not 2/3)
- IL 57:21 — Capital gains above allowance → 2/3 employment (different from dividends)
- IL 67:6 → SFB 59 kap — JSA applies to employment income only, not reclassified dividends
- SKV 433 — Skatteverket's official tax tables
- Riksdagsbeslut 2025-11-27 — New 3:12 rules effective 2026-01-01

## Architecture

```
optimize(input)
├── prepareInput()          Validates and normalizes input
├── resolveRates()          Municipality → tax rates
├── calculateIncomeTax()    GA, kommunalskatt, statlig, JSA
├── buildSalaryScenario()   Strategies A/B/C/D
├── computeStrategyE()      Dividend Max with JSA separation
└── return {
      strategy_a,           Balanced (660,400)
      strategy_b,           SGI (592,000)
      strategy_c,           Pension (673,038)
      strategy_d,           Minimum (336,000)
      strategy_e            Dividend Max (360,000)
    }
```

## Limitations

- **Single owner only.** Multi-owner proportioning (grundbelopp × ägarandel) not yet implemented.
- **Accumulated equity not modeled.** Assumes distributable equity = current year profit after tax.
- **290 municipalities, not 100% exact.** Burial fee uses national average (0.292%) except Stockholm (0.07%).
- **No K10 form generation.** This engine calculates optimal strategy. For K10 generation, see [k10calculator.vercel.app](https://k10calculator.vercel.app/).
- **Income year 2026 only.** Every constant is a static snapshot from SCB/Skatteverket/Riksgälden. PBB, IBB, skiktgräns, SLR, employer fee rates — all hardcoded for 2026. New values are published each December. A `tax-constants-2027.ts` will be needed when they arrive. Do not use this engine for 2025 or earlier.

## Use as extension

This engine is a pure function with zero dependencies and zero side effects. One function in, one data structure out. Drop it into anything.

### gnubok (erp-mafia/gnubok)

Built to integrate with [gnubok](https://github.com/erp-mafia/gnubok), the open-source Swedish ERP system. The engine maps directly to gnubok's BAS 2026 chart of accounts:

- Konto 7210 (owner salary) → `gross_salary`
- Konto 7510-7530 (employer fees) → `employer_fee`
- Konto 2091 (balanced profit) → `surplus_in_company`
- Konto 2898 (dividends payable) → `recommended_dividend`

Extension integration point: `extensions/tax-optimizer/`

### Other platforms

Works with any accounting software that can provide annual profit before owner salary, current salary level, municipality, and cash position.

Tested integrations: Fortnox (via SIE4), Wint, Visma.

```typescript
// The entire API is one function
const result = optimize(input);
// Returns: { strategy_a, strategy_b, strategy_c, strategy_d, strategy_e }
// Each strategy contains ~20 fields with exact tax breakdown
```

## Contributing

Found a bug in the tax calculation? Open an issue with:
1. Your input values
2. Expected output (with source/reference)
3. Actual output

Tax law changes? The engine needs annual updates to `tax-constants-2026.ts` when new PBB/IBB values are published by SCB (typically December).

## License

This engine is dual-licensed.

### AGPL-3.0 (free)

Use it for anything where you can open your source. If you build a web service, SaaS product, or API on top of this engine, AGPL-3.0 requires you to publish your full application source under the same license.

This covers: personal projects, open source tools, self-hosted internal tools, academic use.

### Commercial license

If you need to embed this engine in a **closed-source product or service** — a payroll platform, accounting SaaS, fintech app — without open-sourcing your codebase, you need a commercial license.

Contact: [gustaf@kammaren.nu](mailto:gustaf@kammaren.nu)

Commercial licenses include no copyleft restrictions, priority support for annual tax constant updates, and the right to white-label the engine.

---

Built by [Gustaf Baltsar Garnow](https://kammaren.nu) as part of [KAMMAREN](https://kammaren.nu) — financial sovereignty for Swedish AB owners.
