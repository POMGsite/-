import { config } from "./config.ts";
import { createApp, housekeeping } from "./app.ts";
import { bootstrapAdmin } from "./bootstrap.ts";

const server = createApp();
housekeeping();
await bootstrapAdmin();
setInterval(housekeeping, 6 * 3600 * 1000).unref();

server.listen(config.port, config.host, () => {
  console.log(`P.O.M.G. no ar em http://localhost:${config.port}  (${config.isProd ? "produção" : "desenvolvimento"})`);
  if (config.isProd && !config.siteUrl) console.warn("Aviso: defina SITE_URL (ex.: https://www.seudominio.com.br) para canonical e sitemap corretos.");
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
