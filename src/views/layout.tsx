import type { ReactNode } from "react";
import { config } from "../server/config.ts";
import { PENDING } from "../server/db.ts";

export type Site = {
  s: Record<string, string>;
  socials: { network: string; label: string; url: string }[];
  logoUrl: string | null;
};

export type Seo = { title: string; description: string; path: string; type?: "website" | "article"; image?: string | null; noindex?: boolean };

export const NAV = [
  { href: "/", label: "Início" },
  { href: "/sobre", label: "Sobre" },
  { href: "/principios", label: "Princípios" },
  { href: "/noticias", label: "Notícias" },
  { href: "/organizacao", label: "Organização" },
  { href: "/documentos", label: "Documentos" },
  { href: "/contato", label: "Contato" },
];

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
export const fmtDate = (unix: number) => dateFmt.format(new Date(unix * 1000));
export const isoDate = (unix: number) => new Date(unix * 1000).toISOString();
export const fmtSize = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`);

/** Padrão de triângulos concêntricos: elemento decorativo inspirado no símbolo. Não é o símbolo oficial. */
export function TriangleMotif({ className = "" }: { className?: string }) {
  // Triângulos concêntricos (escala em torno do centroide).
  const base: [number, number][] = [[200, 30], [20, 330], [380, 330]];
  const c: [number, number] = [200, 230];
  const rings = [1, 0.82, 0.64, 0.46, 0.3, 0.16];
  return (
    <svg className={`motif ${className}`} viewBox="0 0 400 360" aria-hidden="true" focusable="false">
      {rings.map((k, i) => (
        <polygon
          key={i}
          className={`motif-ring r${i}`}
          points={base.map(([x, y]) => `${(c[0] + (x - c[0]) * k).toFixed(1)},${(c[1] + (y - c[1]) * k).toFixed(1)}`).join(" ")}
        />
      ))}
    </svg>
  );
}

export function Pending({ children }: { children?: ReactNode }) {
  return (
    <div className="pending" role="note">
      <span className="pending-tag">A informar</span>
      <p>{children ?? PENDING}</p>
    </div>
  );
}

export function PageHero({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <header className="page-hero">
      <div className="wrap">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
      <TriangleMotif className="page-hero-motif" />
    </header>
  );
}

function Brand({ site }: { site: Site }) {
  return (
    <a className="brand" href="/" aria-label={`${site.s.site_name} — página inicial`}>
      {site.logoUrl ? (
        <img className="brand-logo" src={site.logoUrl} alt="" width="44" height="44" />
      ) : null}
      <span className="brand-text">
        <span className="brand-name">{site.s.site_name}</span>
        <span className="brand-sigla">{site.s.site_short}</span>
      </span>
    </a>
  );
}

export function Layout({ site, seo, current, children }: { site: Site; seo: Seo; current: string; children: ReactNode }) {
  const url = config.siteUrl ? config.siteUrl + seo.path : null;
  const fullTitle = seo.path === "/" ? `${site.s.site_name} · ${site.s.site_short}` : `${seo.title} · ${site.s.site_short}`;
  const image = seo.image ? (config.siteUrl ? config.siteUrl + seo.image : seo.image) : null;
  const sameAs = site.socials.filter((x) => x.url).map((x) => x.url);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.s.site_full_name,
    alternateName: site.s.site_short,
    ...(config.siteUrl ? { url: config.siteUrl } : {}),
    ...(site.logoUrl && config.siteUrl ? { logo: config.siteUrl + site.logoUrl } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(site.s.contact_email ? { email: site.s.contact_email } : {}),
  };
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        <meta name="description" content={seo.description} />
        <meta name="theme-color" content="#06122b" />
        {seo.noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
        {url ? <link rel="canonical" href={url} /> : null}
        <meta property="og:site_name" content={site.s.site_full_name} />
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:type" content={seo.type ?? "website"} />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={seo.description} />
        {url ? <meta property="og:url" content={url} /> : null}
        {image ? <meta property="og:image" content={image} /> : null}
        <meta name="twitter:card" content={image ? "summary_large_image" : "summary"} />
        <link rel="stylesheet" href="/css/site.css" />
        <script src="/js/site.js" defer></script>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      </head>
      <body>
        <a className="skip" href="#conteudo">Ir para o conteúdo</a>
        <header className="site-header">
          <div className="wrap header-row">
            <Brand site={site} />
            <button className="nav-toggle" type="button" aria-expanded="false" aria-controls="menu" data-nav-toggle>
              <span className="sr-only">Abrir menu</span>
              <span className="bars" aria-hidden="true"></span>
            </button>
            <nav id="menu" className="nav" aria-label="Principal">
              <ul>
                {NAV.map((n) => (
                  <li key={n.href}>
                    <a href={n.href} aria-current={current === n.href ? "page" : undefined}>{n.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>
        <main id="conteudo" tabIndex={-1}>{children}</main>
        <Footer site={site} />
      </body>
    </html>
  );
}

function Footer({ site }: { site: Site }) {
  const socials = site.socials.filter((x) => x.url);
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <p className="footer-title">{site.s.site_full_name}</p>
          <p className="footer-muted">{site.s.tagline}</p>
          {site.s.base_city ? <p className="footer-muted">{site.s.base_city}</p> : null}
        </div>
        <nav aria-label="Rodapé">
          <p className="footer-title">Navegação</p>
          <ul className="footer-list">
            {NAV.map((n) => <li key={n.href}><a href={n.href}>{n.label}</a></li>)}
            <li><a href="/privacidade">Privacidade e LGPD</a></li>
          </ul>
        </nav>
        <div>
          <p className="footer-title">Redes oficiais</p>
          {socials.length ? (
            <ul className="footer-list">
              {socials.map((x) => <li key={x.network}><a href={x.url} rel="noopener noreferrer me" target="_blank">{x.label}<span className="sr-only"> (abre em nova aba)</span></a></li>)}
            </ul>
          ) : <p className="footer-muted">Links oficiais a serem informados pela direção.</p>}
        </div>
      </div>
      <div className="wrap footer-base">
        <p>© {new Date().getFullYear()} {site.s.site_full_name}. Site de caráter institucional e informativo.</p>
      </div>
    </footer>
  );
}

export function PostCard({ p }: { p: { slug: string; title: string; excerpt: string; kind: string; category_name: string | null; published_at: number; cover_filename?: string | null; cover_alt?: string | null } }) {
  const kindLabel = p.kind === "comunicado" ? "Comunicado" : p.kind === "artigo" ? "Artigo" : "Notícia";
  return (
    <article className="card post-card">
      {p.cover_filename ? (
        <a href={`/noticias/${p.slug}`} className="card-media" tabIndex={-1} aria-hidden="true">
          <img src={`/media/${p.cover_filename}`} alt="" loading="lazy" width="640" height="360" />
        </a>
      ) : null}
      <div className="card-body">
        <p className="meta"><span className="chip">{kindLabel}</span>{p.category_name ? <span className="meta-cat">{p.category_name}</span> : null}<time dateTime={isoDate(p.published_at)}>{fmtDate(p.published_at)}</time></p>
        <h3><a href={`/noticias/${p.slug}`}>{p.title}</a></h3>
        {p.excerpt ? <p>{p.excerpt}</p> : null}
      </div>
    </article>
  );
}
