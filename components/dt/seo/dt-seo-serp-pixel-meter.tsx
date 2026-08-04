"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/dt/cn";
import {
  checkSerpSnippet,
  measureSerpTextCanvas,
  SERP_PIXEL_LIMITS,
  type SerpFieldCheck,
} from "@/lib/dt/seo/serp-pixel";

function MeterBar(props: {
  label: string;
  px: number;
  limit: number;
  ok: boolean;
}) {
  const pct = Math.min(100, Math.round((props.px / props.limit) * 100));
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-medium text-sbkm-ink-600 dark:text-white/55">{props.label}</span>
        <span
          className={cn(
            "tabular-nums font-semibold",
            props.ok
              ? "text-sbkm-navy dark:text-white"
              : "text-red-600 dark:text-red-400",
          )}
        >
          {props.px}/{props.limit}px
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sbkm-navy/10 dark:bg-white/10">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-200",
            props.ok ? "bg-sbkm-mint" : "bg-red-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FieldBlock(props: { heading: string; field: SerpFieldCheck; showMobile: boolean }) {
  return (
    <div className="grid gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/55">
        {props.heading}
        <span className="ml-1 font-semibold normal-case tracking-normal text-sbkm-ink-500 dark:text-white/45">
          · {props.field.chars} Zeichen
        </span>
      </p>
      <MeterBar
        label="Desktop"
        px={props.field.desktopPx}
        limit={props.field.desktopLimit}
        ok={props.field.desktopOk}
      />
      {props.showMobile ? (
        <MeterBar
          label="Mobile"
          px={props.field.mobilePx}
          limit={props.field.mobileLimit}
          ok={props.field.mobileOk}
        />
      ) : null}
    </div>
  );
}

/**
 * Live SERP pixel meter for Title / Meta-Description.
 * Prefers canvas.measureText (Arial); falls back to the shared estimator.
 */
export function DtSeoSerpPixelMeter(props: {
  title?: string | null;
  description?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const title = props.title?.trim() || "";
  const description = props.description?.trim() || "";
  const [titleField, setTitleField] = useState<SerpFieldCheck | null>(null);
  const [descField, setDescField] = useState<SerpFieldCheck | null>(null);

  useEffect(() => {
    if (!title && !description) {
      setTitleField(null);
      setDescField(null);
      return;
    }

    const base = checkSerpSnippet({ title, description });
    if (base.title) {
      const desktopPx = measureSerpTextCanvas(title, 20);
      const mobilePx = measureSerpTextCanvas(title, 16);
      setTitleField({
        ...base.title,
        desktopPx,
        mobilePx,
        desktopOk: desktopPx <= SERP_PIXEL_LIMITS.titleDesktop,
        mobileOk: mobilePx <= SERP_PIXEL_LIMITS.titleMobile,
      });
    } else {
      setTitleField(null);
    }

    if (base.description) {
      const px = measureSerpTextCanvas(description, 14);
      setDescField({
        ...base.description,
        desktopPx: px,
        mobilePx: px,
        desktopOk: px <= SERP_PIXEL_LIMITS.description,
        mobileOk: px <= SERP_PIXEL_LIMITS.description,
      });
    } else {
      setDescField(null);
    }
  }, [title, description]);

  if (!titleField && !descField) return null;

  return (
    <div
      className={cn(
        "rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.03] p-3 dark:border-white/10 dark:bg-white/5",
        props.className,
      )}
    >
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sbkm-navy/70 dark:text-white/55">
        SERP-Pixel-Check
        {!props.compact ? (
          <span className="ml-1 font-semibold normal-case tracking-normal text-sbkm-ink-500 dark:text-white/45">
            · Arial · Title {SERP_PIXEL_LIMITS.titleDesktop}/{SERP_PIXEL_LIMITS.titleMobile}px ·
            Description {SERP_PIXEL_LIMITS.description}px
          </span>
        ) : null}
      </p>
      <div className="grid gap-3">
        {titleField ? (
          <FieldBlock heading="Title" field={titleField} showMobile />
        ) : null}
        {descField ? (
          <FieldBlock heading="Meta-Description" field={descField} showMobile={false} />
        ) : null}
      </div>
    </div>
  );
}
