process.env.NODE_ENV = "production";

// Avoid require(): ESLint forbids CommonJS-style imports in this repo.
// Keep this file CommonJS-compatible by using a dynamic ESM import.
import("next/dist/cli/next-start").then((app) => {
  app.nextStart({
    hostname: "0.0.0.0",
    port: process.env.PORT || 3000,
  });
});
