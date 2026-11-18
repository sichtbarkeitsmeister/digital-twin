"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { markKundePrueftHtml } from "@/lib/dt/content/pipeline/kunde-prueft";

const SAFE_BLOCK_ID = /^[a-z0-9_-]+$/i;

/** One Abschnitt as the person left it after clicking into the text. */
export type TextFrameEdit = {
  blockId: string;
  /** The heading's text; null when the Abschnitt has none. */
  heading: string | null;
  /** The body (paragraphs, lists, emphasis); the server cleans it again. */
  html: string;
};

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The display marks a placeholder the customer is checking as „[KUNDE PRÜFT: …]“ (bold); what is
 * stored is „[BITTE PRÜFEN: …]“. An edit must save the stored form.
 */
export function restoreKundePrueft(html: string): string {
  return html.replace(
    /<strong\b[^>]*\bclass="kunde-prueft"[^>]*>\[KUNDE PRÜFT:\s*([\s\S]*?)\]<\/strong>/gi,
    (_m, inner: string) => `[BITTE PRÜFEN: ${inner.trim()}]`,
  );
}

/**
 * An edited Abschnitt (the `<section data-block-id>` element) as heading and body. The browser's
 * editor leaves loose text and `<div>` lines behind: both become paragraphs; empty ones go.
 */
export function serializeEditedSection(section: HTMLElement): { heading: string | null; html: string } {
  const clone = section.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".dt-tools").forEach((el) => el.remove()); // the hover buttons are no text
  const headingEl = clone.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");
  const heading = headingEl ? (headingEl.textContent ?? "").replace(/\s+/g, " ").trim() : null;
  headingEl?.remove();
  const parts: string[] = [];
  for (const node of Array.from(clone.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) parts.push(`<p>${escapeText(text)}</p>`);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") continue;
    if (tag === "div") {
      const inner = el.innerHTML.trim();
      if (inner && !/^(<br\s*\/?>)+$/i.test(inner)) parts.push(`<p>${inner}</p>`);
      continue;
    }
    parts.push(el.outerHTML);
  }
  const html = restoreKundePrueft(parts.join("\n")).replace(/<p>(?:\s|<br\s*\/?>)*<\/p>/gi, "");
  return { heading, html };
}

