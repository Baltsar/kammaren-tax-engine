#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { optimize, TaxOptimizerInput } from "./tax-optimizer.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
) as { version: string };
const version = pkg.version;

function createServer(): McpServer {
  const server = new McpServer({
    name: "kammaren-tax-engine",
    version,
  });

  server.registerTool(
  "optimize_312",
  {
    title: "Swedish 3:12 Tax Optimizer",
    description:
      "Calculate optimal salary/dividend split for a Swedish sole-owner AB (fåmansbolag) under 3:12 rules. Income year 2026. Returns five strategies: Balanced, SGI, Pension, Minimum, and Dividend Max. Each includes exact tax breakdown, net salary, dividend, surplus in company, and action plan.\n\nAll math is deterministic — 978,304 tests, 0 failures, verified row-by-row against Skatteverket official tax table.\n\nPRIVACY: Input and results are processed by your AI provider (Anthropic, OpenAI, etc). KAMMAREN does not store or transmit any data. Review your provider's data policies.\n\nDISCLAIMER: Calculation tool, not tax or legal advice. Consult an authorized accounting consultant before making decisions.",
    inputSchema: {
      // ── REQUIRED ──
      profit_before_salary: z
        .number()
        .describe(
          "Vinst före ägarens lön. Rörelseintäkter minus rörelsekostnader (exkl. din egen lönekostnad). I Fortnox: Nettoomsättning minus Summa rörelsekostnader plus konto 7210 och 7510-7530."
        ),
      municipality: z
        .string()
        .describe(
          "Kommun. Styr kommunalskatt och jobbskatteavdrag. 290 svenska kommuner stöds, t.ex. Stockholm, Göteborg, Malmö."
        ),
      liquid_assets: z
        .number()
        .describe(
          "Kassa / likvida medel. Bara pengar du kan flytta, ej kundfordringar."
        ),
      current_monthly_salary: z
        .number()
        .describe("Aktuell bruttolön per månad i kr."),
      church_member: z
        .boolean()
        .describe(
          "Medlem i Svenska kyrkan? Påverkar total skattesats med ca 1%."
        ),

      // ── OPTIONAL ──
      saved_dividend_space: z
        .number()
        .optional()
        .describe(
          "Sparat K10-utrymme från tidigare år. Adderas till gränsbeloppet. Default: 0."
        ),
      external_income: z
        .number()
        .optional()
        .describe(
          "Annan beskattningsbar lön eller inkomst utanför bolaget. Påverkar var brytpunkten för statlig skatt hamnar. Default: 0."
        ),
      total_payroll_others: z
        .number()
        .optional()
        .describe(
          "Total bruttolönesumma för övriga anställda (ej ägaren). Ökar det lönebaserade K10-utrymmet. Default: 0."
        ),
      salary_strategy: z
        .enum(["sgi", "pension", "balanced"])
        .optional()
        .describe(
          "Lönestrategi: 'balanced' (upp till brytpunkten, 660 400 kr), 'sgi' (max SGI/sjukpenning, 592 000 kr), 'pension' (max allmän pension, 673 038 kr). Default: 'balanced'."
        ),
      omkostnadsbelopp: z
        .number()
        .optional()
        .describe(
          "Omkostnadsbelopp för aktierna. Påverkar gränsbeloppstillägget om värdet överstiger 100 000 kr. Default: 25000."
        ),
      safety_buffer: z
        .number()
        .optional()
        .describe(
          "Kassabuffert att reservera innan utdelning beräknas. Dras av från rekommenderad utdelning. Default: 0."
        ),
      municipal_tax_rate_override: z
        .number()
        .optional()
        .describe(
          "Manuell kommunalskattesats som decimal (t.ex. 0.31). Används bara om kommunen saknas i den inbyggda listan med 290 kommuner. Default: ej satt."
        ),
      is_holding_company: z
        .boolean()
        .optional()
        .describe(
          "Är bolaget ett holdingbolag eller moderbolag? Returnerar en blocker — stöds ej ännu. Default: false."
        ),
      has_working_relatives: z
        .boolean()
        .optional()
        .describe(
          "Arbetar närstående i bolaget? Kan trigga närståenderegeln. Lägger till en varning i resultatet. Default: false."
        ),
      num_owners: z
        .number()
        .optional()
        .describe(
          "Antal delägare. Enbart 1 stöds — annat värde returnerar en blocker. Default: 1."
        ),
      planned_downtime_within_3_years: z
        .boolean()
        .optional()
        .describe(
          "Planerar du att träda bolaget eller ta sabbatical inom 3 år? Aktiverar periodiseringsfond-optimering. Default: false."
        ),
      is_over_66: z
        .boolean()
        .optional()
        .describe(
          "Är ägaren över 66 år? Påverkar förhöjt grundavdrag. Returnerar en blocker — stöds ej ännu. Default: false."
        ),
    },
  },
  async (args) => {
    try {
      const result = optimize({
        profit_before_salary: args.profit_before_salary,
        kommun: args.municipality,
        liquid_assets: args.liquid_assets,
        church_member: args.church_member,
        owner_salary_taken: args.current_monthly_salary * 12,
        saved_dividend_space: args.saved_dividend_space ?? 0,
        external_income: args.external_income ?? 0,
        total_payroll_others: args.total_payroll_others ?? 0,
        salary_strategy: args.salary_strategy ?? "balanced",
        omkostnadsbelopp: args.omkostnadsbelopp,
        safety_buffer: args.safety_buffer,
        municipal_tax_rate_override: args.municipal_tax_rate_override,
        is_holding_company: args.is_holding_company ?? false,
        has_working_relatives: args.has_working_relatives ?? false,
        num_owners: args.num_owners ?? 1,
        planned_downtime_within_3_years: args.planned_downtime_within_3_years ?? false,
        is_over_66: args.is_over_66 ?? false,
      } as unknown as TaxOptimizerInput);

      const output = {
        ...result,
        _meta: {
          engine: "kammaren-tax-engine",
          version,
          income_year: 2026,
          license: "AGPL-3.0 | Commercial: gustaf@kammaren.nu",
          disclaimer:
            "Beräkningsverktyg, inte skatte- eller juridisk rådgivning. Konsultera en auktoriserad redovisningskonsult innan du fattar beslut.",
          privacy:
            "KAMMAREN lagrar/skickar ingen data. Input och resultat hanteras av din AI-leverantör.",
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }
);

  return server;
}

export { createServer };

// Only start stdio when run directly (npx, CLI)
const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);
}
