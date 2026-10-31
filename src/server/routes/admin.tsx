import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { config } from "../config.ts";
import { attemptLogin, endOtherSessions, endSession, requireUser, startSession } from "../auth.ts";
import { audit, db, getSettings, now, setSetting, uniqueSlug, type Row } from "../db.ts";
import { Ctx, HttpError, Router } from "../http.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../security.ts";
import { saveUpload, UploadError } from "../uploads.ts";
import * as A from "../../views/admin.tsx";
import { safeUrl } from "../../views/richtext.tsx";

type FlashKind = "ok" | "err";

function setFlash(ctx: Ctx, kind: FlashKind, text: string) {
  ctx.cookie("pomg_flash", encodeURIComponent(`${kind}:${text}`), { maxAge: 30 });
}
function takeFlash(ctx: Ctx): A.Flash {
  const raw = ctx.cookies.pomg_flash;
  if (!raw) return null;
  ctx.cookie("pomg_flash", "", { maxAge: 0 });
  try {
    const t = decodeURIComponent(raw);
    const i = t.indexOf(":");
    const kind = t.slice(0, i) === "ok" ? "ok" : "err";
    return { kind, text: t.slice(i + 1).slice(0, 300) };
  } catch { return null; }
}

function page(ctx: Ctx, title: string, children: ReactNode, status = 200, flash: A.Flash = takeFlash(ctx)) {
  const unread = (db().prepare("SELECT COUNT(*) AS n FROM messages WHERE is_read = 0").get() as Row).n as number;
  ctx.html(
    <A.AdminShell title={title} user={ctx.user} csrf={ctx.csrf} flash={flash} siteName={getSettings().site_name} unread={unread}>{children}</A.AdminShell>,
    status,
  );
}

