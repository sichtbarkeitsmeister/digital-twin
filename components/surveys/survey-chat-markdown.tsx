"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/** react-markdown passes `node`; we only forward DOM props to intrinsic elements. */
function withoutNode<P extends { node?: unknown }>(props: P) {
  const { node, ...rest } = props;
  void node;
  return rest;
}

/** GFM tables need a blank line before the first row. */
function normalizeMarkdownForGfm(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const isTableRow = /^\s*\|/.test(line);
    const prev = out[out.length - 1];
    if (isTableRow && prev !== undefined && prev.trim() !== "" && !/^\s*\|/.test(prev)) {
      out.push("");
    }
    out.push(line);
  }

  return out.join("\n");
}

const markdownComponents: Components = {
  h1: (props) => (
    <h3
      className="mt-4 text-base font-semibold tracking-tight text-foreground first:mt-0"
      {...withoutNode(props)}
    />
  ),
  h2: (props) => (
    <h4 className="mt-3 text-[15px] font-semibold text-foreground first:mt-0" {...withoutNode(props)} />
  ),
  h3: (props) => (
    <h5 className="mt-3 text-sm font-semibold text-foreground first:mt-0" {...withoutNode(props)} />
  ),
  h4: (props) => (
    <h6 className="mt-2 text-sm font-medium text-foreground first:mt-0" {...withoutNode(props)} />
  ),
  p: (props) => (
    <p
      className="my-2 text-[15px] leading-relaxed text-foreground first:mt-0 last:mb-0"
      {...withoutNode(props)}
    />
  ),
  ul: (props) => (
    <ul
      className="my-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-foreground marker:text-muted-foreground"
      {...withoutNode(props)}
    />
  ),
  ol: (props) => (
    <ol
      className="my-2 list-decimal space-y-1 pl-5 text-[15px] leading-relaxed text-foreground marker:text-muted-foreground"
      {...withoutNode(props)}
    />
  ),
  li: (props) => <li className="pl-0.5 [&>p]:my-1" {...withoutNode(props)} />,
  strong: (props) => <strong className="font-semibold text-foreground" {...withoutNode(props)} />,
  em: (props) => <em className="italic" {...withoutNode(props)} />,
  hr: (props) => <hr className="my-4 border-border/60" {...withoutNode(props)} />,
  blockquote: (props) => (
    <blockquote className="my-2 border-l-2 border-primary/35 pl-3 text-[15px] text-secondary italic" {...withoutNode(props)} />
  ),
  a: (props) => (
    <a
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
      {...withoutNode(props)}
    />
  ),
  table: (props) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-border/60 bg-muted/20 shadow-sm scrollbar-subtle">
      <table className="w-full min-w-[520px] border-collapse text-[13px] leading-snug" {...withoutNode(props)} />
    </div>
  ),
  thead: (props) => (
    <thead className="bg-muted/70 text-foreground" {...withoutNode(props)} />
  ),
  tbody: (props) => (
    <tbody className="divide-y divide-border/50" {...withoutNode(props)} />
  ),
  tr: (props) => (
    <tr className="transition-colors even:bg-muted/25 hover:bg-muted/40" {...withoutNode(props)} />
  ),
  th: (props) => (
    <th
      className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-foreground"
      {...withoutNode(props)}
    />
  ),
  td: (props) => (
    <td className="px-3 py-2.5 align-top text-foreground [&>p]:my-0" {...withoutNode(props)} />
  ),
  code: (props) => {
    const { className: codeClassName, ...rest } = withoutNode(props);
    const inline = typeof codeClassName !== "string" || !codeClassName.includes("language-");
    if (inline) {
      return (
        <code
          className="rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[13px] text-foreground"
          {...rest}
        />
      );
    }
    return <code className={cn(codeClassName, "font-mono text-[13px]")} {...rest} />;
  },
  pre: (props) => (
    <pre
      className="scrollbar-subtle my-2 overflow-x-auto rounded-xl border border-border/60 bg-muted/50 p-3 text-[13px] leading-snug [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0"
      {...withoutNode(props)}
    />
  ),
};

/** Renders Markdown for assistant chat messages (no HTML; safe default from react-markdown). */
export function SurveyChatMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("[&_*]:break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {normalizeMarkdownForGfm(content)}
      </ReactMarkdown>
    </div>
  );
}
