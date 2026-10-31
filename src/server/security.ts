import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/* ---------- segredo da aplicação (nunca vai para o código) ---------- */
function loadSecret(): Buffer {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    return Buffer.from(process.env.SESSION_SECRET);
  }
  const file = path.join(path.dirname(config.dbPath), ".session-secret");
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  const secret = randomBytes(48);
  writeFileSync(file, secret.toString("hex"), { mode: 0o600 });
  return secret;
}
const SECRET = loadSecret();

/* ---------- senhas: scrypt com sal aleatório ---------- */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

const DUMMY_HASH = await hashPassword(randomBytes(12).toString("hex"));

/** Sempre executa o scrypt (mesmo com usuário inexistente) para não vazar, pelo tempo, quais e-mails existem. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const hash = stored ?? DUMMY_HASH;
  const [alg, n, saltB64, keyB64] = hash.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { ...SCRYPT, N: Number(n) });
  const ok = key.length === expected.length && timingSafeEqual(key, expected);
  return ok && stored !== undefined;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "A senha precisa ter pelo menos 12 caracteres.";
  if (pw.length > 200) return "A senha é longa demais.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Use letras e números na senha.";
  if (/^(.)\1+$/.test(pw)) return "Escolha uma senha menos previsível.";
  return null;
}

/* ---------- tokens ---------- */
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** IP nunca é guardado em claro: só um HMAC curto, suficiente para detectar abuso (LGPD: minimização). */
export const hashIp = (ip: string) => createHmac("sha256", SECRET).update(ip).digest("hex").slice(0, 24);

/** Token assinado com horário, usado no formulário de contato (anti-robô: envio rápido demais é rejeitado). */
export function signFormToken(): string {
  const ts = Date.now().toString(36);
  const sig = createHmac("sha256", SECRET).update("form." + ts).digest("base64url").slice(0, 22);
  return `${ts}.${sig}`;
}
export function checkFormToken(token: string, minMs = 3000, maxMs = 2 * 60 * 60 * 1000): boolean {
  const [ts, sig] = (token || "").split(".");
  if (!ts || !sig) return false;
  const expected = createHmac("sha256", SECRET).update("form." + ts).digest("base64url").slice(0, 22);
  if (!safeEqual(sig, expected)) return false;
  const age = Date.now() - parseInt(ts, 36);
  return age >= minMs && age <= maxMs;
}

/* ---------- limite de requisições (em memória) ---------- */
type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= t) {
    buckets.set(key, { count: 1, reset: t + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  return { ok: b.count <= max, retryAfter: Math.ceil((b.reset - t) / 1000) };
}
export function resetRateLimit(key: string) { buckets.delete(key); }

setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset <= t) buckets.delete(k);
}, 60_000).unref();

/* ---------- cabeçalhos de segurança ---------- */
export function securityHeaders(isHttps: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (isHttps) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return h;
}
