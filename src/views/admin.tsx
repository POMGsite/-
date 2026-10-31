import type { ReactNode } from "react";
import type { Row } from "../server/db.ts";
import type { User } from "../server/http.ts";
import { fmtSize } from "./layout.tsx";

const dt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
export const fmtDT = (u: number) => dt.format(new Date(u * 1000));

export type Flash = { kind: "ok" | "err"; text: string } | null;

export function AdminShell({ title, user, csrf, flash, siteName, unread, children }: {
  title: string; user: User | null; csrf: string; flash: Flash; siteName: string; unread?: number; children: ReactNode;
}) {
  const items: [string, string, boolean][] = [
    ["/admin", "Painel", false],
    ["/admin/posts", "Publicações", false],
    ["/admin/documentos", "Documentos", false],
    ["/admin/imagens", "Imagens", false],
    ["/admin/principios", "Princípios", true],
    ["/admin/membros", "Organização", true],
    ["/admin/site", "Textos do site", true],
    ["/admin/links", "Links e redes", true],
    ["/admin/mensagens", `Mensagens${unread ? ` (${unread})` : ""}`, true],
    ["/admin/usuarios", "Usuários", true],
    ["/admin/atividade", "Atividade", true],
  ];
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{`${title} · Painel · ${siteName}`}</title>
        <link rel="stylesheet" href="/css/admin.css" />
        <script src="/js/admin.js" defer></script>
      </head>
      <body className="admin">
        {user ? (
          <div className="shell">
            <aside className="side">
              <p className="side-brand">{siteName}<span>Painel administrativo</span></p>
              <nav aria-label="Painel">
                <ul>
                  {items.filter(([, , adminOnly]) => !adminOnly || user.role === "admin").map(([href, label]) => <li key={href}><a href={href}>{label}</a></li>)}
                </ul>
              </nav>
              <div className="side-foot">
                <p>{user.name}<br /><small>{user.role === "admin" ? "Administrador" : "Editor"}</small></p>
                <p><a href="/admin/conta">Minha conta</a> · <a href="/" target="_blank" rel="noopener">Ver site</a></p>
                <form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value={csrf} /><button className="btn-line" type="submit">Sair</button></form>
              </div>
            </aside>
            <main className="panel" id="conteudo">
              <h1>{title}</h1>
              {flash ? <p className={`flash flash-${flash.kind}`} role={flash.kind === "err" ? "alert" : "status"}>{flash.text}</p> : null}
              {children}
            </main>
          </div>
        ) : (
          <main className="login-wrap">{flash ? <p className={`flash flash-${flash.kind}`} role="alert">{flash.text}</p> : null}{children}</main>
        )}
      </body>
    </html>
  );
}

export const Csrf = ({ token }: { token: string }) => <input type="hidden" name="_csrf" value={token} />;

export function Login({ error, siteName }: { error?: string; siteName: string }) {
  return (
    <AdminShell title="Entrar" user={null} csrf="" siteName={siteName} flash={error ? { kind: "err", text: error } : null}>
      <form method="post" action="/admin/login" className="login-card">
        <h1>Painel · {siteName}</h1>
        <label>E-mail<input name="email" type="email" required autoComplete="username" autoFocus /></label>
        <label>Senha<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="btn-solid" type="submit">Entrar</button>
        <p className="hint">Acesso restrito à equipe autorizada.</p>
      </form>
    </AdminShell>
  );
}

export function Dashboard({ counts, recent }: { counts: Record<string, number>; recent: Row[] }) {
  const cards: [string, number, string][] = [
    ["Publicações", counts.posts, "/admin/posts"], ["Rascunhos", counts.drafts, "/admin/posts"],
    ["Documentos", counts.docs, "/admin/documentos"], ["Imagens", counts.media, "/admin/imagens"],
    ["Mensagens novas", counts.unread, "/admin/mensagens"],
  ];
  return (
    <>
      <ul className="stats">{cards.map(([l, n, h]) => <li key={l}><a href={h}><strong>{n}</strong><span>{l}</span></a></li>)}</ul>
      <h2>Pendências de conteúdo</h2>
      <p className="hint">O site mostra “a informar” onde ainda não há texto aprovado. Preencha em <a href="/admin/site">Textos do site</a>, <a href="/admin/principios">Princípios</a>, <a href="/admin/links">Links e redes</a>.</p>
      <h2>Últimas publicações</h2>
      {recent.length ? <table><thead><tr><th>Título</th><th>Situação</th><th>Atualizado</th></tr></thead><tbody>
        {recent.map((p) => <tr key={p.id}><td><a href={`/admin/posts/${p.id}`}>{p.title}</a></td><td>{p.status}</td><td>{fmtDT(p.updated_at)}</td></tr>)}
      </tbody></table> : <p className="hint">Nenhuma publicação criada.</p>}
    </>
  );
}

