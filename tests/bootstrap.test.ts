import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "pomg-boot-"));
process.env.DATABASE_PATH = path.join(tmp, "b.db");
process.env.UPLOAD_DIR = path.join(tmp, "up");
const { bootstrapAdmin } = await import("../src/server/bootstrap.ts");
const { db } = await import("../src/server/db.ts");
const { verifyPassword } = await import("../src/server/security.ts");

test("cria o primeiro admin só se não houver usuários e a senha for forte", async () => {
  assert.equal(await bootstrapAdmin({}), "ignorado");
  assert.equal(await bootstrapAdmin({ ADMIN_EMAIL: "a@b.org", ADMIN_PASSWORD: "curta" }), "invalido");
  assert.equal(await bootstrapAdmin({ ADMIN_EMAIL: "x", ADMIN_PASSWORD: "Senha-Forte-12345" }), "invalido");
  assert.equal(db().prepare("SELECT 1 FROM users").get(), undefined);
  assert.equal(await bootstrapAdmin({ ADMIN_EMAIL: "Admin@Exemplo.org", ADMIN_PASSWORD: "Senha-Forte-12345" }), "criado");
  const u = db().prepare("SELECT * FROM users").get() as any;
  assert.equal(u.email, "admin@exemplo.org");
  assert.equal(u.role, "admin");
  assert.ok(await verifyPassword("Senha-Forte-12345", u.password_hash));
  assert.doesNotMatch(u.password_hash, /Senha-Forte/);
});

test("com usuário existente, as variáveis são ignoradas (não redefine senha)", async () => {
  assert.equal(await bootstrapAdmin({ ADMIN_EMAIL: "outro@exemplo.org", ADMIN_PASSWORD: "Outra-Senha-98765" }), "ignorado");
  assert.equal((db().prepare("SELECT COUNT(*) n FROM users").get() as any).n, 1);
  rmSync(tmp, { recursive: true, force: true });
});
