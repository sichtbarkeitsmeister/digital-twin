(async () => {
  process.env.NODE_ENV = "production";
  const app = await import("next/dist/cli/next-start");
  app.nextStart({
    port: process.env.PORT || 3000,
  });
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