export function PostList({ posts, user }: { posts: Row[]; user: User }) {
  return (
    <>
      <p><a className="btn-solid" href="/admin/posts/new">Nova publicação</a></p>
      <table>
        <thead><tr><th>Título</th><th>Tipo</th><th>Situação</th><th>Atualizado</th></tr></thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id}>
              <td><a href={`/admin/posts/${p.id}`}>{p.title}</a></td><td>{p.kind}</td>
              <td><span className={`pill pill-${p.status}`}>{p.status}</span></td><td>{fmtDT(p.updated_at)}</td>
            </tr>
          ))}
          {!posts.length ? <tr><td colSpan={4} className="hint">Nenhuma publicação.</td></tr> : null}
        </tbody>
      </table>
      {user.role !== "admin" ? <p className="hint">Editores criam e editam publicações. Apenas administradores excluem.</p> : null}
    </>
  );
}

export function PostForm({ post, categories, images, csrf, user, error }: { post: Row | null; categories: Row[]; images: Row[]; csrf: string; user: User; error?: string }) {
  const p = post ?? { kind: "noticia", status: "rascunho", title: "", excerpt: "", body: "" };
  return (
    <>
      {error ? <p className="flash flash-err" role="alert">{error}</p> : null}
      <form method="post" action="/admin/posts/save" className="admin-form">
        <Csrf token={csrf} />
        {post ? <input type="hidden" name="id" value={post.id} /> : null}
        <label>Título<input name="title" required maxLength={180} defaultValue={p.title} /></label>
        <div className="row">
          <label>Tipo<select name="kind" defaultValue={p.kind}><option value="noticia">Notícia</option><option value="comunicado">Comunicado oficial</option><option value="artigo">Artigo</option></select></label>
          <label>Categoria<select name="category_id" defaultValue={p.category_id ?? ""}><option value="">Sem categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Situação<select name="status" defaultValue={p.status}><option value="rascunho">Rascunho (não aparece no site)</option><option value="publicado">Publicado</option></select></label>
        </div>
        <label>Resumo (até 300 caracteres)<textarea name="excerpt" rows={2} maxLength={300} defaultValue={p.excerpt}></textarea></label>
        <label>Imagem de capa<select name="cover_media_id" defaultValue={p.cover_media_id ?? ""}><option value="">Sem imagem</option>{images.map((m) => <option key={m.id} value={m.id}>{m.original_name}</option>)}</select></label>
        <label>Texto<textarea name="body" rows={16} required defaultValue={p.body}></textarea></label>
        <p className="hint">Formatação: <code>## Título</code>, <code>### Subtítulo</code>, <code>- item</code>, <code>&gt; citação</code>, <code>**negrito**</code>, <code>*itálico*</code>, <code>[texto](https://link)</code>. Separe parágrafos com uma linha em branco.</p>
        <div className="actions"><button className="btn-solid" type="submit">Salvar</button>{post && p.status === "publicado" ? <a className="btn-line" href={`/noticias/${p.slug}`} target="_blank" rel="noopener">Ver no site</a> : null}</div>
      </form>
      {post && user.role === "admin" ? (
        <form method="post" action={`/admin/posts/${post.id}/delete`} data-confirm="Excluir esta publicação definitivamente?" className="danger-zone">
          <Csrf token={csrf} /><button className="btn-danger" type="submit">Excluir publicação</button>
        </form>
      ) : null}
    </>
  );
}

const DOC_CATS: [string, string][] = [["estatuto", "Estatuto"], ["comunicado", "Comunicado"], ["regulamento", "Regulamento"], ["arquivo", "Arquivo institucional"]];

