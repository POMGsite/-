import type { IncomingMessage, ServerResponse } from "node:http";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { config } from "./config.ts";
import { securityHeaders } from "./security.ts";

export type FilePart = { field: string; filename: string; data: Buffer };
export type User = { id: number; email: string; name: string; role: "admin" | "editor" };

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class Ctx {
  url: URL;
  method: string;
  params: Record<string, string> = {};
  fields: Record<string, string> = {};
  files: FilePart[] = [];
  user: User | null = null;
  csrf = "";
  sessionId = "";
  cookies: Record<string, string>;
  private setCookies: string[] = [];
  private extraHeaders: Record<string, string> = {};

  constructor(public req: IncomingMessage, public res: ServerResponse) {
    this.method = (req.method ?? "GET").toUpperCase();
    this.url = new URL(req.url ?? "/", "http://localhost");
    this.cookies = parseCookies(req.headers.cookie ?? "");
  }

  get ip(): string {
    if (config.trustProxy) {
      const xff = String(this.req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      if (xff) return xff;
    }
    return this.req.socket.remoteAddress ?? "0.0.0.0";
  }

  get https(): boolean {
    if (config.trustProxy) return String(this.req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
    return Boolean((this.req.socket as any).encrypted);
  }

  /** Bloqueia POST vindo de outro site (defesa em profundidade além do SameSite e do token CSRF). */
  sameOrigin(): boolean {
    const origin = this.req.headers.origin;
    const fetchSite = this.req.headers["sec-fetch-site"];
    if (fetchSite && !["same-origin", "none"].includes(String(fetchSite))) return false;
    if (origin && origin !== "null") {
      try { return new URL(String(origin)).host === this.req.headers.host; } catch { return false; }
    }
    return origin !== "null";
  }

  header(name: string, value: string) { this.extraHeaders[name] = value; }

  cookie(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean } = {}) {
    const parts = [`${name}=${value}`, "Path=/", "SameSite=Lax"];
    if (opts.httpOnly !== false) parts.push("HttpOnly");
    if (this.https || config.isProd && config.trustProxy) parts.push("Secure");
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    this.setCookies.push(parts.join("; "));
  }

  private baseHeaders(type: string, extra: Record<string, string> = {}) {
    const h: Record<string, string | string[]> = {
      ...securityHeaders(this.https),
      "Content-Type": type,
      ...this.extraHeaders,
      ...extra,
    };
    if (this.setCookies.length) h["Set-Cookie"] = this.setCookies;
    return h;
  }

  send(status: number, body: string | Buffer, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) {
    this.res.writeHead(status, this.baseHeaders(type, extra));
    this.res.end(this.method === "HEAD" ? undefined : body);
  }

  html(el: ReactElement, status = 200, extra: Record<string, string> = {}) {
    const markup = "<!doctype html>" + renderToStaticMarkup(el);
    this.send(status, markup, "text/html; charset=utf-8", { "Cache-Control": "no-store", ...extra });
  }

  htmlCached(el: ReactElement, maxAge = 60) {
    this.html(el, 200, { "Cache-Control": `public, max-age=${maxAge}` });
  }

  redirect(to: string, status = 303) {
    this.res.writeHead(status, this.baseHeaders("text/plain; charset=utf-8", { Location: to }));
    this.res.end();
  }

  json(data: unknown, status = 200) {
    this.send(status, JSON.stringify(data), "application/json; charset=utf-8", { "Cache-Control": "no-store" });
  }
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new HttpError(413, "Conteúdo grande demais.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Conteúdo grande demais.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Lê formulários urlencoded e multipart (com arquivos). Limites aplicados antes de qualquer processamento. */
export async function parseBody(ctx: Ctx, opts: { allowFiles?: boolean } = {}) {
  const type = String(ctx.req.headers["content-type"] ?? "");
  const limit = opts.allowFiles ? config.maxUploadBytes + 1024 * 1024 : 256 * 1024;
  if (type.startsWith("application/x-www-form-urlencoded")) {
    const raw = (await readBody(ctx.req, limit)).toString("utf8");
    for (const [k, v] of new URLSearchParams(raw)) ctx.fields[k] = v;
    return;
  }
  if (type.startsWith("multipart/form-data")) {
    if (!opts.allowFiles) throw new HttpError(415, "Formato não aceito.");
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!m) throw new HttpError(400, "Requisição inválida.");
    parseMultipart(await readBody(ctx.req, limit), m[1] ?? m[2], ctx);
    return;
  }
  if (ctx.method !== "GET" && Number(ctx.req.headers["content-length"] ?? 0) > 0) throw new HttpError(415, "Formato não aceito.");
}

export function parseMultipart(body: Buffer, boundary: string, ctx: Ctx) {
  const delim = Buffer.from("--" + boundary);
  let pos = body.indexOf(delim);
  let parts = 0;
  while (pos !== -1) {
    const start = pos + delim.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delim, start);
    if (next === -1) break;
    if (++parts > 40) throw new HttpError(400, "Partes demais no formulário.");
    const part = body.subarray(start + 2, next - 2); // remove CRLF antes e depois
    const headEnd = part.indexOf("\r\n\r\n");
    if (headEnd !== -1) {
      const head = part.subarray(0, headEnd).toString("utf8");
      const data = part.subarray(headEnd + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      if (name) {
        if (filename !== undefined) {
          if (filename !== "" || data.length > 0) ctx.files.push({ field: name, filename, data: Buffer.from(data) });
        } else ctx.fields[name] = data.toString("utf8");
      }
    }
    pos = next;
  }
}

export type Handler = (ctx: Ctx) => Promise<void> | void;
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp("^" + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    this.routes.push({ method, re, keys, handler });
  }
  get(p: string, h: Handler) { this.add("GET", p, h); }
  post(p: string, h: Handler) { this.add("POST", p, h); }
  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const m = method === "HEAD" ? "GET" : method;
    for (const r of this.routes) {
      if (r.method !== m) continue;
      const hit = r.re.exec(pathname);
      if (!hit) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(hit[i + 1]); } catch { params[k] = ""; } });
      return { handler: r.handler, params };
    }
    return null;
  }
  hasPath(pathname: string): boolean {
    return this.routes.some((r) => r.re.test(pathname));
  }
}
