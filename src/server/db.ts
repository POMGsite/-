import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

export type Row = Record<string, any>;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor')),
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_login INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'noticia' CHECK (kind IN ('noticia','comunicado','artigo')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicado')),
  cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('estatuto','comunicado','regulamento','arquivo')),
  filename TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'publicado' CHECK (status IN ('rascunho','publicado')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS principles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  photo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 0,
  publish_consent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS social_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_email TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
`;

/** Texto padrão para qualquer informação que a direção ainda não forneceu. */
export const PENDING = "Informação a ser fornecida e aprovada pela direção do partido.";

const DEFAULT_SETTINGS: Record<string, string> = {
  site_name: "Partido Operalista",
  site_short: "P.O.M.G.",
  site_full_name: "Partido Operalista de Minas Gerais",
  tagline: "Cultura · Tradição · Trabalho · Desenvolvimento · Nacionalismo",
  home_intro: "",
  base_city: "Virgem da Lapa — MG",
  founded_year: "2022",
  about_history: "",
  about_foundation: "",
  about_origin: "",
  about_identity: "",
  org_structure: "",
  org_info: "",
  contact_email: "",
  contact_phone: "",
  contact_address: "",
  contact_hours: "",
  contact_notes: "",
  privacy_controller: "",
  privacy_contact: "",
  logo_media_id: "",
};

const DEFAULT_PRINCIPLES: [string, string][] = [
  ["cultura", "Cultura"],
  ["trabalho", "Trabalho"],
  ["desenvolvimento", "Desenvolvimento"],
  ["tradicao", "Tradição"],
  ["nacionalismo", "Nacionalismo"],
];

const DEFAULT_CATEGORIES: [string, string][] = [
  ["institucional", "Institucional"],
  ["comunicados", "Comunicados oficiais"],
  ["artigos", "Artigos"],
  ["atualizacoes", "Atualizações"],
];

const DEFAULT_SOCIALS: [string, string][] = [
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["youtube", "YouTube"],
  ["blog", "Blog oficial"],
];

export function openDb(path: string = config.dbPath): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db: DatabaseSync) {
  const hasSetting = db.prepare("SELECT 1 FROM settings WHERE key = ?");
  const addSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!hasSetting.get(k)) addSetting.run(k, v);
  }
  if (!db.prepare("SELECT 1 FROM principles LIMIT 1").get()) {
    const ins = db.prepare("INSERT INTO principles (slug, title, body, position) VALUES (?,?,?,?)");
    DEFAULT_PRINCIPLES.forEach(([s, t], i) => ins.run(s, t, "", i));
  }
  if (!db.prepare("SELECT 1 FROM categories LIMIT 1").get()) {
    const ins = db.prepare("INSERT INTO categories (slug, name) VALUES (?,?)");
    for (const [s, n] of DEFAULT_CATEGORIES) ins.run(s, n);
  }
  if (!db.prepare("SELECT 1 FROM social_links LIMIT 1").get()) {
    const ins = db.prepare("INSERT INTO social_links (network, label, url, position) VALUES (?,?,?,?)");
    DEFAULT_SOCIALS.forEach(([n, l], i) => ins.run(n, l, "", i));
  }
}

let _db: DatabaseSync | null = null;
export function db(): DatabaseSync {
  return (_db ??= openDb());
}

export const now = () => Math.floor(Date.now() / 1000);

export function getSettings(d: DatabaseSync = db()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of d.prepare("SELECT key, value FROM settings").all() as Row[]) out[r.key] = r.value;
  return out;
}

export function setSetting(key: string, value: string, d: DatabaseSync = db()) {
  d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function audit(user: { id: number; email: string } | null, action: string, detail = "", d: DatabaseSync = db()) {
  d.prepare("INSERT INTO audit_log (user_id, user_email, action, detail, created_at) VALUES (?,?,?,?,?)")
    .run(user?.id ?? null, user?.email ?? null, action, detail.slice(0, 500), now());
}

export function slugify(input: string): string {
  const s = input
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return s || "publicacao";
}

export function uniqueSlug(table: "posts", base: string, ignoreId?: number, d: DatabaseSync = db()): string {
  let slug = slugify(base);
  let n = 1;
  const q = d.prepare(`SELECT id FROM ${table} WHERE slug = ?`);
  while (true) {
    const hit = q.get(slug) as Row | undefined;
    if (!hit || hit.id === ignoreId) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
}
