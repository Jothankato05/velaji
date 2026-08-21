// Import this FIRST, before anything that transitively imports src/config/env.
// Import statements are hoisted, so setting process.env in the same file as
// later imports does NOT guarantee ordering — this file has zero imports of
// its own, so its side effects are guaranteed to run before any sibling
// import's module body does. (Bitten by the opposite of this once already —
// see ImmuniReach's smokeEnv.ts for the production-DB near-miss that taught
// this lesson.)
process.env.NODE_ENV = 'test';
process.env.ALLOW_IN_MEMORY_DB = 'true';
process.env.PORT = '0';
process.env.APP_BASE_URL = 'http://localhost:9999';
