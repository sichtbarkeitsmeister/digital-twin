/**
 * What goes onto the clipboard when a chat answer is copied. The chat draws Markdown headings one level
 * smaller (# as h3, ## as h4 …) and carries Tailwind classes, so a copy pasted into Word or Google Docs
 * came out with tiny headings and no tables. These helpers give the pasted text real heading levels,
 * visible table borders and no classes.
 */

const HEADING_SHIFT: Record<string, string> = { H3: "h1", H4: "h2", H5: "h3", H6: "h4" };

function rename(el: Element, tag: string): Element {
  const next = el.ownerDocument.createElement(tag);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.replaceWith(next);
  return next;
}

/**
 * Clean HTML for pasting from the chat's rendered DOM (a selection or a whole answer): classes, styles
 * and widgets out, the chat's shifted headings back to their Markdown level, tables with borders, links
 * kept. Works on a detached copy; the page is not touched.
 */
export function cleanChatHtml(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("button, svg, script, style, input, textarea, select, [data-no-copy]").forEach((el) => el.remove());
  for (const el of Array.from(copy.querySelectorAll("h3, h4, h5, h6"))) rename(el, HEADING_SHIFT[el.tagName]!);
  for (const el of Array.from(copy.querySelectorAll("*"))) {
    const keep = el.tagName === "A" ? el.getAttribute("href") : null;
    for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
    if (keep && /^(https?:\/\/|mailto:|tel:)/i.test(keep)) el.setAttribute("href", keep);
    if (el.tagName === "TABLE") {
      el.setAttribute("border", "1");
      el.setAttribute("cellpadding", "6");
      el.setAttribute("style", "border-collapse:collapse");
    }
    if (el.tagName === "TH" || el.tagName === "TD") el.setAttribute("style", `border:1px solid #bbb;${el.tagName === "TH" ? "text-align:left;font-weight:bold" : ""}`);
    if (el.tagName === "PRE" || el.tagName === "CODE") el.setAttribute("style", "font-family:Consolas,'Courier New',monospace");
  }
  return copy.innerHTML;
}

/**
 * The `copy` event inside a chat answer: the selection goes to the clipboard as clean HTML and as plain
 * text. Returns false (the browser copies as usual) when nothing is selected.
 */
export function handleChatCopyEvent(event: ClipboardEvent, doc: Document = document): boolean {
  const selection = doc.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return false;
  const holder = doc.createElement("div");
  for (let i = 0; i < selection.rangeCount; i++) holder.appendChild(selection.getRangeAt(i).cloneContents());
  const html = cleanChatHtml(holder);
  if (!html.trim()) return false;
  event.clipboardData.setData("text/html", html);
  event.clipboardData.setData("text/plain", selection.toString());
  event.preventDefault();
  return true;
}
