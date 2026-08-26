# Unwired TypeScript reference material

These `.ts` files were written for an earlier revamp but are **not wired into
the running server** (`server/index.js` requires only CommonJS `.js` modules,
and there is no TS build step). They lived alongside the live code, where
`tsc` module resolution picked them up ahead of the `.js` files with the same
basename (e.g. `require('./routes/auth')` type-resolved to `auth.ts`),
breaking the Type Check CI job with references to `passport` and exports that
don't exist.

They are parked here — excluded from `tsconfig.json` — until the owner
decides to migrate or delete them (see `docs/olympus/questions-for-max.md`).
Do not import from this directory.
