/**
 * Split long document text into readable pages.
 *
 * Pages break on paragraph boundaries (blank lines) where possible, falling
 * back to line boundaries, then hard character splits — so a page never cuts a
 * word and stays close to the target size.
 */
export function paginateText(text: string, targetChars = 2800): string[] {
  if (!text) return [""];
  if (text.length <= targetChars) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const pages: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) pages.push(current.replace(/\n+$/, ""));
    current = "";
  };

  for (const para of paragraphs) {
    // A single paragraph larger than a page → split it on line/char boundaries.
    if (para.length > targetChars) {
      pushCurrent();
      for (const chunk of splitChunk(para, targetChars)) pages.push(chunk);
      continue;
    }
    if (current.length + para.length + 2 > targetChars && current) {
      pushCurrent();
    }
    current += (current ? "\n\n" : "") + para;
  }
  pushCurrent();
  return pages.length ? pages : [text];
}

/**
 * Markdown-aware pagination: split into blocks (paragraphs, headings, lists,
 * tables, blockquotes) while keeping fenced code blocks (``` / ~~~) and Mermaid
 * diagrams atomic — never cut mid-block. Blocks are grouped into pages by an
 * approximate character budget.
 */
export function paginateMarkdown(md: string, targetChars = 3200): string[] {
  if (!md) return [""];
  if (md.length <= targetChars) return [md];

  const blocks = tokenizeBlocks(md);
  const pages: string[] = [];
  let current = "";

  for (const block of blocks) {
    // A single block bigger than the budget gets its own page (don't split code/tables).
    if (block.length > targetChars && current) {
      pages.push(current.trimEnd());
      current = "";
    }
    if (current.length + block.length + 2 > targetChars && current) {
      pages.push(current.trimEnd());
      current = "";
    }
    current += (current ? "\n\n" : "") + block;
  }
  if (current.trim()) pages.push(current.trimEnd());
  return pages.length ? pages : [md];
}

/** Split markdown into top-level blocks, treating fenced code as atomic. */
function tokenizeBlocks(md: string): string[] {
  const lines = md.split("\n");
  const blocks: string[] = [];
  let buf: string[] = [];
  let fence: string | null = null; // "```" or "~~~"

  const flush = () => {
    if (buf.length && buf.join("\n").trim()) blocks.push(buf.join("\n").replace(/\n+$/, ""));
    buf = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^(\s*)(```+|~~~+)/);
    if (fence) {
      buf.push(line);
      if (line.trimStart().startsWith(fence)) fence = null; // closing fence
      continue;
    }
    if (fenceMatch) {
      // opening a fence — start a fresh block so the fence stays intact
      flush();
      fence = fenceMatch[2].slice(0, 3); // ``` or ~~~
      buf.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();
  return blocks;
}

function splitChunk(text: string, targetChars: number): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  let cur = "";
  for (const line of lines) {
    if (line.length > targetChars) {
      if (cur) { out.push(cur); cur = ""; }
      for (let i = 0; i < line.length; i += targetChars) {
        out.push(line.slice(i, i + targetChars));
      }
      continue;
    }
    if (cur.length + line.length + 1 > targetChars && cur) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) out.push(cur);
  return out;
}
