(async () => {
  process.env.NODE_ENV = "production";

  const portRaw = process.env.PORT;
  const port = portRaw ? Number.parseInt(portRaw, 10) : 3000;
  const hostname = "0.0.0.0";

  // Start Next via its public API (avoids importing internal CLI modules).
  const httpMod = await import("node:http");
  const createServer = httpMod.createServer;

  const nextMod = await import("next");
  const next = nextMod.default ?? nextMod;

  const app = next({ dev: false, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => handle(req, res));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
