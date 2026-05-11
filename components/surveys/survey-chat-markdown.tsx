"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";

const markdownComponents: Components = {
  h1: ({ node: _node, ...props }) => (
    <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground first:mt-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h4 className="mt-3 text-[15px] font-semibold text-foreground first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h5 className="mt-3 text-sm font-semibold text-foreground first:mt-0" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h6 className="mt-2 text-sm font-medium text-foreground first:mt-0" {...props} />
  ),
  p: ({ node: _node, ...props }) => <p className="my-2 text-[15px] leading-relaxed text-foreground first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-foreground marker:text-muted-foreground" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-[15px] leading-relaxed text-foreground marker:text-muted-foreground" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="pl-0.5 [&>p]:my-1" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  hr: ({ node: _node, ...props }) => <hr className="my-4 border-border/60" {...props} />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-2 border-l-2 border-primary/35 pl-3 text-[15px] text-secondary italic" {...props} />
  ),
  a: ({ node: _node, ...props }) => (
    <a
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  code: ({ node: _node, className: codeClassName, ...props }) => {
    const inline = typeof codeClassName !== "string" || !codeClassName.includes("language-");
    if (inline) {
      return (
        <code
          className="rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[13px] text-foreground"
          {...props}
        />
      );
    }
    return <code className={cn(codeClassName, "font-mono text-[13px]")} {...props} />;
  },
  pre: ({ node: _node, ...props }) => (
    <pre className="scrollbar-subtle my-2 overflow-x-auto rounded-xl border border-border/60 bg-muted/50 p-3 text-[13px] leading-snug [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0" {...props} />
  ),
};

/** Renders Markdown for assistant chat messages (no HTML; safe default from react-markdown). */
export function SurveyChatMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("[&_*]:break-words", className)}>
      <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
}
