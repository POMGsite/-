import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

export const config = {
  root: ROOT,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  isProd: process.env.NODE_ENV === "production",
  /** Defina TRUST_PROXY=1 quando o site estiver atrás de Nginx/Cloudflare/etc. (HTTPS terminado no proxy). */
  trustProxy: process.env.TRUST_PROXY === "1",
  /** Endereço público, usado em sitemap, canonical e Open Graph. Ex.: https://www.seudominio.com.br */
  siteUrl: (process.env.SITE_URL ?? "").replace(/\/$/, ""),
  dbPath: process.env.DATABASE_PATH ?? path.join(ROOT, "data", "pomg.db"),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(ROOT, "uploads"),
  publicDir: path.join(ROOT, "public"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,
  sessionHours: 8,
};

mkdirSync(path.dirname(config.dbPath), { recursive: true });
mkdirSync(config.uploadDir, { recursive: true });
