import type { ReactNode } from "react";

/**
 * Formatação simples e segura para textos editados no painel:
 *  ## Título · ### Subtítulo · - item de lista · > citação · **negrito** · *itálico* · [texto](https://link)
 * Tudo é convertido em elementos React (escapados) — nunca HTML cru —, então não há como injetar scripts.
 */
export function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || (u.startsWith("/") && !u.startsWith("//"))) return u;
  return null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1] !== undefined) {
      const href = safeUrl(m[2]);
      out.push(href
        ? <a key={key} href={href} rel="noopener noreferrer">{m[1]}</a>
        : m[1]);
    } else if (m[3] !== undefined) out.push(<strong key={key}>{m[3]}</strong>);
    else out.push(<em key={key}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        const lines = b.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return <ul key={key}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2), `${key}-${j}`)}</li>)}</ul>;
        }
        if (b.startsWith("### ")) return <h3 key={key}>{inline(b.slice(4), key)}</h3>;
        if (b.startsWith("## ")) return <h2 key={key}>{inline(b.slice(3), key)}</h2>;
        if (b.startsWith("> ")) return <blockquote key={key}>{inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "), key)}</blockquote>;
        return <p key={key}>{lines.flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l, `${key}-${j}`)] : inline(l, `${key}-${j}`)))}</p>;
      })}
    </div>
  );
}
