// '@workshop-data' is an alias (vite.config.ts): src/data/workshop_data.json in dev/build,
// tests/fixtures/data.fixture.json under Vitest and `--mode fixture`. Typed unknown on purpose:
// validateData() in src/data.ts is the only thing allowed to give it a type.
declare module '@workshop-data' {
  const raw: unknown;
  export default raw;
}
