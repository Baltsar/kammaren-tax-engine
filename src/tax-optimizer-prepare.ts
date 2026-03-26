// TAX OPTIMIZER — Input preparation (GIGO triage)
// Converts raw accounting input to clean optimizer input.

import { TaxOptimizerInput } from "./tax-optimizer";

export interface RawTaxInput {
  accounting_profit: number;
  non_deductible_representation: number;
  non_deductible_fines: number;
  non_deductible_other: number;

  liquid_assets: number;
  owner_salary_taken: number;
  external_income: number;
  kommun: string;
  church_member: boolean;
  municipal_tax_rate_override?: number;
  saved_dividend_space: number;
  is_holding_company: boolean;
  has_working_relatives: boolean;
  num_owners: number;
  total_payroll_others: number;
  salary_strategy: 'sgi' | 'pension' | 'balanced';
  planned_downtime_within_3_years: boolean;
  omkostnadsbelopp?: number;
  is_over_66?: boolean;
}

export interface PreparedResult {
  input: TaxOptimizerInput;
  taxable_profit: number;
  safety_buffer: number;
}

export function prepareInput(raw: RawTaxInput): PreparedResult {
  const nonDeductible =
    (raw.non_deductible_representation ?? 0) +
    (raw.non_deductible_fines ?? 0) +
    (raw.non_deductible_other ?? 0);

  const taxableProfit = raw.accounting_profit + nonDeductible;

  const buffer = Math.min(
    25_000,
    Math.max(5_000, Math.round(raw.accounting_profit * 0.01))
  );

  return {
    input: {
      profit_before_salary: taxableProfit,
      liquid_assets: raw.liquid_assets,
      total_payroll_others: raw.total_payroll_others,
      owner_salary_taken: raw.owner_salary_taken,
      external_income: raw.external_income,
      kommun: raw.kommun,
      church_member: raw.church_member,
      municipal_tax_rate_override: raw.municipal_tax_rate_override,
      saved_dividend_space: raw.saved_dividend_space,
      is_holding_company: raw.is_holding_company,
      has_working_relatives: raw.has_working_relatives,
      num_owners: raw.num_owners,
      salary_strategy: raw.salary_strategy,
      planned_downtime_within_3_years: raw.planned_downtime_within_3_years,
      omkostnadsbelopp: raw.omkostnadsbelopp,
      is_over_66: raw.is_over_66,
      safety_buffer: buffer,
    },
    taxable_profit: taxableProfit,
    safety_buffer: buffer,
  };
}
