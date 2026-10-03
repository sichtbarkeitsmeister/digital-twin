"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SAFE_BLOCK_ID = /^[a-z0-9_-]+$/i;

function buildSrcDoc(html: string, highlightBlockIds: string[]): string {
  const highlights = highlightBlockIds
    .filter((id) => SAFE_BLOCK_ID.test(id))
    .map((id) => `[data-block-id="${id}"]`)
    .join(",");
  const css = `
    html,body{margin:0;background:#fff}
    body{padding:28px 32px;font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2E2E50;font-size:15px;line-height:1.7}
    h1{font-size:26px;line-height:1.25;font-weight:700;margin:0 0 16px}
    h2{font-size:19px;line-height:1.35;font-weight:700;margin:28px 0 10px}
    h3{font-size:16px;font-weight:600;margin:20px 0 6px}
    p{margin:0 0 12px}
    ul,ol{margin:0 0 12px;padding-left:22px}
    li{margin:4px 0}
    a{color:#2E2E50}
    [data-block-id]{border-left:3px solid transparent;padding:2px 0 2px 14px;margin-left:-17px;border-radius:2px}
    ${highlights ? `${highlights}{border-left-color:#F97316;background:rgba(249,115,22,.06)}` : ""}
  `;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><base target="_blank"><style>${css}</style></head><body>${html}</body></html>`;
}

/** Renders the service HTML isolated (no scripts) and grows to its content height. */
export function DtContentTextFrame(props: {
  html: string;
  title: string;
  highlightBlockIds?: string[];
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const highlightKey = (props.highlightBlockIds ?? []).join("|");
  const srcDoc = useMemo(
    () => buildSrcDoc(props.html, highlightKey ? highlightKey.split("|") : []),
    [props.html, highlightKey],
  );

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.max(240, doc.documentElement.scrollHeight));
  }, []);

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
      onLoad={measure}
      style={{ height }}
      className="block w-full rounded-dt border border-sbkm-navy/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-white/10"
    />
  );
}