export function DocumentsAdmin({ docs, csrf, user }: { docs: Row[]; csrf: string; user: User }) {
  return (
    <>
      <h2>Enviar documento</h2>
      <form method="post" action="/admin/documentos/upload" encType="multipart/form-data" className="admin-form">
        <Csrf token={csrf} />
        <label>Título<input name="title" required maxLength={160} /></label>
        <label>Descrição (opcional)<input name="description" maxLength={300} /></label>
        <div className="row">
          <label>Categoria<select name="category">{DOC_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Situação<select name="status"><option value="publicado">Publicado</option><option value="rascunho">Rascunho</option></select></label>
        </div>
        <label>Arquivo (PDF, JPG, PNG ou WEBP — até 10 MB)<input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
        <button className="btn-solid" type="submit">Enviar</button>
      </form>
      <h2>Documentos</h2>
      <table>
        <thead><tr><th>Título</th><th>Categoria</th><th>Arquivo</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.title}</td><td>{d.category}</td><td>{d.original_name} · {fmtSize(d.size)}</td>
              <td><form method="post" action={`/admin/documentos/${d.id}/status`}><Csrf token={csrf} /><input type="hidden" name="status" value={d.status === "publicado" ? "rascunho" : "publicado"} /><button className="btn-line" type="submit">{d.status === "publicado" ? "Despublicar" : "Publicar"}</button></form></td>
              <td>{user.role === "admin" ? <form method="post" action={`/admin/documentos/${d.id}/delete`} data-confirm="Excluir este documento?"><Csrf token={csrf} /><button className="btn-danger" type="submit">Excluir</button></form> : null}</td>
            </tr>
          ))}
          {!docs.length ? <tr><td colSpan={5} className="hint">Nenhum documento.</td></tr> : null}
        </tbody>
      </table>
    </>
  );
}

export function MediaAdmin({ items, csrf, user, logoId }: { items: Row[]; csrf: string; user: User; logoId: string }) {
  return (
    <>
      <h2>Enviar imagem</h2>
      <form method="post" action="/admin/imagens/upload" encType="multipart/form-data" className="admin-form">
        <Csrf token={csrf} />
        <label>Arquivo (JPG, PNG ou WEBP — até 10 MB)<input type="file" name="file" required accept="image/jpeg,image/png,image/webp" /></label>
        <label>Texto alternativo (descreva a imagem para leitores de tela)<input name="alt" maxLength={200} /></label>
        <button className="btn-solid" type="submit">Enviar</button>
        <p className="hint">Envie só imagens que o partido tenha direito de usar. O símbolo oficial deve ser enviado aqui e então marcado como “Usar como símbolo”.</p>
      </form>
      <h2>Biblioteca</h2>
      <ul className="gallery">
        {items.map((m) => (
          <li key={m.id}>
            <img src={`/media/${m.filename}`} alt={m.alt} width="160" height="120" loading="lazy" />
            <p><strong>{m.original_name}</strong><br /><small>{fmtSize(m.size)}{String(m.id) === logoId ? " · símbolo atual" : ""}</small></p>
            {user.role === "admin" ? (
              <div className="actions">
                {String(m.id) !== logoId ? <form method="post" action={`/admin/imagens/${m.id}/logo`}><Csrf token={csrf} /><button className="btn-line" type="submit">Usar como símbolo</button></form> : null}
                <form method="post" action={`/admin/imagens/${m.id}/delete`} data-confirm="Excluir esta imagem?"><Csrf token={csrf} /><button className="btn-danger" type="submit">Excluir</button></form>
              </div>
            ) : null}
          </li>
        ))}
        {!items.length ? <li className="hint">Nenhuma imagem.</li> : null}
      </ul>
    </>
  );
}

export function PrinciplesAdmin({ items, csrf }: { items: Row[]; csrf: string }) {
  return (
    <>
      <p className="hint">Publique apenas textos aprovados pela direção. Enquanto vazio, o site exibe “a informar”.</p>
      {items.map((p) => (
        <form key={p.id} method="post" action={`/admin/principios/${p.id}`} className="admin-form card-form">
          <Csrf token={csrf} />
          <h2>{p.title}</h2>
          <label>Texto<textarea name="body" rows={6} defaultValue={p.body}></textarea></label>
          <button className="btn-solid" type="submit">Salvar “{p.title}”</button>
        </form>
      ))}
    </>
  );
}

