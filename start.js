const fs = require("node:fs");
const http = require("node:http");
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

  const portRaw = process.env.PORT;
  const port = portRaw ? Number.parseInt(portRaw, 10) : 3000;
  const hostname = "0.0.0.0";

  log(`boot: node=${process.version} pid=${process.pid} cwd=${process.cwd()}`);
  log(`boot: PORT=${portRaw || ""} resolvedPort=${port}`);
  log(`boot: PASSENGER_APP_ENV=${process.env.PASSENGER_APP_ENV || ""}`);

  // Start Next via its public API (avoids importing internal CLI modules).
  const next = require("next");
  const app = next({ dev: false, hostname, port });
  const handle = app.getRequestHandler();

  log("boot: next() created");
  await app.prepare();
  log("boot: app.prepare() complete");

  const server = http.createServer((req, res) => handle(req, res));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });

  log(`boot: listening on http://${hostname}:${port}`);
})().catch((err) => {
  log(`boot: failed: ${err?.stack || err}`);
  process.exitCode = 1;
});
