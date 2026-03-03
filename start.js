const fs = require("node:fs");
const path = require("node:path");

const logPath = path.join(process.cwd(), "boot.log");
function log(line) {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    // ignore
  }
}

process.on("uncaughtException", (err) => {
  log(`uncaughtException: ${err?.stack || err}`);
});
process.on("unhandledRejection", (err) => {
  log(`unhandledRejection: ${err?.stack || err}`);
});

(async () => {
  process.env.NODE_ENV = "production";
  log(`boot: node=${process.version} pid=${process.pid} cwd=${process.cwd()}`);
  log(`boot: PORT=${process.env.PORT || ""}`);

  const app = await import("next/dist/cli/next-start");
  log("boot: imported next-start");

  app.nextStart({
    port: process.env.PORT || 3000,
    hostname: "0.0.0.0",
  });
  log("boot: nextStart invoked");
})().catch((err) => {
  log(`boot: failed: ${err?.stack || err}`);
  process.exitCode = 1;
});