export function MembersAdmin({ members, images, csrf }: { members: Row[]; images: Row[]; csrf: string }) {
  const form = (m: Row | null) => (
    <form key={m?.id ?? "new"} method="post" action="/admin/membros/save" className="admin-form card-form">
      <Csrf token={csrf} />
      {m ? <input type="hidden" name="id" value={m.id} /> : null}
      <h2>{m ? m.name : "Adicionar dirigente ou representante"}</h2>
      <div className="row">
        <label>Nome<input name="name" required maxLength={120} defaultValue={m?.name ?? ""} /></label>
        <label>Cargo ou função<input name="role" required maxLength={120} defaultValue={m?.role ?? ""} /></label>
      </div>
      <label>Apresentação (opcional)<textarea name="bio" rows={3} maxLength={600} defaultValue={m?.bio ?? ""}></textarea></label>
      <div className="row">
        <label>Foto (opcional)<select name="photo_media_id" defaultValue={m?.photo_media_id ?? ""}><option value="">Sem foto</option>{images.map((i) => <option key={i.id} value={i.id}>{i.original_name}</option>)}</select></label>
        <label>Ordem<input name="position" type="number" min="0" max="999" defaultValue={m?.position ?? 0} /></label>
      </div>
      <label className="check"><input type="checkbox" name="publish_consent" value="1" defaultChecked={!!m?.publish_consent} /><span>Esta pessoa autorizou expressamente a publicação do nome, cargo e foto (LGPD).</span></label>
      <label className="check"><input type="checkbox" name="visible" value="1" defaultChecked={!!m?.visible} /><span>Exibir no site (só aparece se a autorização estiver marcada)</span></label>
      <div className="actions">
        <button className="btn-solid" type="submit">Salvar</button>
      </div>
    </form>
  );
  return (
    <>
      {members.map((m) => (
        <div key={m.id}>
          {form(m)}
          <form method="post" action={`/admin/membros/${m.id}/delete`} data-confirm="Remover esta pessoa?" className="danger-zone"><Csrf token={csrf} /><button className="btn-danger" type="submit">Remover {m.name}</button></form>
        </div>
      ))}
      {form(null)}
    </>
  );
}

export const SITE_FIELDS: { section: string; fields: [string, string, "text" | "area", string?][] }[] = [
  { section: "Identidade", fields: [
    ["site_name", "Nome curto", "text"], ["site_short", "Sigla", "text"], ["site_full_name", "Nome completo", "text"],
    ["tagline", "Lema / valores", "text"], ["founded_year", "Ano de início", "text"], ["base_city", "Base (cidade — UF)", "text"],
  ] },
  { section: "Página inicial", fields: [["home_intro", "Apresentação institucional", "area"]] },
  { section: "Sobre", fields: [
    ["about_history", "História do partido", "area"], ["about_foundation", "Fundação e trajetória", "area"],
    ["about_origin", "Origem em Minas Gerais", "area"], ["about_identity", "Identidade e organização institucional", "area"],
  ] },
  { section: "Organização", fields: [["org_structure", "Estrutura organizacional", "area"], ["org_info", "Informações institucionais", "area"]] },
  { section: "Contato", fields: [
    ["contact_email", "E-mail público", "text"], ["contact_phone", "Telefone", "text"], ["contact_address", "Endereço", "text"], ["contact_hours", "Horário de atendimento", "text"],
  ] },
  { section: "Privacidade (LGPD)", fields: [
    ["privacy_controller", "Controlador dos dados (identificação)", "area"], ["privacy_contact", "Canal para assuntos de privacidade", "text"],
  ] },
];

export function SiteAdmin({ s, csrf }: { s: Record<string, string>; csrf: string }) {
  return (
    <form method="post" action="/admin/site" className="admin-form">
      <Csrf token={csrf} />
      <p className="hint">Campos vazios aparecem no site como “a informar”. Não escreva nada que a direção não tenha aprovado.</p>
      {SITE_FIELDS.map((g) => (
        <fieldset key={g.section}>
          <legend>{g.section}</legend>
          {g.fields.map(([k, label, type]) => type === "area"
            ? <label key={k}>{label}<textarea name={k} rows={6} defaultValue={s[k] ?? ""}></textarea></label>
            : <label key={k}>{label}<input name={k} maxLength={200} defaultValue={s[k] ?? ""} /></label>)}
        </fieldset>
      ))}
      <button className="btn-solid" type="submit">Salvar tudo</button>
    </form>
  );
}

