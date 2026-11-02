/**
 * Test scripts load server modules that start with `import "server-only"`. Next.js
 * resolves that package itself at build time; under plain tsx it is missing and the
 * whole script fails at import ("Cannot find module 'server-only'").
 *
 * Import this file first in a test: it resolves `server-only` to the empty build
 * Next.js uses on the server, so the guard is a no-op as it is in the app.
 */
import Module from "node:module";

const target = require.resolve("next/dist/compiled/server-only/empty.js");

type ResolveFilename = (request: string, ...rest: unknown[]) => string;
const loader = Module as unknown as { _resolveFilename: ResolveFilename };
const original = loader._resolveFilename;

loader._resolveFilename = function resolveServerOnly(this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return target;
  return original.call(this, request, ...rest);
};
