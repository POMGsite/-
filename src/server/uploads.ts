import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

export type FileKind = "image" | "document";

type Sniffed = { mime: string; ext: string; kind: FileKind };

/** O tipo é decidido pelo conteúdo do arquivo (assinatura binária), nunca pelo nome ou pelo Content-Type enviado. */
export function sniff(buf: Buffer): Sniffed | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg", kind: "image" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: ".png", kind: "image" };
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", ext: ".webp", kind: "image" };
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return { mime: "application/pdf", ext: ".pdf", kind: "document" };
  return null; // SVG, HTML, executáveis etc. são recusados de propósito
}

export type SavedFile = { filename: string; mime: string; size: number; original: string };

export function saveUpload(buf: Buffer, original: string, allow: FileKind[]): SavedFile {
  if (buf.length === 0) throw new UploadError("Nenhum arquivo foi enviado.");
  if (buf.length > config.maxUploadBytes) throw new UploadError(`Arquivo maior que ${Math.round(config.maxUploadBytes / 1048576)} MB.`);
  const type = sniff(buf);
  if (!type || !allow.includes(type.kind)) {
    throw new UploadError(allow.includes("document")
      ? "Tipo de arquivo não permitido. Envie JPG, PNG, WEBP ou PDF."
      : "Tipo de arquivo não permitido. Envie uma imagem JPG, PNG ou WEBP.");
  }
  const filename = randomBytes(16).toString("hex") + type.ext;
  const dir = path.join(config.uploadDir, type.kind === "image" ? "images" : "documents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), buf, { mode: 0o640 });
  return { filename, mime: type.mime, size: buf.length, original: cleanName(original) };
}

export function cleanName(name: string): string {
  return path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "arquivo";
}

export class UploadError extends Error {}
