import readline from "node:readline";
import { Writable } from "node:stream";
import { audit, db, now } from "./db.ts";
import { hashPassword, passwordProblem } from "./security.ts";

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const out = new Writable({ write(chunk, _enc, cb) { if (!muted) process.stdout.write(chunk); cb(); } });
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    process.stdout.write(question);
    muted = hidden;
    rl.question("", (answer) => { muted = false; if (hidden) process.stdout.write("\n"); rl.close(); resolve(answer); });
  });
}

const cmd = process.argv[2];
if (cmd === "create-admin") {
  const email = (process.env.ADMIN_EMAIL ?? (await ask("E-mail do administrador: "))).trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? (await ask("Nome: "))).trim() || "Administrador";
  const password = process.env.ADMIN_PASSWORD ?? (await ask("Senha (mín. 12, letras e números): ", true));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error("E-mail inválido."); process.exit(1); }
  const problem = passwordProblem(password);
  if (problem) { console.error(problem); process.exit(1); }
  const hash = await hashPassword(password);
  const existing = db().prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
  if (existing) {
    db().prepare("UPDATE users SET password_hash = ?, role = 'admin', active = 1, failed_attempts = 0, locked_until = 0 WHERE id = ?").run(hash, existing.id);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
    audit({ id: existing.id, email }, "admin_redefinido_via_cli");
    console.log(`Senha de ${email} redefinida.`);
  } else {
    db().prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?, 'admin', ?)").run(email, name, hash, now());
    audit(null, "admin_criado_via_cli", email);
    console.log(`Administrador ${email} criado.`);
  }
} else {
  console.log("Uso: npm run create-admin   (cria ou redefine um administrador)");
  process.exit(cmd ? 1 : 0);
}
