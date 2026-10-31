import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { loadSession } from "./auth.ts";
import { db, now } from "./db.ts";
import { Ctx, HttpError, parseBody, Router } from "./http.ts";
import { safeEqual } from "./security.ts";
import { notFound, registerPublic, streamFile } from "./routes/public.tsx";
import { registerAdmin } from "./routes/admin.tsx";

const MIME: Record<string, string> = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };

export function buildRouter(): Router {
  const r = new Router();
  registerPublic(r);
  registerAdmin(r);
  return r;
}

function serveStatic(ctx: Ctx): boolean {
  const p = ctx.url.pathname;
  if (!(p.startsWith("/css/") || p.startsWith("/js/"))) return false;
  let rel: string;
  try { rel = decodeURIComponent(p); } catch { return false; }
  const file = path.resolve(config.publicDir, "." + rel);
  if (!file.startsWith(config.publicDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) { notFound(ctx); return true; }
  streamFile(ctx, file, MIME[path.extname(file)] ?? "application/octet-stream", { "Cache-Control": "public, max-age=300" });
  return true;
}

function errorPage(ctx: Ctx, status: number, message: string) {
  const esc = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  ctx.send(status, `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Erro ${status}</title><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1>Erro ${status}</h1><p>${esc}</p><p><a href="/">Voltar ao início</a></p></body></html>`.replace(/ style="[^"]*"/, ""), "text/html; charset=utf-8", { "Cache-Control": "no-store" });
}

export function createApp(): Server {
  const router = buildRouter();
  db(); // abre o banco e aplica o schema na inicialização

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const ctx = new Ctx(req, res);
    try {
      const p = ctx.url.pathname;
      if (!["GET", "HEAD", "POST"].includes(ctx.method)) throw new HttpError(405, "Método não permitido.");
      if (p === "/favicon.ico") return ctx.send(204, "");
      if ((ctx.method === "GET" || ctx.method === "HEAD") && serveStatic(ctx)) return;

      const hit = router.match(ctx.method, p);
      if (!hit) {
        if (router.hasPath(p)) throw new HttpError(405, "Método não permitido.");
        return notFound(ctx);
      }
      ctx.params = hit.params;
      const isAdmin = p === "/admin" || p.startsWith("/admin/");
      if (isAdmin) loadSession(ctx);

      if (ctx.method === "POST") {
        if (isAdmin && !ctx.sameOrigin()) throw new HttpError(403, "Origem da requisição não aceita.");
        const isLogin = p === "/admin/login";
        await parseBody(ctx, { allowFiles: isAdmin && !isLogin });
        if (isAdmin && !isLogin) {
          if (!ctx.user) return ctx.redirect("/admin/login");
          if (!ctx.csrf || !safeEqual(String(ctx.fields._csrf ?? ""), ctx.csrf)) throw new HttpError(403, "Sessão expirada ou formulário inválido. Recarregue a página e tente de novo.");
        }
      }
      await hit.handler(ctx);
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) return errorPage(ctx, e.status, e.message);
      console.error("[erro]", ctx.method, ctx.url.pathname, e);
      errorPage(ctx, 500, "Ocorreu um erro interno. Tente novamente em instantes.");
    }
  }

  const server = createServer((req, res) => { void handle(req, res); });
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 60;
  return server;
}

/** Limpeza periódica: sessões vencidas e mensagens com mais de 12 meses (conforme a Política de Privacidade). */
export function housekeeping() {
  const t = now();
  db().prepare("DELETE FROM sessions WHERE expires_at < ?").run(t);
  db().prepare("DELETE FROM messages WHERE created_at < ?").run(t - 365 * 86400);
}
