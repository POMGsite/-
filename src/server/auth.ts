import { audit, db, now, type Row } from "./db.ts";
import { config } from "./config.ts";
import { Ctx, HttpError, type User } from "./http.ts";
import { newToken, rateLimit, resetRateLimit, sha256, verifyPassword } from "./security.ts";

const COOKIE = "pomg_sid";
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;

export function loadSession(ctx: Ctx) {
  const token = ctx.cookies[COOKIE];
  if (!token || token.length > 100) return;
  const row = db().prepare(
    `SELECT s.id AS sid, s.csrf, s.expires_at, u.id, u.email, u.name, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
  ).get(sha256(token)) as Row | undefined;
  if (!row || row.expires_at < now() || !row.active) return;
  ctx.user = { id: row.id, email: row.email, name: row.name, role: row.role } as User;
  ctx.csrf = row.csrf;
  ctx.sessionId = row.sid;
}

export function startSession(ctx: Ctx, userId: number) {
  const token = newToken();
  const csrf = newToken();
  db().prepare("INSERT INTO sessions (id, user_id, csrf, expires_at, created_at) VALUES (?,?,?,?,?)")
    .run(sha256(token), userId, csrf, now() + config.sessionHours * 3600, now());
  ctx.cookie(COOKIE, token, { maxAge: config.sessionHours * 3600 });
}

export function endSession(ctx: Ctx) {
  if (ctx.sessionId) db().prepare("DELETE FROM sessions WHERE id = ?").run(ctx.sessionId);
  ctx.cookie(COOKIE, "", { maxAge: 0 });
}

export function endOtherSessions(userId: number, keepSessionId: string) {
  db().prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(userId, keepSessionId);
}

export type LoginResult = { ok: true; user: Row } | { ok: false; message: string; status: number };

export async function attemptLogin(ctx: Ctx, email: string, password: string): Promise<LoginResult> {
  const ipKey = `login:ip:${ctx.ip}`;
  const gate = rateLimit(ipKey, 20, 15 * 60_000);
  if (!gate.ok) return { ok: false, status: 429, message: `Muitas tentativas. Aguarde ${Math.ceil(gate.retryAfter / 60)} min.` };

  const user = db().prepare("SELECT * FROM users WHERE email = ?").get(email.trim()) as Row | undefined;
  if (user && user.locked_until > now()) {
    await verifyPassword(password, user.password_hash); // mantém o tempo de resposta
    return { ok: false, status: 429, message: "Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em alguns minutos." };
  }
  const good = await verifyPassword(password, user?.active ? user.password_hash : undefined);
  if (!good || !user) {
    if (user) {
      const fails = user.failed_attempts + 1;
      db().prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
        .run(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now() + LOCK_SECONDS : 0, user.id);
      if (fails >= MAX_FAILS) audit({ id: user.id, email: user.email }, "login_bloqueado", "5 tentativas falhas");
    }
    return { ok: false, status: 401, message: "E-mail ou senha incorretos." };
  }
  db().prepare("UPDATE users SET failed_attempts = 0, locked_until = 0, last_login = ? WHERE id = ?").run(now(), user.id);
  resetRateLimit(ipKey);
  audit({ id: user.id, email: user.email }, "login");
  return { ok: true, user };
}

/** Exige login (e, opcionalmente, o papel). Retorna false depois de redirecionar. */
export function requireUser(ctx: Ctx, role?: "admin"): boolean {
  if (!ctx.user) { ctx.redirect("/admin/login"); return false; }
  if (role && ctx.user.role !== role) throw new HttpError(403, "Você não tem permissão para esta ação.");
  return true;
}
