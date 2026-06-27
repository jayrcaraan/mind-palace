import { memo, useState, CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Mermaid } from "./Mermaid";
import { Check, Copy } from "lucide-react";

/**
 * Full markdown renderer: GitHub-flavored markdown (tables, task lists,
 * strikethrough, autolinks), syntax-highlighted fenced code, and Mermaid
 * diagrams (```mermaid blocks). HTML in source is NOT rendered (escaped) for
 * safety, since content can originate from agents.
 */
function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="mp-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          code: CodeRenderer as any,
          pre: ({ children }) => <>{children}</>, // <pre> handled inside CodeRenderer
          table: ({ node, ...props }) => (
            <div style={{ overflowX: "auto", margin: "12px 0" }}>
              <table {...props} />
            </div>
          ),
          img: ({ node, ...props }) => (
            <img {...props} style={{ maxWidth: "100%", borderRadius: "var(--radius-md)" }} loading="lazy" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CodeRenderer({ className, children, ...props }: any) {
  const raw = String(children ?? "").replace(/\n$/, "");
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1];
  // react-markdown v9 drops the `inline` prop: a fenced block has a language
  // class or spans multiple lines; everything else is inline code.
  const isBlock = !!match || raw.includes("\n");

  if (!isBlock) {
    return <code className="mp-inline-code" {...props}>{children}</code>;
  }
  if (lang === "mermaid") {
    return <Mermaid code={raw} />;
  }
  // Render the *highlighted* children (rehype-highlight added the spans); keep
  // the raw text only for the copy button.
  return <CodeBlock raw={raw} lang={lang} className={className}>{children}</CodeBlock>;
}

function CodeBlock({ raw, lang, className, children }: {
  raw: string; lang?: string; className?: string; children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(raw); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  return (
    <div className="mp-codeblock">
      <div className="mp-codeblock-head">
        <span className="mp-codeblock-lang">{lang || "text"}</span>
        <button onClick={copy} className="mp-codeblock-copy" title="Copy">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);

/** Convenience wrapper that fills a container. */
export function MarkdownView({ content, style }: { content: string; style?: CSSProperties }) {
  return <div style={style}><Markdown>{content}</Markdown></div>;
}
