import { audit, db, now } from "./db.ts";
import { hashPassword, passwordProblem } from "./security.ts";

/**
 * Para hospedagens sem terminal: se NÃO existir nenhum usuário e as variáveis ADMIN_EMAIL e
 * ADMIN_PASSWORD estiverem definidas, cria o primeiro administrador. Depois de entrar,
 * troque a senha em "Minha conta" e REMOVA a variável ADMIN_PASSWORD do painel da hospedagem.
 * Com usuários já existentes, não faz nada (as variáveis são ignoradas).
 */
export async function bootstrapAdmin(env: NodeJS.ProcessEnv = process.env): Promise<"criado" | "ignorado" | "invalido"> {
  const email = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? "";
  if (!email || !password) return "ignorado";
  if (db().prepare("SELECT 1 FROM users LIMIT 1").get()) return "ignorado";
  const problem = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? "ADMIN_EMAIL inválido" : passwordProblem(password);
  if (problem) { console.error(`[bootstrap] Administrador não criado: ${problem}`); return "invalido"; }
  db().prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?, 'admin', ?)")
    .run(email, (env.ADMIN_NAME ?? "Administrador").trim().slice(0, 100) || "Administrador", await hashPassword(password), now());
  audit(null, "admin_criado_via_variavel_de_ambiente", email);
  console.log(`[bootstrap] Administrador ${email} criado. Troque a senha e remova ADMIN_PASSWORD das variáveis da hospedagem.`);
  return "criado";
}
