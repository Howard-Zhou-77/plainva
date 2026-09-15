type Part = string | null | Part[];

/** Read only the bounded BODYSTRUCTURE value. Unsupported literals or malformed
 * structures stay unknown, so an attachment filter cannot invent completeness. */
export function bodyStructureAttachments(response: string): boolean | undefined {
  const start = /\bBODYSTRUCTURE\s+/i.exec(response);
  if (!start) return undefined;
  const text = response.slice(start.index + start[0].length);
  if (text.length > 65_536) return undefined;
  let at = 0; let count = 0;
  const read = (depth = 0): Part => {
    if (depth > 24 || ++count > 8192) throw new Error("Body structure limit");
    while (/\s/.test(text[at] ?? "") && at < text.length) at++;
    if (text[at] === "(") {
      at++; const list: Part[] = [];
      for (;;) {
        while (/\s/.test(text[at] ?? "") && at < text.length) at++;
        if (text[at] === ")") { at++; return list; }
        if (at >= text.length) throw new Error("Incomplete body structure");
        list.push(read(depth + 1));
      }
    }
    if (text[at] === '"') {
      at++; let value = "";
      while (at < text.length) {
        const char = text[at++];
        if (char === '"') return value;
        value += char === "\\" ? text[at++] ?? "" : char;
      }
      throw new Error("Incomplete string");
    }
    // Protocol atoms exclude every ASCII control byte.
    // eslint-disable-next-line no-control-regex
    const atom = /^[^\s(){}\x00-\x1f]+/.exec(text.slice(at))?.[0];
    if (!atom) throw new Error("Unsupported body structure");
    at += atom.length; return /^NIL$/i.test(atom) ? null : atom;
  };
  const named = (params: Part | undefined) => Array.isArray(params) && params.some((value, index) => index % 2 === 0 && typeof value === "string" && /^(?:name|filename)(?:\*\d*\*?)?$/i.test(value) && !!params[index + 1]);
  const hasFile = (part: Part): boolean => {
    if (!Array.isArray(part) || !part.length) throw new Error("Invalid MIME part");
    let children = 0;
    while (Array.isArray(part[children])) children++;
    if (children) {
      if (typeof part[children] !== "string") throw new Error("Missing multipart subtype");
      const results = part.slice(0, children).map(hasFile);
      return results.some(Boolean);
    }
    if (part.length < 7 || typeof part[0] !== "string" || typeof part[1] !== "string") throw new Error("Incomplete MIME part");
    const message = part[0].toUpperCase() === "MESSAGE" && part[1].toUpperCase() === "RFC822";
    const disposition = part[part[0].toUpperCase() === "TEXT" ? 9 : message ? 11 : 8];
    const own = named(part[2]) || (Array.isArray(disposition) && (typeof disposition[0] === "string" && disposition[0].toUpperCase() === "ATTACHMENT" || named(disposition[1])));
    return own || (message && part[8] !== undefined ? hasFile(part[8]) : false);
  };
  try { return hasFile(read()); } catch { return undefined; }
}
