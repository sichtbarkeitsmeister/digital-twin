"use client";

import * as React from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Unlink as UnlinkIcon,
  Underline,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
};

function isProbablyHtml(text: string) {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

function toEditorHtml(storedHtml: string) {
  if (!isProbablyHtml(storedHtml)) return storedHtml;
  const parser = new DOMParser();
  const doc = parser.parseFromString(storedHtml, "text/html");
  const links = Array.from(doc.body.querySelectorAll("a"));
  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    if (href) {
      link.setAttribute("data-editor-href", href);
    }
    link.removeAttribute("href");
    link.removeAttribute("title");
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer");
  }
  return doc.body.innerHTML;
}

function toStoredHtml(editorHtml: string) {
  if (!isProbablyHtml(editorHtml)) return editorHtml;
  const parser = new DOMParser();
  const doc = parser.parseFromString(editorHtml, "text/html");
  const links = Array.from(doc.body.querySelectorAll("a"));
  for (const link of links) {
    const dataHref = link.getAttribute("data-editor-href") ?? "";
    if (dataHref && /^(https?:\/\/|mailto:|tel:|#)/i.test(dataHref)) {
      link.setAttribute("href", dataHref);
    } else {
      link.removeAttribute("href");
    }
    link.removeAttribute("data-editor-href");
    link.removeAttribute("title");
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer");
  }
  return doc.body.innerHTML;
}

export function RichTextEditor({ value, onChange, disabled = false, className }: Props) {
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const savedRangeRef = React.useRef<Range | null>(null);
  const [hoveredHref, setHoveredHref] = React.useState<string | null>(null);
  const [hoverPos, setHoverPos] = React.useState<{ x: number; y: number } | null>(null);
  const [isBold, setIsBold] = React.useState(false);
  const [isItalic, setIsItalic] = React.useState(false);
  const [isUnderline, setIsUnderline] = React.useState(false);
  const [isUnorderedList, setIsUnorderedList] = React.useState(false);
  const [isOrderedList, setIsOrderedList] = React.useState(false);
  const [currentBlock, setCurrentBlock] = React.useState("");
  const [hasLinkSelection, setHasLinkSelection] = React.useState(false);
  const [currentAlign, setCurrentAlign] = React.useState<"left" | "center" | "right">("left");

  React.useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const nextEditorHtml = toEditorHtml(value);
    if (el.innerHTML === nextEditorHtml) return;

    if (!isProbablyHtml(value)) {
      // Keep legacy plain text/markdown content readable when opening old drafts.
      el.textContent = value;
      return;
    }
    el.innerHTML = nextEditorHtml;
  }, [value]);

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    const links = Array.from(el.querySelectorAll("a"));
    for (const link of links) {
      const href = link.getAttribute("data-editor-href") ?? "";
      if (!/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) {
        link.removeAttribute("data-editor-href");
      }
      link.removeAttribute("title");
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer");
    }
    onChange(toStoredHtml(el.innerHTML));
  }

  function updateActiveStates() {
    try {
      setIsBold(document.queryCommandState("bold"));
      setIsItalic(document.queryCommandState("italic"));
      setIsUnderline(document.queryCommandState("underline"));
      setIsUnorderedList(document.queryCommandState("insertUnorderedList"));
      setIsOrderedList(document.queryCommandState("insertOrderedList"));
      setCurrentBlock(getCurrentBlockTag());
      setHasLinkSelection(Boolean(getCurrentLinkElement()));
      if (document.queryCommandState("justifyCenter")) setCurrentAlign("center");
      else if (document.queryCommandState("justifyRight")) setCurrentAlign("right");
      else setCurrentAlign("left");
    } catch {
      setIsBold(false);
      setIsItalic(false);
      setIsUnderline(false);
      setIsUnorderedList(false);
      setIsOrderedList(false);
      setCurrentBlock("");
      setHasLinkSelection(false);
      setCurrentAlign("left");
    }
  }

  function getCurrentBlockTag() {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    if (!anchor) return "";
    const start = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    const block = start?.closest("h1,h2,h3,p,div,li");
    return block?.tagName.toLowerCase() ?? "";
  }

  function getCurrentLinkElement() {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    if (!anchor) return null;
    const start = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    return start?.closest("a") ?? null;
  }

  function exec(command: string, arg?: string) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emit();
    updateActiveStates();
  }

  function saveSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      savedRangeRef.current = null;
      return;
    }
    savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelectionRange() {
    const range = savedRangeRef.current;
    if (!range) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function addOrEditLink() {
    if (disabled) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    saveSelectionRange();

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";

    const urlInput = window.prompt("Link-URL eingeben (https://...)");
    if (!urlInput?.trim()) return;
    const href = urlInput.trim();
    if (!/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) {
      window.alert("Bitte eine gültige URL angeben (z. B. https://example.com).");
      return;
    }
    editor.focus();
    restoreSelectionRange();

    if (selectedText.length > 0) {
      exec("createLink", href);
      const link = getCurrentLinkElement();
      if (link) {
        link.setAttribute("data-editor-href", href);
        link.removeAttribute("href");
      }
      emit();
      updateActiveStates();
      return;
    }

    const linkLabel = window.prompt("Link-Text eingeben", href) ?? "";
    const safeLabel = linkLabel.trim() || href;
    document.execCommand(
      "insertHTML",
      false,
      `<a data-editor-href="${href}" target="_blank" rel="noreferrer">${safeLabel}</a>`,
    );
    emit();
    updateActiveStates();
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={isBold ? "default" : "outline"} onClick={() => exec("bold")} disabled={disabled} aria-label="Fett" title="Fett">
          <Bold className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant={isItalic ? "default" : "outline"} onClick={() => exec("italic")} disabled={disabled} aria-label="Kursiv" title="Kursiv">
          <Italic className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant={isUnderline ? "default" : "outline"} onClick={() => exec("underline")} disabled={disabled} aria-label="Unterstrichen" title="Unterstrichen">
          <Underline className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant={isUnorderedList ? "default" : "outline"} onClick={() => exec("insertUnorderedList")} disabled={disabled} aria-label="Liste" title="Liste">
          <List className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant={isOrderedList ? "default" : "outline"} onClick={() => exec("insertOrderedList")} disabled={disabled} aria-label="Nummerierte Liste" title="Nummerierte Liste">
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant={currentAlign === "left" ? "default" : "outline"} onClick={() => exec("justifyLeft")} disabled={disabled} aria-label="Links ausrichten" title="Links ausrichten">
          <AlignLeft className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant={currentAlign === "center" ? "default" : "outline"} onClick={() => exec("justifyCenter")} disabled={disabled} aria-label="Zentrieren" title="Zentrieren">
          <AlignCenter className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant={currentAlign === "right" ? "default" : "outline"} onClick={() => exec("justifyRight")} disabled={disabled} aria-label="Rechts ausrichten" title="Rechts ausrichten">
          <AlignRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={currentBlock === "h1" ? "default" : "outline"}
          onClick={() => exec("formatBlock", currentBlock === "h1" ? "<p>" : "<h1>")}
          disabled={disabled}
          aria-label="H1"
          title="H1"
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={currentBlock === "h2" ? "default" : "outline"}
          onClick={() => exec("formatBlock", currentBlock === "h2" ? "<p>" : "<h2>")}
          disabled={disabled}
          aria-label="H2"
          title="H2"
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={currentBlock === "h3" ? "default" : "outline"}
          onClick={() => exec("formatBlock", currentBlock === "h3" ? "<p>" : "<h3>")}
          disabled={disabled}
          aria-label="H3"
          title="H3"
        >
          <Heading3 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addOrEditLink}
          disabled={disabled}
          aria-label="Link einfügen"
          title="Link einfügen"
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (!hasLinkSelection) return;
            exec("unlink");
          }}
          disabled={disabled || !hasLinkSelection}
          aria-label="Link entfernen"
          title="Link entfernen"
        >
          <UnlinkIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative">
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onClick={(e) => {
            const target = e.target as HTMLElement | null;
            const anchor = target?.closest("a");
            if (!anchor) return;
            const href = anchor.getAttribute("data-editor-href") ?? anchor.getAttribute("href");
            if (!href) return;
            e.preventDefault();
            e.stopPropagation();
            window.open(href, "_blank", "noopener,noreferrer");
          }}
          onMouseMove={(e) => {
            const target = e.target as HTMLElement | null;
            const anchor = target?.closest("a");
            const href = anchor?.getAttribute("data-editor-href") ?? anchor?.getAttribute("href") ?? null;
            if (!href) {
              setHoveredHref(null);
              setHoverPos(null);
              return;
            }
            setHoveredHref(href);
            setHoverPos({ x: e.clientX, y: e.clientY });
          }}
          onMouseLeave={() => {
            setHoveredHref(null);
            setHoverPos(null);
          }}
          onInput={emit}
          onKeyUp={updateActiveStates}
          onMouseUp={updateActiveStates}
          className={cn(
            "min-h-[260px] rounded-md border bg-background px-3 py-2 text-sm",
            "[&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_ol]:list-decimal [&_ol]:list-inside [&_ul]:list-disc [&_ul]:list-inside [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-70",
          )}
        />
        {hoveredHref && hoverPos ? (
          <div
            className="pointer-events-none fixed z-[200] max-w-[480px] rounded bg-foreground px-2 py-1 text-xs text-background shadow"
            style={{ left: hoverPos.x + 12, top: hoverPos.y + 12 }}
          >
            {hoveredHref}
          </div>
        ) : null}
      </div>
    </div>
  );
}