function buildSrcDoc(html: string, highlightBlockIds: string[], options: { headingLevels: boolean; editable: boolean }): string {
  const highlights = highlightBlockIds
    .filter((id) => SAFE_BLOCK_ID.test(id))
    .map((id) => `[data-block-id="${id}"]`)
    .join(",");
  // The level label is drawn, not part of the text: an edited heading never carries „[H2]“ back into the page.
  const levels = options.headingLevels
    ? "h1::before{content:'[H1] '}h2::before{content:'[H2] '}h3::before{content:'[H3] '}h4::before{content:'[H4] '}"
    : "";
  const editing = options.editable
    ? `
    [data-block-id]{cursor:text;transition:background-color .12s,border-color .12s}
    [data-block-id]:hover{background:rgba(94,234,176,.07);border-left-color:rgba(94,234,176,.55)}
    [data-block-id]:focus{outline:none;background:rgba(94,234,176,.10);border-left-color:#34d399}
    [data-block-id][contenteditable="false"]{opacity:.6;cursor:progress}
    [data-block-id]{position:relative}
    .dt-tools{position:absolute;top:-2px;right:0;display:none;gap:6px;font:600 11px/1 'Poppins',-apple-system,sans-serif;z-index:2;user-select:none}
    [data-block-id]:hover>.dt-tools,[data-block-id]:focus-within>.dt-tools{display:flex}
    .dt-tools button{all:unset;cursor:pointer;padding:5px 10px;border-radius:999px;border:1px solid rgba(46,46,80,.2);background:#fff;color:#2E2E50;box-shadow:0 1px 2px rgba(0,0,0,.06)}
    .dt-tools button:hover{background:rgba(94,234,176,.28)}
    .dt-tools button.dt-danger{color:#b91c1c;border-color:rgba(185,28,28,.3)}
    .dt-tools button.dt-danger:hover{background:rgba(254,226,226,.9)}
  `
    : "";
  const css = `
    html,body{margin:0;background:#fff;overflow:hidden}
    body{padding:28px 32px;font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2E2E50;font-size:15px;line-height:1.7}
    h1{font-size:26px;line-height:1.25;font-weight:700;margin:0 0 16px}
    h2{font-size:19px;line-height:1.35;font-weight:700;margin:28px 0 10px}
    h3{font-size:16px;font-weight:600;margin:20px 0 6px}
    h4{font-size:14px;font-weight:600;margin:16px 0 4px}
    ${levels}
    p{margin:0 0 12px}
    ul,ol{margin:0 0 12px;padding-left:22px}
    li{margin:4px 0}
    a{color:#2E2E50}
    [data-block-id]{border-left:3px solid transparent;padding:2px 0 2px 14px;margin-left:-17px;border-radius:2px}
    .kunde-prueft{font-weight:700;color:#2E2E50;background:#FDE047;padding:1px 5px;border-radius:4px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
    ${highlights ? `${highlights}{border-left-color:#F97316;background:rgba(249,115,22,.06)}` : ""}
    ${editing}
  `;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><base target="_blank"><style>${css}</style></head><body>${html}</body></html>`;
}

/**
 * Renders the service HTML isolated (no scripts) and grows to its content height.
 *
 * With `editable` the person clicks into any Abschnitt and types (heading and body). Leaving the
 * Abschnitt saves it through `onEditBlock`; Esc takes the change back, Ctrl+Enter leaves the
 * Abschnitt. Pasting takes plain text only. A refused save puts the Abschnitt back as it was.
 */
export function DtContentTextFrame(props: {
  html: string;
  title: string;
  highlightBlockIds?: string[];
  /** „[H2]“ in front of every heading (the Texte page window); display only. */
  showHeadingLevels?: boolean;
  /** Questions the customer is checking: their placeholders show as a bold, marked „[KUNDE PRÜFT: …]“. */
  kundePrueft?: readonly string[];
  /** Click into the text to change it. */
  editable?: boolean;
  onEditBlock?: (edit: TextFrameEdit) => Promise<{ ok: boolean }>;
  /** Buttons on each Abschnitt (hover): „Abschnitt darunter einfügen“ and „Löschen“ (not on the H1). */
  onAddBlock?: (afterBlockId: string) => void;
  onDeleteBlock?: (blockId: string, heading: string | null) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const highlightKey = (props.highlightBlockIds ?? []).join("|");
  const pendingKey = (props.kundePrueft ?? []).join("\n");
  const editable = Boolean(props.editable && props.onEditBlock);
  const onEditRef = useRef(props.onEditBlock);
  onEditRef.current = props.onEditBlock;
  const onAddRef = useRef(props.onAddBlock);
  onAddRef.current = props.onAddBlock;
  const onDeleteRef = useRef(props.onDeleteBlock);
  onDeleteRef.current = props.onDeleteBlock;
  const srcDoc = useMemo(
    () =>
      buildSrcDoc(
        markKundePrueftHtml(props.html, pendingKey ? pendingKey.split("\n") : [], { className: "kunde-prueft" }),
        highlightKey ? highlightKey.split("|") : [],
        { headingLevels: Boolean(props.showHeadingLevels), editable },
      ),
    [props.html, highlightKey, props.showHeadingLevels, pendingKey, editable],
  );

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    // + border: preflight makes the iframe border-box, so its 1px borders eat into the content height.
    setHeight(Math.max(240, doc.documentElement.scrollHeight + 2));
  }, []);

  const attachEditing = useCallback(
    (doc: Document) => {
      const sections = Array.from(doc.querySelectorAll<HTMLElement>("section[data-block-id]"));
      for (const [i, section] of sections.entries()) {
        section.contentEditable = "true";
        section.spellcheck = true;
        // Hover buttons; they are plain markup in the section (not text), handled by one listener below.
        if (onAddRef.current || onDeleteRef.current) {
          const tools = doc.createElement("div");
          tools.className = "dt-tools";
          tools.contentEditable = "false";
          const isH1 = i === 0 && Boolean(section.querySelector(":scope > h1"));
          const button = (action: string, label: string, danger = false) => {
            const b = doc.createElement("button");
            b.type = "button";
            b.tabIndex = -1;
            b.setAttribute("data-dt-action", action);
            b.textContent = label;
            if (danger) b.className = "dt-danger";
            return b;
          };
          if (onAddRef.current) tools.append(button("add", "+ Abschnitt darunter"));
          if (onDeleteRef.current && !isH1) tools.append(button("delete", "Löschen", true));
          section.prepend(tools);
        }
      }
      // The buttons keep the caret where it is (no focus change, so no save before the click is handled).
      doc.addEventListener("mousedown", (e) => {
        if ((e.target as Element | null)?.closest?.("[data-dt-action]")) e.preventDefault();
      });
      doc.addEventListener("click", (e) => {
        const target = (e.target as Element | null)?.closest?.("[data-dt-action]") as HTMLElement | null;
        if (!target) return;
        e.preventDefault();
        const section = target.closest("section[data-block-id]") as HTMLElement | null;
        const id = section?.getAttribute("data-block-id");
        if (!section || !id) return;
        if (target.getAttribute("data-dt-action") === "add") onAddRef.current?.(id);
        else onDeleteRef.current?.(id, (section.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4")?.textContent ?? "").trim() || null);
      });
      let current: { el: HTMLElement; snapshot: string } | null = null;

      // The frame is another document: its nodes are not `instanceof Element` of this page, so ask by shape.
      const sectionOf = (target: EventTarget | null): HTMLElement | null => {
        const node = target as Partial<Element> | null;
        return node && typeof node.closest === "function" ? (node.closest("section[data-block-id]") as HTMLElement | null) : null;
      };

      async function commit(el: HTMLElement, snapshot: string) {
        if (el.innerHTML === snapshot) return; // nothing changed
        const blockId = el.getAttribute("data-block-id") ?? "";
        const { heading, html } = serializeEditedSection(el);
        const handler = onEditRef.current;
        if (!blockId || !handler) {
          el.innerHTML = snapshot;
          return;
        }
        el.contentEditable = "false"; // no typing while it is on its way
        const res = await handler({ blockId, heading, html }).catch(() => ({ ok: false }));
        if (!res.ok && el.isConnected) {
          el.innerHTML = snapshot; // refused: the Abschnitt is as it was
          el.contentEditable = "true";
        }
        // On success the page reloads this frame with the saved text.
      }

      doc.addEventListener("focusin", (e) => {
        const el = sectionOf(e.target);
        if (!el || el.contentEditable !== "true") return;
        if (current?.el === el) return;
        current = { el, snapshot: el.innerHTML };
      });
      doc.addEventListener("focusout", (e) => {
        if (!current) return;
        const { el, snapshot } = current;
        const next = e.relatedTarget as Node | null;
        if (next && el.contains(next)) return; // still inside the Abschnitt
        current = null;
        void commit(el, snapshot);
      });
      doc.addEventListener("input", () => measure());
      doc.addEventListener("keydown", (e) => {
        if (!current) return;
        if (e.key === "Escape") {
          e.preventDefault();
          current.el.innerHTML = current.snapshot; // taken back: nothing is saved
          (doc.activeElement as HTMLElement | null)?.blur();
          measure();
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          (doc.activeElement as HTMLElement | null)?.blur();
        }
      });
      // Plain text only: pasted formatting from Word or a website would bring styles and tags along.
      doc.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (text) doc.execCommand("insertText", false, text);
      });
      doc.addEventListener("drop", (e) => e.preventDefault());
    },
    [measure],
  );

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <iframe
      ref={ref}
      title={props.title}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={() => {
        measure();
        const doc = ref.current?.contentDocument;
        if (editable && doc?.body) attachEditing(doc);
      }}
      style={{ height }}
      className="block w-full rounded-dt border border-sbkm-navy/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-white/10"
    />
  );
}
