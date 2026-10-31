import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { db, getSettings, now, type Row } from "../db.ts";
import { Ctx, HttpError, Router } from "../http.ts";
import { checkFormToken, hashIp, rateLimit, signFormToken } from "../security.ts";
import type { Site } from "../../views/layout.tsx";
import * as V from "../../views/public.tsx";

export function siteData(): Site {
  const s = getSettings();
  const socials = db().prepare("SELECT network, label, url FROM social_links ORDER BY position, id").all() as Site["socials"];
  const logo = s.logo_media_id ? (db().prepare("SELECT filename FROM media WHERE id = ?").get(Number(s.logo_media_id)) as Row | undefined) : undefined;
  return { s, socials, logoUrl: logo ? `/media/${logo.filename}` : null };
}

const POST_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug, m.filename AS cover_filename, m.alt AS cover_alt, u.name AS author_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN media m ON m.id = p.cover_media_id
    LEFT JOIN users u ON u.id = p.author_id`;

const PAGE_SIZE = 9;

export function registerPublic(r: Router) {
  r.get("/", (ctx) => {
    const posts = db().prepare(`${POST_SELECT} WHERE p.status = 'publicado' ORDER BY p.published_at DESC LIMIT 3`).all();
    const principles = db().prepare("SELECT * FROM principles ORDER BY position, id").all();
    ctx.htmlCached(<V.Home site={siteData()} posts={posts} principles={principles} />, 30);
  });

  r.get("/sobre", (ctx) => {
    const docs = db().prepare("SELECT * FROM documents WHERE status = 'publicado' AND category = 'estatuto' ORDER BY created_at DESC").all();
    ctx.htmlCached(<V.About site={siteData()} docs={docs} />, 30);
  });

  r.get("/principios", (ctx) => {
    ctx.htmlCached(<V.Principles site={siteData()} principles={db().prepare("SELECT * FROM principles ORDER BY position, id").all()} />, 30);
  });

  r.get("/noticias", (ctx) => {
    const kind = ["noticia", "comunicado", "artigo"].includes(ctx.url.searchParams.get("tipo") ?? "") ? ctx.url.searchParams.get("tipo")! : undefined;
    const cat = (ctx.url.searchParams.get("categoria") ?? "").slice(0, 60) || undefined;
    const page = Math.max(1, parseInt(ctx.url.searchParams.get("pagina") ?? "1", 10) || 1);
    const where = ["p.status = 'publicado'"]; const args: (string | number)[] = [];
    if (kind) { where.push("p.kind = ?"); args.push(kind); }
    if (cat) { where.push("c.slug = ?"); args.push(cat); }
    const clause = `FROM posts p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(" AND ")}`;
    const total = (db().prepare(`SELECT COUNT(*) AS n ${clause}`).get(...args) as Row).n as number;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const posts = db().prepare(`${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.published_at DESC LIMIT ? OFFSET ?`)
      .all(...args, PAGE_SIZE, (Math.min(page, pages) - 1) * PAGE_SIZE);
    const categories = db().prepare("SELECT * FROM categories ORDER BY name").all();
    ctx.htmlCached(<V.NewsList site={siteData()} posts={posts} categories={categories} filter={{ kind, cat }} page={Math.min(page, pages)} pages={pages} />, 30);
  });

  r.get("/noticias/:slug", (ctx) => {
    const post = db().prepare(`${POST_SELECT} WHERE p.slug = ? AND p.status = 'publicado'`).get(ctx.params.slug) as Row | undefined;
    if (!post) return notFound(ctx);
    const related = db().prepare(`${POST_SELECT} WHERE p.status = 'publicado' AND p.id <> ? ORDER BY (p.category_id IS ?) DESC, p.published_at DESC LIMIT 3`).all(post.id, post.category_id);
    ctx.htmlCached(<V.NewsPost site={siteData()} post={post} related={related} />, 30);
  });

  r.get("/organizacao", (ctx) => {
    // Só aparecem pessoas com autorização registrada e marcadas como visíveis.
    const members = db().prepare(
      `SELECT m.*, f.filename AS photo_filename FROM members m LEFT JOIN media f ON f.id = m.photo_media_id
        WHERE m.visible = 1 AND m.publish_consent = 1 ORDER BY m.position, m.id`).all();
    ctx.htmlCached(<V.Organization site={siteData()} members={members} />, 30);
  });

  r.get("/documentos", (ctx) => {
    ctx.htmlCached(<V.Documents site={siteData()} docs={db().prepare("SELECT * FROM documents WHERE status = 'publicado' ORDER BY created_at DESC").all()} />, 30);
  });

  r.get("/documentos/arquivo/:id", (ctx) => {
    const d = db().prepare("SELECT * FROM documents WHERE id = ? AND status = 'publicado'").get(Number(ctx.params.id)) as Row | undefined;
    if (!d) return notFound(ctx);
    const file = path.join(config.uploadDir, "documents", d.filename);
    if (!existsSync(file)) return notFound(ctx);
    const safeName = encodeURIComponent(d.original_name);
    streamFile(ctx, file, d.mime, { "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`, "Cache-Control": "public, max-age=300" });
  });

  r.get("/media/:filename", (ctx) => {
    const name = ctx.params.filename;
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return notFound(ctx);
    const file = path.join(config.uploadDir, "images", name);
    if (!existsSync(file)) return notFound(ctx);
    const mime = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    streamFile(ctx, file, mime, { "Cache-Control": "public, max-age=604800, immutable" });
  });

  r.get("/privacidade", (ctx) => ctx.htmlCached(<V.Privacy site={siteData()} />, 30));

  r.get("/contato", (ctx) => ctx.html(<V.Contact site={siteData()} state={{ token: signFormToken() }} />));

  r.post("/contato", (ctx) => {
    const f = ctx.fields;
    const site = siteData();
    const fail = (status: number, error: string) =>
      ctx.html(<V.Contact site={site} state={{ error, values: { name: f.name ?? "", email: f.email ?? "", subject: f.subject ?? "", message: f.message ?? "" }, token: signFormToken() }} />, status);

    if (!ctx.sameOrigin()) return fail(403, "Não foi possível validar a origem do envio. Recarregue a página e tente de novo.");
    const gate = rateLimit(`contact:${ctx.ip}`, 8, 15 * 60_000);
    if (!gate.ok) return fail(429, `Muitos envios em pouco tempo. Tente novamente em ${Math.ceil(gate.retryAfter / 60)} minuto(s).`);
    // Armadilha para robôs: campo escondido preenchido → finge sucesso e descarta.
    if ((f.website ?? "") !== "") return ctx.html(<V.Contact site={site} state={{ ok: true, token: signFormToken() }} />);
    if (!checkFormToken(f.t ?? "")) return fail(400, "O formulário expirou ou foi enviado rápido demais. Tente novamente.");

    const clean = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
    const name = clean(f.name, 120), email = clean(f.email, 160), subject = clean(f.subject, 160), message = clean(f.message, 4000);
    if (name.length < 2) return fail(400, "Informe seu nome.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, "Informe um e-mail válido.");
    if (subject.length < 3) return fail(400, "Informe o assunto.");
    if (message.length < 10) return fail(400, "A mensagem está muito curta.");
    if (f.consent !== "1") return fail(400, "É necessário concordar com o tratamento dos dados para enviar.");

    db().prepare("INSERT INTO messages (name, email, subject, body, ip_hash, created_at) VALUES (?,?,?,?,?,?)")
      .run(name, email, subject, message, hashIp(ctx.ip), now());
    ctx.html(<V.Contact site={site} state={{ ok: true, token: signFormToken() }} />);
  });

  // Verificação de saúde para hospedagens (Render, Railway, Fly): confirma que o servidor e o banco respondem.
  r.get("/healthz", (ctx) => { db().prepare("SELECT 1").get(); ctx.send(200, "ok", "text/plain; charset=utf-8", { "Cache-Control": "no-store" }); });

  r.get("/robots.txt", (ctx) => {
    const base = baseUrl(ctx);
    ctx.send(200, `User-agent: *\nDisallow: /admin\nAllow: /\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ""}`, "text/plain; charset=utf-8", { "Cache-Control": "public, max-age=3600" });
  });

  r.get("/sitemap.xml", (ctx) => {
    const base = baseUrl(ctx);
    const urls: [string, string?][] = ["/", "/sobre", "/principios", "/noticias", "/organizacao", "/documentos", "/contato", "/privacidade"].map((p) => [p]);
    for (const p of db().prepare("SELECT slug, updated_at FROM posts WHERE status = 'publicado'").all() as Row[]) {
      urls.push([`/noticias/${p.slug}`, new Date(p.updated_at * 1000).toISOString().slice(0, 10)]);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map(([p, d]) => `  <url><loc>${esc(base + p)}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`).join("\n") + `\n</urlset>\n`;
    ctx.send(200, xml, "application/xml; charset=utf-8", { "Cache-Control": "public, max-age=3600" });
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

function baseUrl(ctx: Ctx): string {
  if (config.siteUrl) return config.siteUrl;
  const host = String(ctx.req.headers.host ?? "");
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${ctx.https ? "https" : "http"}://${host}` : "";
}

export function notFound(ctx: Ctx) {
  ctx.html(<V.NotFound site={siteData()} />, 404);
}

export function streamFile(ctx: Ctx, file: string, mime: string, extra: Record<string, string> = {}) {
  const st = statSync(file);
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  if (ctx.req.headers["if-none-match"] === etag) { ctx.send(304, ""); return; }
  ctx.res.writeHead(200, {
    "Content-Type": mime, "Content-Length": st.size, ETag: etag,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin", ...extra,
  });
  if (ctx.method === "HEAD") { ctx.res.end(); return; }
  createReadStream(file).pipe(ctx.res);
}

export { HttpError };
