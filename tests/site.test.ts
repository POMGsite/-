import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tmp = mkdtempSync(path.join(tmpdir(), "pomg-"));
process.env.DATABASE_PATH = path.join(tmp, "t.db");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");

const { createApp } = await import("../src/server/app.ts");
const { db, now } = await import("../src/server/db.ts");
const { hashPassword, resetRateLimit } = await import("../src/server/security.ts");

let server: Server;
let base: string;

class Client {
  jar = new Map<string, string>();
  csrf = "";
  async req(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(base + url, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0/i.test(c) || v === "") this.jar.delete(k); else this.jar.set(k, v);
    }
    return res;
  }
  async text(url: string, init?: RequestInit) { const r = await this.req(url, init); return { res: r, body: await r.text() }; }
  form(fields: Record<string, string>) {
    return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() };
  }
  async login(email: string, password: string) {
    const r = await this.req("/admin/login", this.form({ email, password }));
    if (r.status === 303) await this.loadCsrf();
    return r;
  }
  async loadCsrf() {
    const { body } = await this.text("/admin");
    this.csrf = /name="_csrf" value="([^"]+)"/.exec(body)?.[1] ?? "";
  }
  post(url: string, fields: Record<string, string> = {}) { return this.req(url, this.form({ _csrf: this.csrf, ...fields })); }
  async upload(url: string, file: { name: string; data: Buffer; type: string }, fields: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("_csrf", this.csrf);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set("file", new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
    return this.req(url, { method: "POST", body: fd });
  }
}

const PW = "Senha-Forte-12345";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

before(async () => {
  server = createApp();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const d = db();
  d.prepare("INSERT INTO users (email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)").run("admin@teste.local", "Admin Teste", await hashPassword(PW), "admin", now());
  d.prepare("INSERT INTO users (email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)").run("editor@teste.local", "Editor Teste", await hashPassword(PW), "editor", now());
});
after(() => { server.close(); server.closeAllConnections?.(); rmSync(tmp, { recursive: true, force: true }); });