const str = (v: string | undefined, max: number) => (v ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const intOr = (v: string | undefined, d: number) => { const n = parseInt(v ?? "", 10); return Number.isFinite(n) ? n : d; };
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function removeFile(kind: "images" | "documents", filename: string) {
  const f = path.join(config.uploadDir, kind, path.basename(filename));
  if (existsSync(f)) unlinkSync(f);
}

export function registerAdmin(r: Router) {
  /* ---------- login / logout ---------- */
  r.get("/admin/login", (ctx) => {
    if (ctx.user) return ctx.redirect("/admin");
    ctx.html(<A.Login siteName={getSettings().site_name} />);
  });

  r.post("/admin/login", async (ctx) => {
    const siteName = getSettings().site_name;
    if (!ctx.sameOrigin()) return ctx.html(<A.Login siteName={siteName} error="Requisição recusada." />, 403);
    const res = await attemptLogin(ctx, String(ctx.fields.email ?? "").slice(0, 200), String(ctx.fields.password ?? "").slice(0, 300));
    if (!res.ok) return ctx.html(<A.Login siteName={siteName} error={res.message} />, res.status);
    startSession(ctx, res.user.id);
    ctx.redirect("/admin");
  });

  r.post("/admin/logout", (ctx) => {
    audit(ctx.user, "logout");
    endSession(ctx);
    ctx.redirect("/admin/login");
  });

  /* ---------- painel ---------- */
  r.get("/admin", (ctx) => {
    if (!requireUser(ctx)) return;
    const n = (sql: string) => (db().prepare(sql).get() as Row).n as number;
    const counts = {
      posts: n("SELECT COUNT(*) AS n FROM posts WHERE status='publicado'"),
      drafts: n("SELECT COUNT(*) AS n FROM posts WHERE status='rascunho'"),
      docs: n("SELECT COUNT(*) AS n FROM documents"),
      media: n("SELECT COUNT(*) AS n FROM media"),
      unread: n("SELECT COUNT(*) AS n FROM messages WHERE is_read=0"),
    };
    page(ctx, "Painel", <A.Dashboard counts={counts} recent={db().prepare("SELECT id,title,status,updated_at FROM posts ORDER BY updated_at DESC LIMIT 5").all()} />);
  });

  /* ---------- publicações ---------- */
  r.get("/admin/posts", (ctx) => {
    if (!requireUser(ctx)) return;
    page(ctx, "Publicações", <A.PostList user={ctx.user!} posts={db().prepare("SELECT id,title,kind,status,updated_at FROM posts ORDER BY updated_at DESC").all()} />);
  });

  const postForm = (ctx: Ctx, post: Row | null, error?: string, status = 200) => {
    const categories = db().prepare("SELECT * FROM categories ORDER BY name").all();
    const images = db().prepare("SELECT id, original_name FROM media ORDER BY id DESC").all();
    page(ctx, post ? "Editar publicação" : "Nova publicação", <A.PostForm post={post} categories={categories} images={images} csrf={ctx.csrf} user={ctx.user!} error={error} />, status);
  };

  r.get("/admin/posts/new", (ctx) => { if (requireUser(ctx)) postForm(ctx, null); });

  r.get("/admin/posts/:id", (ctx) => {
    if (!requireUser(ctx)) return;
    const post = db().prepare("SELECT * FROM posts WHERE id = ?").get(intOr(ctx.params.id, -1)) as Row | undefined;
    if (!post) throw new HttpError(404, "Publicação não encontrada.");
    postForm(ctx, post);
  });

  r.post("/admin/posts/save", (ctx) => {
    if (!requireUser(ctx)) return;
    const f = ctx.fields;
    const id = f.id ? intOr(f.id, -1) : null;
    const existing = id ? (db().prepare("SELECT * FROM posts WHERE id = ?").get(id) as Row | undefined) : undefined;
    if (id && !existing) throw new HttpError(404, "Publicação não encontrada.");
    const title = str(f.title, 180), body = str(f.body, 60000), excerpt = str(f.excerpt, 300);
    const kind = ["noticia", "comunicado", "artigo"].includes(f.kind) ? f.kind : "noticia";
    const status = f.status === "publicado" ? "publicado" : "rascunho";
    const cat = f.category_id ? intOr(f.category_id, 0) : null;
    const cover = f.cover_media_id ? intOr(f.cover_media_id, 0) : null;
    const draft = { ...(existing ?? {}), title, body, excerpt, kind, status, category_id: cat, cover_media_id: cover };
    if (!title || !body) return postForm(ctx, draft as Row, "Título e texto são obrigatórios.", 400);
    if (cat && !db().prepare("SELECT 1 FROM categories WHERE id = ?").get(cat)) return postForm(ctx, draft as Row, "Categoria inválida.", 400);
    if (cover && !db().prepare("SELECT 1 FROM media WHERE id = ?").get(cover)) return postForm(ctx, draft as Row, "Imagem de capa inválida.", 400);
    const t = now();
    if (existing) {
      const publishedAt = status === "publicado" ? (existing.published_at ?? t) : existing.published_at;
      db().prepare("UPDATE posts SET title=?, body=?, excerpt=?, kind=?, status=?, category_id=?, cover_media_id=?, published_at=?, updated_at=? WHERE id=?")
        .run(title, body, excerpt, kind, status, cat, cover, publishedAt, t, existing.id);
      audit(ctx.user, "publicacao_editada", `#${existing.id} ${title} (${status})`);
      setFlash(ctx, "ok", "Publicação salva.");
      return ctx.redirect(`/admin/posts/${existing.id}`);
    }
    const slug = uniqueSlug("posts", title);
    const res = db().prepare("INSERT INTO posts (slug,title,body,excerpt,kind,status,category_id,cover_media_id,author_id,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(slug, title, body, excerpt, kind, status, cat, cover, ctx.user!.id, status === "publicado" ? t : null, t, t);
    audit(ctx.user, "publicacao_criada", `#${res.lastInsertRowid} ${title} (${status})`);
    setFlash(ctx, "ok", "Publicação criada.");
    ctx.redirect(`/admin/posts/${res.lastInsertRowid}`);
  });

  r.post("/admin/posts/:id/delete", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const p = db().prepare("SELECT id,title FROM posts WHERE id = ?").get(intOr(ctx.params.id, -1)) as Row | undefined;
    if (p) { db().prepare("DELETE FROM posts WHERE id = ?").run(p.id); audit(ctx.user, "publicacao_excluida", `#${p.id} ${p.title}`); }
    setFlash(ctx, "ok", "Publicação excluída.");
    ctx.redirect("/admin/posts");
  });

  /* ---------- documentos ---------- */
  r.get("/admin/documentos", (ctx) => {
    if (!requireUser(ctx)) return;
    page(ctx, "Documentos", <A.DocumentsAdmin docs={db().prepare("SELECT * FROM documents ORDER BY created_at DESC").all()} csrf={ctx.csrf} user={ctx.user!} />);
  });

  r.post("/admin/documentos/upload", (ctx) => {
    if (!requireUser(ctx)) return;
    const title = str(ctx.fields.title, 160);
    const category = ["estatuto", "comunicado", "regulamento", "arquivo"].includes(ctx.fields.category) ? ctx.fields.category : "arquivo";
    const status = ctx.fields.status === "rascunho" ? "rascunho" : "publicado";
    const file = ctx.files.find((x) => x.field === "file");
    try {
      if (!title) throw new UploadError("Informe o título do documento.");
      if (!file) throw new UploadError("Selecione um arquivo.");
      const saved = saveUpload(file.data, file.filename, ["document", "image"]);
      db().prepare("INSERT INTO documents (title,description,category,filename,original_name,mime,size,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(title, str(ctx.fields.description, 300), category, saved.filename, saved.original, saved.mime, saved.size, status, now());
      audit(ctx.user, "documento_enviado", `${title} (${category})`);
      setFlash(ctx, "ok", "Documento enviado.");
    } catch (e) {
      if (!(e instanceof UploadError)) throw e;
      setFlash(ctx, "err", e.message);
    }
    ctx.redirect("/admin/documentos");
  });

  r.post("/admin/documentos/:id/status", (ctx) => {
    if (!requireUser(ctx)) return;
    const status = ctx.fields.status === "publicado" ? "publicado" : "rascunho";
    db().prepare("UPDATE documents SET status = ? WHERE id = ?").run(status, intOr(ctx.params.id, -1));
    audit(ctx.user, "documento_status", `#${ctx.params.id} → ${status}`);
    setFlash(ctx, "ok", "Situação atualizada.");
    ctx.redirect("/admin/documentos");
  });

  r.post("/admin/documentos/:id/delete", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const d = db().prepare("SELECT * FROM documents WHERE id = ?").get(intOr(ctx.params.id, -1)) as Row | undefined;
    if (d) {
      db().prepare("DELETE FROM documents WHERE id = ?").run(d.id);
      removeFile("documents", d.filename);
      audit(ctx.user, "documento_excluido", d.title);
    }
    setFlash(ctx, "ok", "Documento excluído.");
    ctx.redirect("/admin/documentos");
  });

  /* ---------- imagens ---------- */
  r.get("/admin/imagens", (ctx) => {
    if (!requireUser(ctx)) return;
    page(ctx, "Imagens", <A.MediaAdmin items={db().prepare("SELECT * FROM media ORDER BY id DESC").all()} csrf={ctx.csrf} user={ctx.user!} logoId={getSettings().logo_media_id} />);
  });

  r.post("/admin/imagens/upload", (ctx) => {
    if (!requireUser(ctx)) return;
    const file = ctx.files.find((x) => x.field === "file");
    try {
      if (!file) throw new UploadError("Selecione uma imagem.");
      const saved = saveUpload(file.data, file.filename, ["image"]);
      db().prepare("INSERT INTO media (filename,original_name,alt,mime,size,created_at) VALUES (?,?,?,?,?,?)")
        .run(saved.filename, saved.original, str(ctx.fields.alt, 200), saved.mime, saved.size, now());
      audit(ctx.user, "imagem_enviada", saved.original);
      setFlash(ctx, "ok", "Imagem enviada.");
    } catch (e) {
      if (!(e instanceof UploadError)) throw e;
      setFlash(ctx, "err", e.message);
    }
    ctx.redirect("/admin/imagens");
  });

  r.post("/admin/imagens/:id/logo", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const m = db().prepare("SELECT id, original_name FROM media WHERE id = ?").get(intOr(ctx.params.id, -1)) as Row | undefined;
    if (m) { setSetting("logo_media_id", String(m.id)); audit(ctx.user, "simbolo_definido", m.original_name); setFlash(ctx, "ok", "Símbolo atualizado."); }
    ctx.redirect("/admin/imagens");
  });

  r.post("/admin/imagens/:id/delete", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const m = db().prepare("SELECT * FROM media WHERE id = ?").get(intOr(ctx.params.id, -1)) as Row | undefined;
    if (m) {
      db().prepare("DELETE FROM media WHERE id = ?").run(m.id);
      if (getSettings().logo_media_id === String(m.id)) setSetting("logo_media_id", "");
      removeFile("images", m.filename);
      audit(ctx.user, "imagem_excluida", m.original_name);
    }
    setFlash(ctx, "ok", "Imagem excluída.");
    ctx.redirect("/admin/imagens");
  });

  /* ---------- princípios ---------- */
  r.get("/admin/principios", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    page(ctx, "Princípios e diretrizes", <A.PrinciplesAdmin items={db().prepare("SELECT * FROM principles ORDER BY position, id").all()} csrf={ctx.csrf} />);
  });
  r.post("/admin/principios/:id", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const id = intOr(ctx.params.id, -1);
    const p = db().prepare("SELECT title FROM principles WHERE id = ?").get(id) as Row | undefined;
    if (!p) throw new HttpError(404, "Princípio não encontrado.");
    db().prepare("UPDATE principles SET body = ? WHERE id = ?").run(str(ctx.fields.body, 8000), id);
    audit(ctx.user, "principio_editado", p.title);
    setFlash(ctx, "ok", `“${p.title}” salvo.`);
    ctx.redirect("/admin/principios");
  });

  /* ---------- organização (dirigentes) ---------- */
  r.get("/admin/membros", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    page(ctx, "Dirigentes e representantes", <A.MembersAdmin members={db().prepare("SELECT * FROM members ORDER BY position, id").all()} images={db().prepare("SELECT id, original_name FROM media ORDER BY id DESC").all()} csrf={ctx.csrf} />);
  });
  r.post("/admin/membros/save", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const f = ctx.fields;
    const name = str(f.name, 120), role = str(f.role, 120);
    const consent = f.publish_consent === "1" ? 1 : 0;
    const visible = f.visible === "1" ? 1 : 0;
    if (!name || !role) { setFlash(ctx, "err", "Nome e cargo são obrigatórios."); return ctx.redirect("/admin/membros"); }
    if (visible && !consent) { setFlash(ctx, "err", "Para exibir no site, marque a autorização da pessoa."); return ctx.redirect("/admin/membros"); }
    const photo = f.photo_media_id ? intOr(f.photo_media_id, 0) : null;
    const vals = [name, role, str(f.bio, 600), photo && db().prepare("SELECT 1 FROM media WHERE id=?").get(photo) ? photo : null, Math.max(0, Math.min(999, intOr(f.position, 0))), visible, consent] as (string | number | null)[];
    if (f.id) {
      db().prepare("UPDATE members SET name=?, role=?, bio=?, photo_media_id=?, position=?, visible=?, publish_consent=? WHERE id=?").run(...vals, intOr(f.id, -1));
    } else {
      db().prepare("INSERT INTO members (name, role, bio, photo_media_id, position, visible, publish_consent) VALUES (?,?,?,?,?,?,?)").run(...vals);
    }
    audit(ctx.user, "membro_salvo", `${name} (${role})`);
    setFlash(ctx, "ok", "Salvo.");
    ctx.redirect("/admin/membros");
  });
  r.post("/admin/membros/:id/delete", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const m = db().prepare("SELECT name FROM members WHERE id = ?").get(intOr(ctx.params.id, -1)) as Row | undefined;
    if (m) { db().prepare("DELETE FROM members WHERE id = ?").run(intOr(ctx.params.id, -1)); audit(ctx.user, "membro_removido", m.name); }
    setFlash(ctx, "ok", "Removido.");
    ctx.redirect("/admin/membros");
  });

  /* ---------- textos do site ---------- */
  r.get("/admin/site", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    page(ctx, "Textos do site", <A.SiteAdmin s={getSettings()} csrf={ctx.csrf} />);
  });
  r.post("/admin/site", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const d = db();
    const email = str(ctx.fields.contact_email, 200);
    if (email && !isEmail(email)) { setFlash(ctx, "err", "E-mail público inválido."); return ctx.redirect("/admin/site"); }
    d.exec("BEGIN");
    try {
      for (const g of A.SITE_FIELDS) for (const [k, , type] of g.fields) {
        if (ctx.fields[k] === undefined) continue;
        setSetting(k, str(ctx.fields[k], type === "area" ? 8000 : 200), d);
      }
      d.exec("COMMIT");
    } catch (e) { d.exec("ROLLBACK"); throw e; }
    audit(ctx.user, "site_atualizado");
    setFlash(ctx, "ok", "Textos salvos.");
    ctx.redirect("/admin/site");
  });

  /* ---------- redes e links ---------- */
  r.get("/admin/links", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    page(ctx, "Links e redes", <A.LinksAdmin links={db().prepare("SELECT * FROM social_links ORDER BY position, id").all()} csrf={ctx.csrf} />);
  });
  r.post("/admin/links", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const links = db().prepare("SELECT id, label FROM social_links").all() as Row[];
    const updates: [string, number][] = [];
    for (const l of links) {
      const v = str(ctx.fields[`url_${l.id}`], 300);
      if (v && !/^https?:\/\//i.test(v)) { setFlash(ctx, "err", `Endereço inválido em ${l.label}: use https://...`); return ctx.redirect("/admin/links"); }
      if (v && !safeUrl(v)) { setFlash(ctx, "err", `Endereço inválido em ${l.label}.`); return ctx.redirect("/admin/links"); }
      updates.push([v, l.id]);
    }
    const st = db().prepare("UPDATE social_links SET url = ? WHERE id = ?");
    for (const [u, id] of updates) st.run(u, id);
    audit(ctx.user, "links_atualizados");
    setFlash(ctx, "ok", "Links salvos.");
    ctx.redirect("/admin/links");
  });

  /* ---------- mensagens ---------- */
  r.get("/admin/mensagens", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    page(ctx, "Mensagens recebidas", <A.MessagesAdmin messages={db().prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT 200").all()} csrf={ctx.csrf} />);
  });
  r.post("/admin/mensagens/:id/lida", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    db().prepare("UPDATE messages SET is_read = 1 WHERE id = ?").run(intOr(ctx.params.id, -1));
    ctx.redirect("/admin/mensagens");
  });
  r.post("/admin/mensagens/:id/delete", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    db().prepare("DELETE FROM messages WHERE id = ?").run(intOr(ctx.params.id, -1));
    audit(ctx.user, "mensagem_excluida", `#${ctx.params.id}`);
    setFlash(ctx, "ok", "Mensagem excluída.");
    ctx.redirect("/admin/mensagens");
  });

  /* ---------- usuários e conta ---------- */
  r.get("/admin/usuarios", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    page(ctx, "Usuários", <A.UsersAdmin users={db().prepare("SELECT id,name,email,role,active,last_login FROM users ORDER BY id").all()} csrf={ctx.csrf} me={ctx.user!} />);
  });
  r.post("/admin/usuarios/new", async (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const f = ctx.fields;
    const name = str(f.name, 100), email = str(f.email, 160).toLowerCase();
    const role = f.role === "admin" ? "admin" : "editor";
    const problem = !name ? "Informe o nome." : !isEmail(email) ? "E-mail inválido." : passwordProblem(f.password ?? "");
    if (problem) { setFlash(ctx, "err", problem); return ctx.redirect("/admin/usuarios"); }
    if (db().prepare("SELECT 1 FROM users WHERE email = ?").get(email)) { setFlash(ctx, "err", "Já existe um usuário com este e-mail."); return ctx.redirect("/admin/usuarios"); }
    db().prepare("INSERT INTO users (email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)").run(email, name, await hashPassword(f.password), role, now());
    audit(ctx.user, "usuario_criado", `${email} (${role})`);
    setFlash(ctx, "ok", "Usuário criado.");
    ctx.redirect("/admin/usuarios");
  });
  r.post("/admin/usuarios/:id/ativo", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    const id = intOr(ctx.params.id, -1);
    if (id === ctx.user!.id) throw new HttpError(400, "Você não pode desativar a própria conta.");
    const active = ctx.fields.active === "1" ? 1 : 0;
    db().prepare("UPDATE users SET active = ? WHERE id = ?").run(active, id);
    if (!active) db().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    audit(ctx.user, active ? "usuario_reativado" : "usuario_desativado", `#${id}`);
    setFlash(ctx, "ok", "Usuário atualizado.");
    ctx.redirect("/admin/usuarios");
  });
  r.get("/admin/conta", (ctx) => {
    if (!requireUser(ctx)) return;
    page(ctx, "Minha conta", <A.Account csrf={ctx.csrf} />);
  });
  r.post("/admin/conta", async (ctx) => {
    if (!requireUser(ctx)) return;
    const f = ctx.fields;
    const row = db().prepare("SELECT password_hash FROM users WHERE id = ?").get(ctx.user!.id) as Row;
    const problem = !(await verifyPassword(f.current ?? "", row.password_hash)) ? "Senha atual incorreta."
      : f.next !== f.again ? "As novas senhas não conferem." : passwordProblem(f.next ?? "");
    if (problem) { setFlash(ctx, "err", problem); return ctx.redirect("/admin/conta"); }
    db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(f.next), ctx.user!.id);
    endOtherSessions(ctx.user!.id, ctx.sessionId);
    audit(ctx.user, "senha_alterada");
    setFlash(ctx, "ok", "Senha alterada.");
    ctx.redirect("/admin/conta");
  });

  /* ---------- atividade ---------- */
  r.get("/admin/atividade", (ctx) => {
    if (!requireUser(ctx, "admin")) return;
    page(ctx, "Registro de atividade", <A.AuditAdmin rows={db().prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200").all()} />);
  });
}