export function LinksAdmin({ links, csrf }: { links: Row[]; csrf: string }) {
  return (
    <form method="post" action="/admin/links" className="admin-form">
      <Csrf token={csrf} />
      <p className="hint">Informe o endereço completo (começando por https://). Redes sem endereço não aparecem no site.</p>
      {links.map((l) => <label key={l.id}>{l.label}<input name={`url_${l.id}`} type="url" maxLength={300} placeholder="https://" defaultValue={l.url} /></label>)}
      <button className="btn-solid" type="submit">Salvar links</button>
    </form>
  );
}

export function MessagesAdmin({ messages, csrf }: { messages: Row[]; csrf: string }) {
  return (
    <>
      <p className="hint">Mensagens são apagadas automaticamente após 12 meses.</p>
      <ul className="messages">
        {messages.map((m) => (
          <li key={m.id} className={m.is_read ? "" : "unread"}>
            <p className="meta"><strong>{m.subject}</strong> · {m.name} &lt;{m.email}&gt; · {fmtDT(m.created_at)}</p>
            <p className="msg-body">{m.body}</p>
            <div className="actions">
              <a className="btn-line" href={`mailto:${m.email}?subject=${encodeURIComponent("Re: " + m.subject)}`}>Responder por e-mail</a>
              {!m.is_read ? <form method="post" action={`/admin/mensagens/${m.id}/lida`}><Csrf token={csrf} /><button className="btn-line" type="submit">Marcar como lida</button></form> : null}
              <form method="post" action={`/admin/mensagens/${m.id}/delete`} data-confirm="Excluir esta mensagem?"><Csrf token={csrf} /><button className="btn-danger" type="submit">Excluir</button></form>
            </div>
          </li>
        ))}
        {!messages.length ? <li className="hint">Nenhuma mensagem.</li> : null}
      </ul>
    </>
  );
}

export function UsersAdmin({ users, csrf, me }: { users: Row[]; csrf: string; me: User }) {
  return (
    <>
      <h2>Novo usuário</h2>
      <form method="post" action="/admin/usuarios/new" className="admin-form">
        <Csrf token={csrf} />
        <div className="row">
          <label>Nome<input name="name" required maxLength={100} /></label>
          <label>E-mail<input name="email" type="email" required maxLength={160} autoComplete="off" /></label>
        </div>
        <div className="row">
          <label>Papel<select name="role"><option value="editor">Editor (publicações, documentos, imagens)</option><option value="admin">Administrador (tudo)</option></select></label>
          <label>Senha inicial (mín. 12, com letras e números)<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
        </div>
        <button className="btn-solid" type="submit">Criar usuário</button>
      </form>
      <h2>Usuários</h2>
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Último acesso</th><th>Situação</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.last_login ? fmtDT(u.last_login) : "—"}</td>
              <td>{u.id === me.id ? "você" : (
                <form method="post" action={`/admin/usuarios/${u.id}/ativo`}><Csrf token={csrf} /><input type="hidden" name="active" value={u.active ? "0" : "1"} /><button className="btn-line" type="submit">{u.active ? "Desativar" : "Reativar"}</button></form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Account({ csrf }: { csrf: string }) {
  return (
    <form method="post" action="/admin/conta" className="admin-form narrow">
      <Csrf token={csrf} />
      <label>Senha atual<input name="current" type="password" required autoComplete="current-password" /></label>
      <label>Nova senha (mín. 12, com letras e números)<input name="next" type="password" required minLength={12} autoComplete="new-password" /></label>
      <label>Repita a nova senha<input name="again" type="password" required minLength={12} autoComplete="new-password" /></label>
      <button className="btn-solid" type="submit">Trocar senha</button>
      <p className="hint">Ao trocar a senha, os outros acessos abertos são encerrados.</p>
    </form>
  );
}

export function AuditAdmin({ rows }: { rows: Row[] }) {
  return (
    <table>
      <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDT(r.created_at)}</td><td>{r.user_email ?? "—"}</td><td>{r.action}</td><td>{r.detail}</td></tr>)}</tbody>
    </table>
  );
}
