"use client";

import * as React from "react";

function isProbablyHtml(text: string) {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

function sanitizeRichHtml(input: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(input, "text/html");
  const allowed = new Set([
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "a",
    "div",
    "span",
  ]);
  const blocked = new Set(["script", "style", "iframe", "object", "embed", "meta", "link"]);

  const nodes = Array.from(doc.body.querySelectorAll("*"));
  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();
    if (blocked.has(tag)) {
      node.remove();
      continue;
    }
    if (!allowed.has(tag)) {
      node.replaceWith(...Array.from(node.childNodes));
      continue;
    }

    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (name === "style") {
        const style = node.getAttribute("style") ?? "";
        const alignMatch = style.match(/text-align\s*:\s*(left|center|right)\s*;?/i);
        if (alignMatch) {
          node.setAttribute("style", `text-align: ${alignMatch[1].toLowerCase()};`);
        } else {
          node.removeAttribute("style");
        }
        continue;
      }
      if (tag !== "a") {
        if (name === "align") {
          const align = (attr.value ?? "").toLowerCase().trim();
          if (align === "left" || align === "center" || align === "right") {
            node.setAttribute("style", `text-align: ${align};`);
          }
          node.removeAttribute(attr.name);
          continue;
        }
        node.removeAttribute(attr.name);
        continue;
      }
      if (!["href", "target", "rel"].includes(name)) {
        node.removeAttribute(attr.name);
      }
    }

    if (tag === "a") {
      const href = node.getAttribute("href") ?? "";
      if (!/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) {
        node.removeAttribute("href");
      }
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer");
    }
  }

  return doc.body.innerHTML;
}

function renderInline(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const token = match[0];
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`b_${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`i_${key++}`}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        nodes.push(
          <a
            key={`a_${key++}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {label}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = start + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function FormattedInfoText({ text }: { text: string }) {
  if (isProbablyHtml(text)) {
    const safeHtml = sanitizeRichHtml(text);
    return (
      <div
        className="grid gap-2 text-sm text-secondary [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_ol]:list-decimal [&_ol]:list-inside [&_p]:mb-2 [&_ul]:list-disc [&_ul]:list-inside"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let listKind: "ul" | "ol" | null = null;

  function flushList() {
    if (!listKind || listBuffer.length === 0) return;
    const items = listBuffer.map((item, idx) => <li key={`li_${idx}`}>{renderInline(item)}</li>);
    if (listKind === "ul") {
      nodes.push(
        <ul key={`ul_${nodes.length}`} className="list-disc space-y-1 pl-5">
          {items}
        </ul>,
      );
    } else {
      nodes.push(
        <ol key={`ol_${nodes.length}`} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>,
      );
    }
    listBuffer = [];
    listKind = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const bullet = line.match(/^\s*-\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);

    if (bullet) {
      if (listKind && listKind !== "ul") flushList();
      listKind = "ul";
      listBuffer.push(bullet[1]);
      continue;
    }
    if (ordered) {
      if (listKind && listKind !== "ol") flushList();
      listKind = "ol";
      listBuffer.push(ordered[1]);
      continue;
    }

    flushList();

    if (!line.trim()) {
      nodes.push(<div key={`sp_${nodes.length}`} className="h-2" />);
      continue;
    }

    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      nodes.push(
        <h3 key={`h_${nodes.length}`} className="text-sm font-semibold text-primary">
          {renderInline(heading[1])}
        </h3>,
      );
      continue;
    }

    nodes.push(
      <p key={`p_${nodes.length}`} className="text-sm text-secondary">
        {renderInline(line)}
      </p>,
    );
  }
  flushList();

  return <div className="grid gap-2">{nodes}</div>;
}

