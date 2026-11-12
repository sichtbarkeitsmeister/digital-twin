-- Texte: Zielgruppen je Seite (primär / sekundär), vom Zwilling vorgeschlagen, von der Redaktion
-- bestätigt oder geändert. Leer ({}) = die Seite nutzt die Standard-Zielgruppe der Organisation
-- (dt_content_settings.avatar_agent_id), wie bisher.
--
-- Form: { "primary": [agent_id, …] (1–2), "secondary": [agent_id, …] (0–3),
--         "status": "vorschlag" | "bestaetigt", "reasons": { agent_id: "…" },
--         "suggested_at": "…", "confirmed_at": "…" }
--
-- Die App läuft auch ohne diese Spalte (dann ohne Zielgruppen je Seite). Einmal im Supabase SQL
-- Editor ausführen; mehrfaches Ausführen schadet nicht.

ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS zielgruppen jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.dt_content_pages.zielgruppen IS
  'Zielgruppen dieser Seite: primary (1–2 Avatar-ids), secondary (0–3), status vorschlag|bestaetigt, reasons je id. Leer = Standard-Zielgruppe der Organisation. „Zurücksetzen“ behält sie.';