describe("páginas públicas", () => {
  const pages = ["/", "/sobre", "/principios", "/noticias", "/organizacao", "/documentos", "/contato", "/privacidade"];
  for (const p of pages) {
    test(`GET ${p} → 200, HTML válido e cabeçalhos de segurança`, async () => {
      const c = new Client();
      const { res, body } = await c.text(p);
      assert.equal(res.status, 200);
      assert.match(body, /^<!doctype html>/i);
      assert.match(body, /<html lang="pt-BR">/);
      assert.match(body, /<title>.+<\/title>/);
      assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.doesNotMatch(body, / style="/, "CSP bloqueia estilos inline");
      assert.doesNotMatch(body, /<(?:script|link|img|iframe|source)[^>]+(?:src|href)="(?:https?:)?\/\/[^"]+"/i, "sem recursos externos");
    });
  }

  test("home usa o nome do partido e mostra 'a informar' onde falta conteúdo (sem inventar)", async () => {
    const { body } = await new Client().text("/");
    assert.match(body, /Partido Operalista/);
    assert.match(body, /A informar/);
    assert.match(body, /Cultura/);
    assert.match(body, /Nacionalismo/);
  });

  test("404 e método não permitido", async () => {
    const c = new Client();
    assert.equal((await c.req("/nao-existe")).status, 404);
    assert.equal((await c.req("/sobre", { method: "POST" })).status, 405);
    assert.equal((await c.req("/x", { method: "DELETE" })).status, 405);
  });

  test("arquivos estáticos e proteção contra path traversal", async () => {
    const c = new Client();
    assert.equal((await c.req("/css/site.css")).status, 200);
    assert.equal((await c.req("/js/site.js")).status, 200);
    assert.equal((await c.req("/css/..%2f..%2fpackage.json")).status, 404);
    assert.equal((await c.req("/css/../../package.json")).status, 404);
    assert.equal((await c.req("/media/..%2f..%2fpackage.json")).status, 404);
  });

  test("robots.txt e sitemap.xml", async () => {
    const c = new Client();
    const robots = await c.text("/robots.txt");
    assert.match(robots.body, /Disallow: \/admin/);
    const sm = await c.text("/sitemap.xml");
    assert.match(sm.body, /<urlset/);
    assert.match(sm.body, /\/sobre</);
  });
});

describe("autenticação e painel", () => {
  test("painel exige login", async () => {
    const c = new Client();
    const r = await c.req("/admin");
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/admin/login");
    assert.equal((await c.req("/admin/posts")).status, 303);
  });

  test("POST sem sessão não executa nada", async () => {
    const c = new Client();
    const r = await c.req("/admin/posts/save", c.form({ title: "x", body: "y" }));
    assert.equal(r.status, 303);
    assert.equal((db().prepare("SELECT COUNT(*) n FROM posts").get() as any).n, 0);
  });

  test("senha errada → 401 sem revelar se o e-mail existe", async () => {
    const c = new Client();
    const a = await c.login("admin@teste.local", "errada-errada-1");
    const b = await c.login("ninguem@teste.local", "errada-errada-1");
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.equal(await a.text(), await b.text());
  });

  test("bloqueio após 5 tentativas erradas, mesmo com a senha certa depois", async () => {
    db().prepare("INSERT INTO users (email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)").run("trava@teste.local", "Trava", await hashPassword(PW), "editor", now());
    const c = new Client();
    for (let i = 0; i < 5; i++) assert.equal((await c.login("trava@teste.local", "errada-errada-1")).status, 401);
    const r = await c.login("trava@teste.local", PW);
    assert.equal(r.status, 429);
  });

  test("login válido: cookie HttpOnly + SameSite e painel acessível", async () => {
    const c = new Client();
    const r = await c.req("/admin/login", c.form({ email: "admin@teste.local", password: PW }));
    assert.equal(r.status, 303);
    const sc = r.headers.getSetCookie().join(" ");
    assert.match(sc, /pomg_sid=/); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
    await c.loadCsrf();
    const { res, body } = await c.text("/admin");
    assert.equal(res.status, 200);
    assert.match(body, /Painel/);
    assert.match(body, /noindex/);
  });

  test("CSRF: POST autenticado sem token é recusado; origem externa também", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const noToken = await c.req("/admin/posts/save", c.form({ title: "csrf", body: "csrf" }));
    assert.equal(noToken.status, 403);
    const badToken = await c.req("/admin/posts/save", c.form({ _csrf: "x".repeat(43), title: "csrf", body: "csrf" }));
    assert.equal(badToken.status, 403);
    const foreign = await c.req("/admin/posts/save", { ...c.form({ _csrf: c.csrf, title: "csrf", body: "csrf" }), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" } });
    assert.equal(foreign.status, 403);
    assert.equal((db().prepare("SELECT COUNT(*) n FROM posts WHERE title='csrf'").get() as any).n, 0);
  });

  test("logout encerra a sessão no servidor", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const sid = c.jar.get("pomg_sid")!;
    await c.post("/admin/logout");
    const c2 = new Client(); c2.jar.set("pomg_sid", sid);
    assert.equal((await c2.req("/admin")).status, 303);
  });
});

describe("publicações", () => {
  test("rascunho não aparece; publicado aparece em lista, página própria e sitemap; XSS é neutralizado", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const bad = '<script>alert(1)</script> [clique](javascript:alert(2)) [ok](https://exemplo.org) **forte**';
    let r = await c.post("/admin/posts/save", { title: "Comunicado de teste", kind: "comunicado", status: "rascunho", excerpt: "Resumo <b>x</b>", body: bad });
    assert.equal(r.status, 303);
    assert.equal((await new Client().req("/noticias/comunicado-de-teste")).status, 404);
    const id = (db().prepare("SELECT id FROM posts WHERE slug='comunicado-de-teste'").get() as any).id;
    r = await c.post("/admin/posts/save", { id: String(id), title: "Comunicado de teste", kind: "comunicado", status: "publicado", excerpt: "Resumo <b>x</b>", body: bad });
    assert.equal(r.status, 303);
    const pub = new Client();
    const page = await pub.text("/noticias/comunicado-de-teste");
    assert.equal(page.res.status, 200);
    assert.doesNotMatch(page.body, /<script>alert/);
    assert.match(page.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(page.body, /href="javascript:/i);
    assert.match(page.body, /href="https:\/\/exemplo\.org"/);
    assert.match(page.body, /<strong>forte<\/strong>/);
    assert.match((await pub.text("/noticias")).body, /Comunicado de teste/);
    assert.match((await pub.text("/noticias?tipo=comunicado")).body, /Comunicado de teste/);
    assert.doesNotMatch((await pub.text("/noticias?tipo=artigo")).body, /Comunicado de teste/);
    assert.match((await pub.text("/sitemap.xml")).body, /comunicado-de-teste/);
  });

  test("slug único e título obrigatório", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    await c.post("/admin/posts/save", { title: "Repetido", status: "publicado", body: "a" });
    await c.post("/admin/posts/save", { title: "Repetido", status: "publicado", body: "b" });
    assert.deepEqual((db().prepare("SELECT slug FROM posts WHERE title='Repetido' ORDER BY id").all() as any[]).map((x) => x.slug), ["repetido", "repetido-2"]);
    const bad = await c.post("/admin/posts/save", { title: "", body: "" });
    assert.equal(bad.status, 400);
  });

  test("editor cria mas não exclui nem acessa áreas de administrador", async () => {
    const c = new Client();
    await c.login("editor@teste.local", PW);
    assert.equal((await c.post("/admin/posts/save", { title: "Do editor", status: "rascunho", body: "texto" })).status, 303);
    const id = (db().prepare("SELECT id FROM posts WHERE title='Do editor'").get() as any).id;
    assert.equal((await c.post(`/admin/posts/${id}/delete`)).status, 403);
    for (const p of ["/admin/usuarios", "/admin/site", "/admin/mensagens", "/admin/principios", "/admin/links", "/admin/atividade"]) {
      assert.equal((await c.req(p)).status, 403, p);
    }
    assert.equal((await c.post("/admin/site", { site_name: "Hackeado" })).status, 403);
    assert.equal((db().prepare("SELECT value FROM settings WHERE key='site_name'").get() as any).value, "Partido Operalista");
    const a = new Client(); await a.login("admin@teste.local", PW);
    assert.equal((await a.post(`/admin/posts/${id}/delete`)).status, 303);
    assert.equal(db().prepare("SELECT 1 FROM posts WHERE id=?").get(id), undefined);
  });
});

describe("uploads", () => {
  test("imagem válida é aceita e servida; SVG/HTML/executável são recusados mesmo com extensão enganosa", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    assert.equal((await c.upload("/admin/imagens/upload", { name: "ok.png", data: PNG, type: "image/png" }, { alt: "teste" })).status, 303);
    const m = db().prepare("SELECT * FROM media").get() as any;
    assert.match(m.filename, /^[a-f0-9]{32}\.png$/);
    const served = await c.req(`/media/${m.filename}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");

    const before = (db().prepare("SELECT COUNT(*) n FROM media").get() as any).n;
    const evil: [string, Buffer, string][] = [
      ["x.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), "image/svg+xml"],
      ["x.png", Buffer.from("<html><script>alert(1)</script></html>"), "image/png"],
      ["x.jpg", Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff"), "image/jpeg"],
      ["x.png", Buffer.from(""), "image/png"],
    ];
    for (const [name, data, type] of evil) await c.upload("/admin/imagens/upload", { name, data, type });
    assert.equal((db().prepare("SELECT COUNT(*) n FROM media").get() as any).n, before);
  });

  test("PDF não é aceito como imagem; nome com ../ vira nome seguro", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const n = (db().prepare("SELECT COUNT(*) n FROM media").get() as any).n;
    await c.upload("/admin/imagens/upload", { name: "doc.pdf", data: PDF, type: "application/pdf" });
    assert.equal((db().prepare("SELECT COUNT(*) n FROM media").get() as any).n, n);
    await c.upload("/admin/imagens/upload", { name: "../../etc/passwd.png", data: PNG, type: "image/png" });
    const last = db().prepare("SELECT filename, original_name FROM media ORDER BY id DESC LIMIT 1").get() as any;
    assert.match(last.filename, /^[a-f0-9]{32}\.png$/);
    assert.doesNotMatch(last.original_name, /\//);
  });

  test("documento: publicado baixa como anexo; rascunho dá 404; despublicar/excluir funcionam", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    assert.equal((await c.upload("/admin/documentos/upload", { name: "Estatuto 2022.pdf", data: PDF, type: "application/pdf" }, { title: "Estatuto", category: "estatuto", status: "publicado" })).status, 303);
    const d = db().prepare("SELECT * FROM documents WHERE title='Estatuto'").get() as any;
    const pub = new Client();
    const dl = await pub.req(`/documentos/arquivo/${d.id}`);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("content-type"), "application/pdf");
    assert.match(dl.headers.get("content-disposition") ?? "", /^attachment/);
    assert.match((await pub.text("/documentos")).body, /Estatuto/);
    assert.match((await pub.text("/sobre")).body, /Estatuto/);
    await c.post(`/admin/documentos/${d.id}/status`, { status: "rascunho" });
    assert.equal((await pub.req(`/documentos/arquivo/${d.id}`)).status, 404);
    await c.post(`/admin/documentos/${d.id}/delete`);
    assert.equal(db().prepare("SELECT 1 FROM documents WHERE id=?").get(d.id), undefined);
  });

  test("arquivo grande demais é recusado antes de ser lido por inteiro", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    const r = await c.upload("/admin/imagens/upload", { name: "big.png", data: big, type: "image/png" });
    assert.equal(r.status, 413);
  });

  test("símbolo oficial: ao definir, aparece no site (home e cabeçalho)", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const m = db().prepare("SELECT id, filename FROM media ORDER BY id LIMIT 1").get() as any;
    await c.post(`/admin/imagens/${m.id}/logo`);
    const { body } = await new Client().text("/");
    assert.match(body, new RegExp(`/media/${m.filename}`));
    assert.match(body, /Símbolo oficial/);
  });
});

describe("contato", () => {
  before(() => resetRateLimit("contact:127.0.0.1"));
  const token = async (c: Client) => /name="t" value="([^"]+)"/.exec((await c.text("/contato")).body)![1];
  const good = { name: "Maria da Silva", email: "maria@exemplo.org", subject: "Dúvida", message: "Gostaria de saber mais sobre o partido.", consent: "1", website: "" };

  test("campos inválidos, sem consentimento, token falso e envio rápido demais são recusados", async () => {
    const c = new Client();
    const t = await token(c);
    const send = (o: Record<string, string>) => c.req("/contato", c.form({ ...good, t, ...o }));
    assert.equal((await send({})).status, 400, "rápido demais");
    assert.equal((await send({ t: "abc.def" })).status, 400, "token falso");
    await new Promise((r) => setTimeout(r, 3200));
    assert.equal((await send({ consent: "" })).status, 400);
    assert.equal((await send({ email: "invalido" })).status, 400);
    assert.equal((await send({ message: "curta" })).status, 400);
    assert.equal((await send({ name: "" })).status, 400);
    assert.equal((db().prepare("SELECT COUNT(*) n FROM messages").get() as any).n, 0);
  });

  test("envio válido grava mensagem, sem IP em claro; honeypot descarta em silêncio", async () => {
    resetRateLimit("contact:127.0.0.1");
    const c = new Client();
    const t = await token(c);
    await new Promise((r) => setTimeout(r, 3200));
    const ok = await c.text("/contato", c.form({ ...good, t }));
    assert.equal(ok.res.status, 200);
    assert.match(ok.body, /Mensagem enviada/);
    const m = db().prepare("SELECT * FROM messages").get() as any;
    assert.equal(m.email, "maria@exemplo.org");
    assert.doesNotMatch(m.ip_hash, /127\.0\.0\.1/);
    assert.equal(m.ip_hash.length, 24);

    const bot = await c.text("/contato", c.form({ ...good, t, website: "http://spam.example" }));
    assert.equal(bot.res.status, 200);
    assert.equal((db().prepare("SELECT COUNT(*) n FROM messages").get() as any).n, 1);
  });

  test("limite de envios por IP (429)", async () => {
    resetRateLimit("contact:127.0.0.1");
    const c = new Client();
    const t = await token(c);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await c.req("/contato", c.form({ ...good, t }))).status;
    assert.equal(last, 429);
  });

  test("administrador lê, marca como lida e exclui mensagens (texto escapado)", async () => {
    db().prepare("INSERT INTO messages (name,email,subject,body,ip_hash,created_at) VALUES (?,?,?,?,?,?)").run("X", "x@x.org", "Teste", "<img src=x onerror=alert(1)>", "h", now());
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const { body } = await c.text("/admin/mensagens");
    assert.doesNotMatch(body, /<img src=x/);
    assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/);
    const id = (db().prepare("SELECT id FROM messages WHERE subject='Teste'").get() as any).id;
    await c.post(`/admin/mensagens/${id}/lida`);
    assert.equal((db().prepare("SELECT is_read FROM messages WHERE id=?").get(id) as any).is_read, 1);
    await c.post(`/admin/mensagens/${id}/delete`);
    assert.equal(db().prepare("SELECT 1 FROM messages WHERE id=?").get(id), undefined);
  });
});

describe("conteúdo institucional", () => {
  test("textos editados no painel aparecem no site; e-mail inválido é recusado", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    assert.equal((await c.post("/admin/site", { contact_email: "invalido" })).status, 303);
    assert.equal((db().prepare("SELECT value FROM settings WHERE key='contact_email'").get() as any).value, "");
    await c.post("/admin/site", { home_intro: "Texto aprovado pela direção.", contact_email: "contato@exemplo.org", about_history: "## Começo\n\nTexto de história." });
    const pub = new Client();
    assert.match((await pub.text("/")).body, /Texto aprovado pela direção\./);
    const contato = (await pub.text("/contato")).body;
    assert.match(contato, /mailto:contato@exemplo\.org/);
    assert.match((await pub.text("/sobre")).body, /<h2>Começo<\/h2>/);
  });

  test("princípios: editar aparece em /principios", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const p = db().prepare("SELECT id FROM principles WHERE slug='trabalho'").get() as any;
    await c.post(`/admin/principios/${p.id}`, { body: "Texto do princípio Trabalho." });
    assert.match((await new Client().text("/principios")).body, /Texto do princípio Trabalho\./);
  });

  test("links sociais: só https/http; vazios não aparecem; válidos aparecem", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    const tk = db().prepare("SELECT id FROM social_links WHERE network='tiktok'").get() as any;
    await c.post("/admin/links", { [`url_${tk.id}`]: "javascript:alert(1)" });
    assert.equal((db().prepare("SELECT url FROM social_links WHERE id=?").get(tk.id) as any).url, "");
    assert.doesNotMatch((await new Client().text("/contato")).body, /TikTok/);
    await c.post("/admin/links", { [`url_${tk.id}`]: "https://www.tiktok.com/@exemplo" });
    assert.match((await new Client().text("/contato")).body, /href="https:\/\/www\.tiktok\.com\/@exemplo"/);
  });

  test("dirigentes: só aparecem com autorização registrada e marcados como visíveis", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    await c.post("/admin/membros/save", { name: "Fulano de Tal", role: "Presidente", visible: "1" });
    assert.equal(db().prepare("SELECT 1 FROM members").get(), undefined, "sem autorização não salva como visível");
    await c.post("/admin/membros/save", { name: "Fulano de Tal", role: "Presidente", publish_consent: "1" });
    assert.doesNotMatch((await new Client().text("/organizacao")).body, /Fulano de Tal/, "autorizado mas não marcado visível");
    const id = (db().prepare("SELECT id FROM members").get() as any).id;
    await c.post("/admin/membros/save", { id: String(id), name: "Fulano de Tal", role: "Presidente", publish_consent: "1", visible: "1" });
    assert.match((await new Client().text("/organizacao")).body, /Fulano de Tal/);
  });
});

describe("usuários e senhas", () => {
  test("criar usuário valida senha fraca, e-mail duplicado; trocar senha exige a atual", async () => {
    const c = new Client();
    await c.login("admin@teste.local", PW);
    await c.post("/admin/usuarios/new", { name: "N", email: "novo@teste.local", role: "editor", password: "curta1" });
    assert.equal(db().prepare("SELECT 1 FROM users WHERE email='novo@teste.local'").get(), undefined);
    await c.post("/admin/usuarios/new", { name: "N", email: "novo@teste.local", role: "editor", password: "Outra-Senha-9876" });
    assert.ok(db().prepare("SELECT 1 FROM users WHERE email='novo@teste.local'").get());
    const hash = (db().prepare("SELECT password_hash h FROM users WHERE email='novo@teste.local'").get() as any).h as string;
    assert.match(hash, /^scrypt\$/);
    assert.doesNotMatch(hash, /Outra-Senha/);

    const before = (db().prepare("SELECT password_hash h FROM users WHERE email='admin@teste.local'").get() as any).h;
    await c.post("/admin/conta", { current: "errada-errada-1", next: "Nova-Senha-2468x", again: "Nova-Senha-2468x" });
    assert.equal((db().prepare("SELECT password_hash h FROM users WHERE email='admin@teste.local'").get() as any).h, before);
  });

  test("usuário desativado perde as sessões e não consegue entrar", async () => {
    const adm = new Client(); await adm.login("admin@teste.local", PW);
    const ed = new Client(); await ed.login("novo@teste.local", "Outra-Senha-9876");
    assert.equal((await ed.req("/admin")).status, 200);
    const id = (db().prepare("SELECT id FROM users WHERE email='novo@teste.local'").get() as any).id;
    await adm.post(`/admin/usuarios/${id}/ativo`, { active: "0" });
    assert.equal((await ed.req("/admin")).status, 303);
    assert.equal((await new Client().login("novo@teste.local", "Outra-Senha-9876")).status, 401);
  });
});

describe("hospedagem", () => {
  test("/healthz responde ok", async () => {
    const { res, body } = await new Client().text("/healthz");
    assert.equal(res.status, 200);
    assert.equal(body, "ok");
  });
});
