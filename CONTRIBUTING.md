# Contributing

## Contributor License Agreement

All pull requests require CLA acceptance. Tick the checkbox in the PR description when you open a PR. See [CLA.md](CLA.md) for the full text.

## Tax calculation bugs

If you believe a calculation is wrong:

1. Provide exact input values
2. Show expected output with a verifiable source (Skatteverket, SKV 433, or a qualified accountant's calculation)
3. Show actual output from the engine

We will not change calculations based on "I think it should be X." We need a source.

## Annual updates

Each income year requires updated constants in `tax-constants-2026.ts`. Key dates:
- **December**: SCB publishes new PBB/IBB
- **November 30**: Riksgälden publishes SLR
- **January**: Skatteverket publishes new tax tables (SKV 433)

## Code style

- TypeScript strict mode
- No floating-point arithmetic for tax calculations (use scaled integers where needed)
- All tax parameters from `tax-constants-2026.ts`, never hardcoded
- Every new feature needs golden cases + invariant tests
