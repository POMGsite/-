import { Layout, PageHero, Pending, PostCard, TriangleMotif, fmtDate, fmtSize, isoDate, type Site } from "./layout.tsx";
import { RichText } from "./richtext.tsx";
import type { Row } from "../server/db.ts";
import { siteMode } from "./mode.ts";

const has = (s?: string) => Boolean(s && s.trim());

export function Home({ site, posts, principles }: { site: Site; posts: Row[]; principles: Row[] }) {
  const s = site.s;
  const socials = site.socials.filter((x) => x.url);
  return (
    <Layout site={site} current="/" seo={{ title: s.site_full_name, path: "/", description: has(s.home_intro) ? s.home_intro.slice(0, 160) : `${s.site_full_name} (${s.site_short}). ${s.tagline}.` }}>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{s.base_city ? `${s.base_city}${has(s.founded_year) ? ` · desde ${s.founded_year}` : ""}` : "Minas Gerais"}</p>
            <h1>{s.site_name}<span className="h1-sub">de Minas Gerais</span></h1>
            <p className="tagline">{s.tagline}</p>
            {has(s.home_intro) ? <div className="lead"><RichText text={s.home_intro} /></div> : <Pending>Texto de apresentação institucional a ser fornecido e aprovado pela direção.</Pending>}
            <div className="actions">
              <a className="btn btn-primary" href="/sobre">Conheça o partido</a>
              <a className="btn btn-ghost" href="/noticias">Notícias e comunicados</a>
            </div>
          </div>
          <div className="hero-art">
            {site.logoUrl
              ? <img className="hero-logo" src={site.logoUrl} alt={`Símbolo oficial do ${s.site_full_name}`} width="320" height="320" />
              : <TriangleMotif className="hero-motif" />}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="pilares">
        <div className="wrap">
          <p className="eyebrow">Princípios</p>
          <h2 id="pilares" className="section-title">Os cinco pilares</h2>
          <ul className="pillars">
            {principles.map((p, i) => (
              <li key={p.id}>
                <a href={`/principios#${p.slug}`} className="pillar">
                  <span className="pillar-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <span className="pillar-t">{p.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section-alt" aria-labelledby="ultimas">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="eyebrow">Publicações</p>
              <h2 id="ultimas" className="section-title">Notícias e comunicados</h2>
            </div>
            <a className="link-arrow" href="/noticias">Ver todas</a>
          </div>
          {posts.length ? (
            <div className="grid grid-3">{posts.map((p) => <PostCard key={p.id} p={p as any} />)}</div>
          ) : (
            <p className="empty">Ainda não há publicações. Os comunicados oficiais aparecerão aqui assim que forem publicados.</p>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="redes">
        <div className="wrap split">
          <div>
            <p className="eyebrow">Redes sociais</p>
            <h2 id="redes" className="section-title">Canais oficiais</h2>
            <p>Acompanhe o partido pelos perfis oficiais.</p>
          </div>
          <div>
            {socials.length ? (
              <ul className="social-list">
                {socials.map((x) => <li key={x.network}><a className="btn btn-ghost" href={x.url} target="_blank" rel="noopener noreferrer me">{x.label}<span className="sr-only"> (abre em nova aba)</span></a></li>)}
              </ul>
            ) : <Pending>Links dos perfis oficiais a serem informados pela direção.</Pending>}
          </div>
        </div>
      </section>
    </Layout>
  );
}

export function About({ site, docs }: { site: Site; docs: Row[] }) {
  const s = site.s;
  const blocks: [string, string, string][] = [
    ["historia", "História do partido", s.about_history],
    ["fundacao", "Fundação e trajetória", s.about_foundation],
    ["origem", "Origem em Minas Gerais", s.about_origin],
    ["identidade", "Identidade e organização institucional", s.about_identity],
  ];
  return (
    <Layout site={site} current="/sobre" seo={{ title: "Sobre", path: "/sobre", description: `História, fundação e identidade do ${s.site_full_name}.` }}>
      <PageHero eyebrow="Sobre" title={`O ${s.site_name}`} lead={s.site_full_name} />
      <div className="wrap content-narrow">
        {(has(s.founded_year) || has(s.base_city)) ? (
          <dl className="facts">
            {has(s.founded_year) ? <div><dt>Atuação desde</dt><dd>{s.founded_year}</dd></div> : null}
            {has(s.base_city) ? <div><dt>Base</dt><dd>{s.base_city}</dd></div> : null}
            <div><dt>Sigla</dt><dd>{s.site_short}</dd></div>
          </dl>
        ) : null}
        {blocks.map(([id, title, body]) => (
          <section key={id} id={id} className="block">
            <h2>{title}</h2>
            {has(body) ? <RichText text={body} /> : <Pending />}
          </section>
        ))}
        <section id="documentos" className="block">
          <h2>Documentos oficiais</h2>
          {docs.length ? (
            <ul className="doc-list">{docs.map((d) => <DocItem key={d.id} d={d} />)}</ul>
          ) : <p className="empty">Nenhum documento oficial publicado ainda.</p>}
          <p><a className="link-arrow" href="/documentos">Todos os documentos</a></p>
        </section>
      </div>
    </Layout>
  );
}

export function DocItem({ d }: { d: Row }) {
  return (
    <li className="doc">
      <div>
        <h3>{d.title}</h3>
        {d.description ? <p>{d.description}</p> : null}
        <p className="meta"><time dateTime={isoDate(d.created_at)}>{fmtDate(d.created_at)}</time><span>{d.mime === "application/pdf" ? "PDF" : "Imagem"} · {fmtSize(d.size)}</span></p>
      </div>
      <a className="btn btn-ghost" href={`/documentos/arquivo/${d.id}`}>Baixar<span className="sr-only">: {d.title}</span></a>
    </li>
  );
}

export function Principles({ site, principles }: { site: Site; principles: Row[] }) {
  return (
    <Layout site={site} current="/principios" seo={{ title: "Princípios e diretrizes", path: "/principios", description: "Cultura, trabalho, desenvolvimento, tradição e nacionalismo: os princípios institucionais do partido." }}>
      <PageHero eyebrow="Princípios e diretrizes" title="O que orienta o partido" lead="Os textos desta página só são publicados depois de aprovados pela direção." />
      <div className="wrap content-narrow">
        {principles.map((p, i) => (
          <section key={p.id} id={p.slug} className="principle">
            <span className="principle-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h2>{p.title}</h2>
              {has(p.body) ? <RichText text={p.body} /> : <Pending />}
            </div>
          </section>
        ))}
      </div>
    </Layout>
  );
}

export function NewsList({ site, posts, categories, filter, page, pages }: { site: Site; posts: Row[]; categories: Row[]; filter: { kind?: string; cat?: string }; page: number; pages: number }) {
  const qs = (o: { kind?: string; cat?: string; page?: number }) => {
    const p = new URLSearchParams();
    if (o.kind) p.set("tipo", o.kind);
    if (o.cat) p.set("categoria", o.cat);
    if (o.page && o.page > 1) p.set("pagina", String(o.page));
    const q = p.toString();
    return "/noticias" + (q ? `?${q}` : "");
  };
  const kinds: [string, string][] = [["", "Todas"], ["noticia", "Notícias"], ["comunicado", "Comunicados"], ["artigo", "Artigos"]];
  return (
    <Layout site={site} current="/noticias" seo={{ title: "Notícias e comunicados", path: "/noticias", description: `Publicações institucionais, comunicados oficiais e artigos do ${site.s.site_full_name}.` }}>
      <PageHero eyebrow="Notícias" title="Publicações e comunicados" lead="Publicações institucionais, comunicados oficiais, artigos e atualizações." />
      <div className="wrap">
        <nav className="filters" aria-label="Filtrar publicações">
          <ul>
            {kinds.map(([k, label]) => (
              <li key={k}><a href={qs({ kind: k, cat: filter.cat })} aria-current={(filter.kind ?? "") === k ? "true" : undefined}>{label}</a></li>
            ))}
          </ul>
          <ul>
            <li><a href={qs({ kind: filter.kind })} aria-current={!filter.cat ? "true" : undefined}>Todas as categorias</a></li>
            {categories.map((c) => (
              <li key={c.id}><a href={qs({ kind: filter.kind, cat: c.slug })} aria-current={filter.cat === c.slug ? "true" : undefined}>{c.name}</a></li>
            ))}
          </ul>
        </nav>
        {posts.length ? (
          <div className="grid grid-3">{posts.map((p) => <PostCard key={p.id} p={p as any} />)}</div>
        ) : <p className="empty">Nenhuma publicação encontrada.</p>}
        {pages > 1 ? (
          <nav className="pager" aria-label="Paginação">
            {page > 1 ? <a href={qs({ ...filter, page: page - 1 })} rel="prev">Anterior</a> : <span />}
            <span>Página {page} de {pages}</span>
            {page < pages ? <a href={qs({ ...filter, page: page + 1 })} rel="next">Próxima</a> : <span />}
          </nav>
        ) : null}
      </div>
    </Layout>
  );
}

export function NewsPost({ site, post, related }: { site: Site; post: Row; related: Row[] }) {
  const kindLabel = post.kind === "comunicado" ? "Comunicado oficial" : post.kind === "artigo" ? "Artigo" : "Notícia";
  const desc = (post.excerpt || post.body.replace(/[#*>\[\]()-]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 160);
  return (
    <Layout site={site} current="/noticias" seo={{ title: post.title, path: `/noticias/${post.slug}`, description: desc, type: "article", image: post.cover_filename ? `/media/${post.cover_filename}` : null }}>
      <article>
        <header className="page-hero article-hero">
          <div className="wrap content-narrow">
            <p className="eyebrow">{kindLabel}{post.category_name ? ` · ${post.category_name}` : ""}</p>
            <h1>{post.title}</h1>
            <p className="meta"><time dateTime={isoDate(post.published_at)}>{fmtDate(post.published_at)}</time>{post.author_name ? <span>Por {post.author_name}</span> : null}</p>
          </div>
        </header>
        <div className="wrap content-narrow">
          {post.cover_filename ? <figure className="cover"><img src={`/media/${post.cover_filename}`} alt={post.cover_alt || ""} width="960" height="540" /></figure> : null}
          <RichText text={post.body} />
          <p className="back"><a className="link-arrow" href="/noticias">Voltar às publicações</a></p>
        </div>
      </article>
      {related.length ? (
        <section className="section section-alt">
          <div className="wrap">
            <h2 className="section-title">Leia também</h2>
            <div className="grid grid-3">{related.map((p) => <PostCard key={p.id} p={p as any} />)}</div>
          </div>
        </section>
      ) : null}
    </Layout>
  );
}

export function Organization({ site, members }: { site: Site; members: Row[] }) {
  const s = site.s;
  return (
    <Layout site={site} current="/organizacao" seo={{ title: "Organização", path: "/organizacao", description: `Estrutura organizacional, dirigentes e informações institucionais do ${s.site_full_name}.` }}>
      <PageHero eyebrow="Organização" title="Estrutura e representantes" />
      <div className="wrap content-narrow">
        <section className="block">
          <h2>Estrutura organizacional</h2>
          {has(s.org_structure) ? <RichText text={s.org_structure} /> : <Pending />}
        </section>
        <section className="block">
          <h2>Dirigentes e representantes</h2>
          {members.length ? (
            <ul className="members">
              {members.map((m) => (
                <li key={m.id} className="member">
                  {m.photo_filename ? <img src={`/media/${m.photo_filename}`} alt={`Foto de ${m.name}`} width="96" height="96" loading="lazy" /> : <span className="member-ph" aria-hidden="true"></span>}
                  <div><h3>{m.name}</h3><p className="member-role">{m.role}</p>{m.bio ? <p>{m.bio}</p> : null}</div>
                </li>
              ))}
            </ul>
          ) : <Pending>Nomes e cargos só são publicados com autorização de cada pessoa e aprovação da direção.</Pending>}
        </section>
        <section className="block">
          <h2>Informações institucionais</h2>
          {has(s.org_info) ? <RichText text={s.org_info} /> : <Pending />}
        </section>
      </div>
    </Layout>
  );
}

export type ContactState = { ok?: boolean; error?: string; values?: Record<string, string>; token: string };

export function Contact({ site, state }: { site: Site; state: ContactState }) {
  const s = site.s;
  const v = state.values ?? {};
  const socials = site.socials.filter((x) => x.url);
  const hasInfo = has(s.contact_email) || has(s.contact_phone) || has(s.contact_address) || has(s.contact_hours);
  return (
    <Layout site={site} current="/contato" seo={{ title: "Contato", path: "/contato", description: `Fale com o ${s.site_full_name}.` }}>
      <PageHero eyebrow="Contato" title="Fale com o partido" />
      <div className="wrap contact-grid">
        {siteMode.static ? (
          <section aria-labelledby="form-title">
            <h2 id="form-title">Como falar com o partido</h2>
            <p>Este site não possui formulário de contato. Use os canais oficiais indicados ao lado.</p>
            {has(s.contact_email) ? <p><a className="btn btn-primary" href={`mailto:${s.contact_email}`}>Enviar e-mail</a></p> : null}
          </section>
        ) : (
        <section aria-labelledby="form-title">
          <h2 id="form-title">Envie uma mensagem</h2>
          {state.ok ? <p className="notice notice-ok" role="status">Mensagem enviada. Obrigado pelo contato.</p> : null}
          {state.error ? <p className="notice notice-err" role="alert">{state.error}</p> : null}
          <form method="post" action="/contato" className="form" noValidate>
            <input type="hidden" name="t" value={state.token} />
            <div className="hp" aria-hidden="true">
              <label>Não preencha este campo<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <label>Nome<input name="name" required maxLength={120} autoComplete="name" defaultValue={v.name ?? ""} /></label>
            <label>E-mail<input name="email" type="email" required maxLength={160} autoComplete="email" defaultValue={v.email ?? ""} /></label>
            <label>Assunto<input name="subject" required maxLength={160} defaultValue={v.subject ?? ""} /></label>
            <label>Mensagem<textarea name="message" required rows={6} maxLength={4000} defaultValue={v.message ?? ""}></textarea></label>
            <label className="check">
              <input type="checkbox" name="consent" value="1" required />
              <span>Li e concordo com o uso dos meus dados para responder esta mensagem, conforme a <a href="/privacidade">Política de Privacidade</a>.</span>
            </label>
            <button className="btn btn-primary" type="submit">Enviar mensagem</button>
          </form>
        </section>
        )}
        <aside aria-labelledby="info-title">
          <h2 id="info-title">Informações</h2>
          {hasInfo ? (
            <dl className="info">
              {has(s.contact_email) ? <><dt>E-mail</dt><dd><a href={`mailto:${s.contact_email}`}>{s.contact_email}</a></dd></> : null}
              {has(s.contact_phone) ? <><dt>Telefone</dt><dd>{s.contact_phone}</dd></> : null}
              {has(s.contact_address) ? <><dt>Endereço</dt><dd>{s.contact_address}</dd></> : null}
              {has(s.contact_hours) ? <><dt>Atendimento</dt><dd>{s.contact_hours}</dd></> : null}
            </dl>
          ) : <Pending>Dados de contato a serem informados pela direção.</Pending>}
          <h3>Redes oficiais</h3>
          {socials.length ? <ul className="social-list">{socials.map((x) => <li key={x.network}><a href={x.url} target="_blank" rel="noopener noreferrer me">{x.label}<span className="sr-only"> (abre em nova aba)</span></a></li>)}</ul> : <Pending>Links oficiais a informar.</Pending>}
        </aside>
      </div>
    </Layout>
  );
}

const DOC_GROUPS: [string, string][] = [["estatuto", "Estatuto"], ["comunicado", "Comunicados"], ["regulamento", "Regulamentos"], ["arquivo", "Arquivos institucionais"]];

export function Documents({ site, docs }: { site: Site; docs: Row[] }) {
  return (
    <Layout site={site} current="/documentos" seo={{ title: "Documentos", path: "/documentos", description: `Documentos oficiais do ${site.s.site_full_name}: estatuto, comunicados, regulamentos e arquivos institucionais.` }}>
      <PageHero eyebrow="Documentos" title="Documentos oficiais" lead="Estatuto, comunicados, regulamentos e arquivos institucionais." />
      <div className="wrap content-narrow">
        {DOC_GROUPS.map(([key, label]) => {
          const list = docs.filter((d) => d.category === key);
          return (
            <section key={key} className="block" id={key}>
              <h2>{label}</h2>
              {list.length ? <ul className="doc-list">{list.map((d) => <DocItem key={d.id} d={d} />)}</ul> : <p className="empty">Nenhum documento publicado nesta categoria.</p>}
            </section>
          );
        })}
      </div>
    </Layout>
  );
}

export function Privacy({ site }: { site: Site }) {
  if (siteMode.static) return <PrivacyStatic site={site} />;
  return <PrivacyServer site={site} />;
}

function PrivacyStatic({ site }: { site: Site }) {
  const s = site.s;
  return (
    <Layout site={site} current="/privacidade" seo={{ title: "Política de Privacidade", path: "/privacidade", description: "Como este site trata dados pessoais, em conformidade com a LGPD (Lei nº 13.709/2018)." }}>
      <PageHero eyebrow="LGPD" title="Política de Privacidade" lead="Este site tem finalidade institucional e informativa e não coleta dados pessoais por conta própria." />
      <div className="wrap content-narrow prose">
        <h2>Quem é o controlador dos dados</h2>
        {has(s.privacy_controller) ? <p>{s.privacy_controller}</p> : <Pending>Identificação do controlador e do encarregado (DPO), a ser informada pela direção.</Pending>}
        {has(s.privacy_contact) ? <p>Contato para assuntos de privacidade: {s.privacy_contact}</p> : null}

        <h2>Quais dados este site coleta</h2>
        <ul>
          <li><strong>Nenhum formulário:</strong> o site não possui formulários nem cadastro e não pede dados pessoais.</li>
          <li><strong>Sem rastreamento:</strong> não usamos cookies, anúncios, mapas de calor nem ferramentas de análise de terceiros.</li>
          <li><strong>Recursos externos:</strong> o site não carrega fontes, scripts ou imagens de outros domínios.</li>
        </ul>

        <h2>Hospedagem</h2>
        <p>O site é entregue por um provedor de hospedagem de terceiros, que pode registrar dados técnicos de acesso (como endereço IP e navegador) para fins de segurança e operação, conforme a política de privacidade do próprio provedor.</p>

        <h2>Contato por e-mail ou redes sociais</h2>
        <p>Se você escrever ao partido por e-mail ou pelas redes oficiais, os dados enviados serão tratados apenas para responder à sua mensagem, e também estão sujeitos às regras do serviço usado.</p>

        <h2>Seus direitos (art. 18 da LGPD)</h2>
        <p>Você pode pedir confirmação de tratamento, acesso, correção, anonimização, eliminação dos dados e revogação do consentimento pelos canais indicados na <a href="/contato">página de contato</a>.</p>

        <h2>Informações pessoais de terceiros</h2>
        <p>Nomes, fotos e cargos de pessoas só são publicados com autorização expressa de cada uma.</p>

        <h2>Finalidade do site</h2>
        <p>O site é institucional e informativo. Não realiza propaganda eleitoral personalizada nem segmentação de público.</p>
      </div>
    </Layout>
  );
}

function PrivacyServer({ site }: { site: Site }) {
  const s = site.s;
  return (
    <Layout site={site} current="/privacidade" seo={{ title: "Política de Privacidade", path: "/privacidade", description: "Como este site trata dados pessoais, em conformidade com a LGPD (Lei nº 13.709/2018)." }}>
      <PageHero eyebrow="LGPD" title="Política de Privacidade" lead="Este site tem finalidade institucional e informativa. Coletamos o mínimo de dados possível." />
      <div className="wrap content-narrow prose">
        <h2>Quem é o controlador dos dados</h2>
        {has(s.privacy_controller) ? <p>{s.privacy_controller}</p> : <Pending>Identificação do controlador e do encarregado (DPO), a ser informada pela direção.</Pending>}
        {has(s.privacy_contact) ? <p>Contato para assuntos de privacidade: {s.privacy_contact}</p> : null}

        <h2>Quais dados coletamos</h2>
        <ul>
          <li><strong>Formulário de contato:</strong> nome, e-mail, assunto e mensagem que você digitar, mais a confirmação do seu consentimento. Finalidade: responder à sua mensagem.</li>
          <li><strong>Endereço IP:</strong> não é guardado. Armazenamos apenas um código irreversível (hash) derivado dele, usado para detectar envio abusivo.</li>
          <li><strong>Visitantes:</strong> não usamos cookies de rastreamento, anúncios, mapas de calor nem ferramentas de análise de terceiros. Visitantes não recebem cookies.</li>
          <li><strong>Equipe autorizada:</strong> quem acessa o painel recebe um cookie de sessão estritamente necessário ao login.</li>
        </ul>

        <h2>Por quanto tempo guardamos</h2>
        <p>Mensagens do formulário são apagadas automaticamente após 12 meses, ou antes, a seu pedido.</p>

        <h2>Compartilhamento</h2>
        <p>Não vendemos nem compartilhamos dados com terceiros. O site não carrega fontes, scripts ou imagens de outros domínios.</p>

        <h2>Seus direitos (art. 18 da LGPD)</h2>
        <p>Você pode pedir confirmação de tratamento, acesso, correção, anonimização, eliminação dos dados e revogação do consentimento. Use a <a href="/contato">página de contato</a>{has(s.privacy_contact) ? " ou o canal informado acima" : ""}.</p>

        <h2>Informações pessoais de terceiros</h2>
        <p>Nomes, fotos e cargos de pessoas só são publicados com autorização expressa de cada uma.</p>

        <h2>Finalidade do site</h2>
        <p>O site é institucional e informativo. Não realiza propaganda eleitoral personalizada nem segmentação de público.</p>
      </div>
    </Layout>
  );
}

export function NotFound({ site }: { site: Site }) {
  return (
    <Layout site={site} current="" seo={{ title: "Página não encontrada", path: "/404", description: "Página não encontrada.", noindex: true }}>
      <PageHero eyebrow="Erro 404" title="Página não encontrada" lead="O endereço não existe ou foi movido." />
      <div className="wrap content-narrow"><p><a className="btn btn-primary" href="/">Voltar ao início</a></p></div>
    </Layout>
  );
}
