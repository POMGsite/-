import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "pomg-exp-"));
process.env.DATABASE_PATH = path.join(tmp, "e.db");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
const { db, now, setSetting } = await import("../src/server/db.ts");
const { runExport } = await import("../src/server/export.ts");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const IMG = "a".repeat(32) + ".png", DOCF = "b".repeat(32) + ".pdf", DRAFTF = "c".repeat(32) + ".pdf";

mkdirSync(path.join(tmp, "uploads", "images"), { recursive: true });
mkdirSync(path.join(tmp, "uploads", "documents"), { recursive: true });
writeFileSync(path.join(tmp, "uploads", "images", IMG), PNG);
writeFileSync(path.join(tmp, "uploads", "documents", DOCF), PDF);
writeFileSync(path.join(tmp, "uploads", "documents", DRAFTF), PDF);

const t = now();
const d = db();
const mediaId = Number(d.prepare("INSERT INTO media (filename,original_name,alt,mime,size,created_at) VALUES (?,?,?,?,?,?)").run(IMG, "capa.png", "Capa", "image/png", PNG.length, t).lastInsertRowid);
const cat = (d.prepare("SELECT id FROM categories WHERE slug='comunicados'").get() as any).id;
d.prepare("INSERT INTO posts (slug,title,body,excerpt,kind,category_id,status,cover_media_id,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
  .run("nota-oficial", "Nota oficial", "Texto **aprovado**.", "Resumo", "comunicado", cat, "publicado", mediaId, t, t, t);
d.prepare("INSERT INTO posts (slug,title,body,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("rascunho-secreto", "Rascunho secreto", "x", "noticia", "rascunho", t, t);
d.prepare("INSERT INTO documents (title,category,filename,original_name,mime,size,status,created_at) VALUES (?,?,?,?,?,?,?,?)").run("Estatuto Social", "estatuto", DOCF, "Estatuto Social.pdf", "application/pdf", PDF.length, "publicado", t);
d.prepare("INSERT INTO documents (title,category,filename,original_name,mime,size,status,created_at) VALUES (?,?,?,?,?,?,?,?)").run("Documento interno", "arquivo", DRAFTF, "interno.pdf", "application/pdf", PDF.length, "rascunho", t);
d.prepare("UPDATE social_links SET url='https://www.tiktok.com/@exemplo' WHERE network='tiktok'").run();
setSetting("contact_email", "contato@exemplo.org");
setSetting("logo_media_id", String(mediaId));
d.prepare("INSERT INTO messages (name,email,subject,body,ip_hash,created_at) VALUES ('Segredo','segredo@x.org','Privado','texto privado','h',?)").run(t);

const out = path.join(tmp, "docs");
const BASE = "/repo";
const SITE = `https://usuario.github.io${BASE}`;
const res = await runExport({ out, siteUrl: SITE, domain: "https://www.Exemplo.com.br/" });

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(out).map((f) => path.relative(out, f));
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const read = (f: string) => readFileSync(path.join(out, f), "utf8");

test("gera as páginas, o 404 e os arquivos de apoio do GitHub Pages", () => {
  for (const f of ["index.html", "sobre/index.html", "principios/index.html", "noticias/index.html", "noticias/nota-oficial/index.html", "organizacao/index.html", "documentos/index.html", "contato/index.html", "privacidade/index.html", "404.html", ".nojekyll", "sitemap.xml", "robots.txt", "css/site.css", "js/site.js", `media/${IMG}`]) {
    assert.ok(files.includes(f), `faltou ${f}`);
  }
  assert.equal(read("CNAME").trim(), "www.exemplo.com.br");
  assert.ok(res.pages >= 10);
});

test("filtros e paginação viram pastas (sem query string)", () => {
  assert.ok(files.includes("noticias/tipo/comunicado/index.html"));
  assert.ok(files.includes("noticias/categoria/comunicados/index.html"));
  assert.match(read("noticias/tipo/comunicado/index.html"), /Nota oficial/);
  assert.doesNotMatch(read("noticias/tipo/artigo/index.html"), /Nota oficial/);
});

test("documento publicado é copiado com nome legível; rascunhos e dados privados não vazam", () => {
  const pdf = files.find((f) => /^arquivos\/\d+-estatuto-social\.pdf$/.test(f));
  assert.ok(pdf, "PDF do estatuto");
  assert.ok(!files.some((f) => f.includes("interno")), "documento em rascunho não pode sair");
  const all = files.filter((f) => /\.(html|xml|txt)$/.test(f)).map(read).join("\n");
  assert.doesNotMatch(all, /Rascunho secreto|Documento interno|segredo@x\.org|texto privado/);
  assert.ok(!files.some((f) => /\.db|session-secret|uploads/.test(f)));
});

test("sem painel, sem formulário e sem links para /admin; contato por e-mail", () => {
  for (const f of htmlFiles) {
    const h = read(f);
    assert.doesNotMatch(h, /\/admin/, f);
    assert.doesNotMatch(h, /<form/i, f);
  }
  const c = read("contato/index.html");
  assert.match(c, /mailto:contato@exemplo\.org/);
  assert.match(c, /Este site não possui formulário/);
  assert.match(read("privacidade/index.html"), /não possui formulários/);
});

test("todo link interno tem o prefixo do repositório e aponta para um arquivo que existe", () => {
  let checked = 0;
  for (const f of htmlFiles) {
    for (const m of read(f).matchAll(/\b(?:href|src)="(\/(?!\/)[^"#]*)/g)) {
      const link = m[1];
      assert.ok(link.startsWith(BASE + "/"), `${f}: ${link} sem prefixo`);
      assert.ok(!link.includes("?"), `${f}: ${link} com query string`);
      const rel = link.slice(BASE.length + 1);
      const target = rel === "" || rel.endsWith("/") ? path.join(rel, "index.html") : rel;
      assert.ok(existsSync(path.join(out, target)), `${f}: ${link} → ${target} não existe`);
      checked++;
    }
  }
  assert.ok(checked > 100, `poucos links verificados: ${checked}`);
});

test("SEO: canonical com o endereço final, sitemap e robots corretos; símbolo oficial no cabeçalho", () => {
  assert.match(read("sobre/index.html"), new RegExp(`<link rel="canonical" href="${SITE}/sobre"`));
  assert.match(read("sitemap.xml"), new RegExp(`<loc>${SITE}/noticias/nota-oficial</loc>`));
  assert.doesNotMatch(read("sitemap.xml"), /127\.0\.0\.1/);
  assert.match(read("robots.txt"), new RegExp(`Sitemap: ${SITE}/sitemap.xml`));
  assert.match(read("index.html"), new RegExp(`src="${BASE}/media/${IMG}"`));
});

test("recusa gravar em pasta existente que não foi criada pelo exportador; regerar na mesma pasta funciona", async () => {
  const other = path.join(tmp, "minhas-coisas");
  mkdirSync(other);
  writeFileSync(path.join(other, "importante.txt"), "não apague");
  await assert.rejects(runExport({ out: other, siteUrl: SITE }), /não foi criada por este comando/);
  assert.ok(existsSync(path.join(other, "importante.txt")));
  await runExport({ out, siteUrl: SITE });
  assert.ok(existsSync(path.join(out, "index.html")));
  await assert.rejects(runExport({ out, siteUrl: "" }), /--site-url/);
  rmSync(tmp, { recursive: true, force: true });
});
