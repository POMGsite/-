/**
 * Gera uma versão 100% estática do site (HTML/CSS/arquivos) para hospedagem gratuita
 * como GitHub Pages, Cloudflare Pages ou Netlify.
 *
 * Como funciona: sobe o próprio site em memória, "visita" todas as páginas públicas
 * e grava o resultado em arquivos. Assim a versão estática é idêntica à do servidor.
 * Fica de fora: painel administrativo, login e formulário de contato.
 *
 * Uso: npm run export -- --site-url https://usuario.github.io/nome-do-repositorio
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { config, ROOT } from "./config.ts";
import { siteMode } from "../views/mode.ts";
import { createApp } from "./app.ts";

export type ExportOptions = { out: string; siteUrl: string; domain?: string };
export type ExportResult = { pages: number; files: number; bytes: number; withPending: string[]; out: string };

type Item = { url: string; html: boolean; body: Buffer; out: string };

const MARKER = ".pomg-export";
const EXT: Record<string, string> = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
const safeSeg = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "x";
const slug = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "arquivo";

function outPathFor(url: string, type: string, disposition: string | null): string {
  const u = new URL(url, "http://x");
  if (type.startsWith("text/html")) {
    if (u.pathname === "/") return "index.html";
    if (u.pathname === "/noticias" && u.search) {
      const seg: string[] = [];
      for (const k of ["tipo", "categoria", "pagina"]) { const v = u.searchParams.get(k); if (v) seg.push(k, safeSeg(v)); }
      return path.posix.join("noticias", ...seg, "index.html");
    }
    return path.posix.join(u.pathname.replace(/^\/|\/$/g, ""), "index.html");
  }
  const doc = /^\/documentos\/arquivo\/(\d+)$/.exec(u.pathname);
  if (doc) {
    const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "");
    const original = m ? decodeURIComponent(m[1]) : "";
    return `arquivos/${doc[1]}-${slug(path.parse(original).name)}${EXT[type] ?? ""}`;
  }
  return u.pathname.replace(/^\//, "");
}

const publicUrl = (it: Item) => (it.html ? "/" + it.out.replace(/index\.html$/, "") : "/" + it.out);

function prepareOut(out: string) {
  const abs = path.resolve(out);
  if (abs === path.parse(abs).root || abs === ROOT || abs === process.cwd() || abs === path.resolve(ROOT, "src") || abs === path.resolve(ROOT, "public")) {
    throw new Error(`Pasta de saída recusada: ${abs}`);
  }
  if (existsSync(abs)) {
    const entries = readdirSync(abs);
    if (entries.length && !entries.includes(MARKER)) {
      throw new Error(`A pasta "${abs}" já existe e não foi criada por este comando. Escolha outra com --out ou esvazie-a.`);
    }
    rmSync(abs, { recursive: true, force: true });
  }
  mkdirSync(abs, { recursive: true });
  return abs;
}

export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  if (!/^https?:\/\/[^/]+/.test(opts.siteUrl)) throw new Error("Informe --site-url com o endereço final do site, ex.: https://usuario.github.io/repositorio");
  config.siteUrl = opts.siteUrl.replace(/\/$/, "");
  const base = new URL(config.siteUrl).pathname.replace(/\/$/, "");
  siteMode.static = true;
  const out = prepareOut(opts.out);

  const server = createApp();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const seen = new Map<string, Item>();
  try {
    const queue = ["/", "/sobre", "/principios", "/noticias", "/organizacao", "/documentos", "/contato", "/privacidade", "/sitemap.xml", "/robots.txt"];
    while (queue.length) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      const res = await fetch(origin + url, { redirect: "manual" });
      if (res.status !== 200) throw new Error(`Falha ao gerar ${url} (HTTP ${res.status})`);
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      const body = Buffer.from(await res.arrayBuffer());
      const item: Item = { url, html: type.startsWith("text/html"), body, out: outPathFor(url, type, res.headers.get("content-disposition")) };
      seen.set(url, item);
      if (item.html) {
        for (const m of body.toString("utf8").matchAll(/\b(?:href|src)="(\/(?!\/)[^"#]*)/g)) {
          const next = m[1].replace(/&amp;/g, "&");
          if (!next.startsWith("/admin") && !seen.has(next)) queue.push(next);
        }
      }
    }
    // Página 404 (o GitHub Pages usa o arquivo 404.html)
    const nf = await fetch(origin + "/pagina-que-nao-existe");
    const notFoundHtml = await nf.text();

    const rewrite = (html: string) => html.replace(/\b(href|src)="(\/(?!\/)[^"]*)"/g, (_m, attr: string, val: string) => {
      const [p, hash] = val.split("#");
      const key = p.replace(/&amp;/g, "&");
      const hit = seen.get(key);
      return `${attr}="${base}${hit ? publicUrl(hit) : key}${hash ? "#" + hash : ""}"`;
    });

    let files = 0, bytes = 0, pages = 0;
    const withPending: string[] = [];
    const write = (rel: string, data: Buffer | string) => {
      const dest = path.join(out, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, data);
      files += 1; bytes += Buffer.byteLength(data);
    };
    for (const it of seen.values()) {
      if (it.html) {
        const text = it.body.toString("utf8");
        pages += 1;
        if (text.includes("pending-tag")) withPending.push(publicUrl(it));
        write(it.out, rewrite(text));
      } else write(it.out, it.body);
    }
    write("404.html", rewrite(notFoundHtml));
    write(".nojekyll", "");
    write(MARKER, "Pasta gerada por `npm run export`. Pode ser apagada e regerada.\n");
    if (opts.domain) write("CNAME", opts.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") + "\n");
    return { pages, files, bytes, withPending, out };
  } finally {
    await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const siteUrl = arg("site-url") ?? process.env.SITE_URL ?? "";
    const r = await runExport({ out: arg("out") ?? "docs", siteUrl, domain: arg("domain") });
    console.log(`Site estático gerado em ${r.out}`);
    console.log(`${r.pages} páginas, ${r.files} arquivos, ${(r.bytes / 1048576).toFixed(1)} MB.`);
    if (r.withPending.length) console.log(`Atenção: ${r.withPending.length} página(s) ainda mostram "A informar" (preencha no painel antes de publicar).`);
    process.exit(0);
  } catch (e) {
    console.error("Erro:", (e as Error).message);
    process.exit(1);
  }
}
