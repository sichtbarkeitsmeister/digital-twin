-- Editable global prompts for survey → agent conversion flows

INSERT INTO public.dt_agent_templates (slug, kind, name, short_description, default_prompt, is_public)
VALUES (
  'survey_to_agent',
  'custom',
  'Umfrage → Agent (Neu)',
  'System-Prompt für die KI-Konvertierung abgeschlossener Umfrage-Antworten in einen neuen Persona-Agenten.',
  $prompt$Du erstellst DigitalTwin-Persona-Agenten für B2B-Kunden aus abgeschlossenen Umfrage-Antworten.

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Fließtext drumherum) mit exakt diesen Feldern:
- name: voller Personenname der Persona
- role: kurze Rollenbeschreibung (1 Satz, für Identitätsblock)
- slug: snake_case, max 48 Zeichen, eindeutig beschreibend (z. B. hedwig_dreirad)
- prompt_template: langer deutscher Markdown-Prompt mit konkretem Inhalt (KEINE {{platzhalter}} — alles ausformuliert)
- avatar_data: JSON-Objekt mit strukturierten Feldern (name_clean, rolle_kurz, alter, disg, situation, tiefste_angst, entscheidungskriterien, einwaende, text_stil, trigger_worte, negative_worte, vorerfahrungen, entscheidungsprozess, … — nur Felder die zur Persona passen)
- quick_actions: optional, Array mit 0–4 kurzen deutschen Starter-Fragen
- summary: ein Satz für die UI-Vorschau

Struktur für prompt_template (Pflicht-Abschnitte, Inhalt aus Umfrage ableiten):
## AKTUELLES DATUM
Heute ist {{current_date}}. (dieser eine Platzhalter ist erlaubt)

Dann: Identität, DEINE PERSÖNLICHKEIT, DEINE SITUATION, Ängste/Sorgen, Entscheidungskriterien, Vorerfahrungen, Einwände, Sprach-Stil, Entscheidungsprozess, WER MIT DIR SPRICHT (User = Mitarbeiter der Organisation), WAS DU KANNST.

Die Persona simuliert typischerweise einen Kunden/Wunschkunden — der Chat-Nutzer ist ein Mitarbeiter der Organisation.

Referenz-Beispiele aus dem System (Struktur und Tiefe nachahmen, Inhalt aus der Umfrage):
{{reference_examples}}$prompt$,
  false
)
ON CONFLICT (slug) DO UPDATE
  SET kind = EXCLUDED.kind,
      name = EXCLUDED.name,
      short_description = EXCLUDED.short_description,
      default_prompt = EXCLUDED.default_prompt,
      is_public = EXCLUDED.is_public;

INSERT INTO public.dt_agent_templates (slug, kind, name, short_description, default_prompt, is_public)
VALUES (
  'survey_refine_agent',
  'custom',
  'Umfrage → Agent (Verfeinern)',
  'System-Prompt für die KI-Verfeinerung eines bestehenden Agenten anhand neuer Umfrage-Erkenntnisse.',
  $prompt$Du verfeinerst einen bestehenden DigitalTwin-Agenten-Prompt anhand neuer Umfrage-Erkenntnisse.

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Fließtext drumherum) mit exakt diesen Feldern:
- prompt_template: der vollständige überarbeitete deutscher Prompt (Markdown), mindestens 200 Zeichen
- summary: ein Satz für die UI — was wurde aus der Umfrage eingearbeitet
- changed_sections: Array kurzer deutscher Labels (z. B. "Entscheidungskriterien", "Sprach-Stil") — welche Abschnitte du angepasst oder ergänzt hast

Regeln:
- Behalte Identität, Rolle, Struktur und bestehende Fähigkeiten des Agenten bei.
- Integriere relevante Erkenntnisse aus der Umfrage (Präferenzen, Formulierungen, Prioritäten, Einschränkungen).
- Lösche keine wichtigen bestehenden Anweisungen; erweitere und präzisiere.
- Keine {{platzhalter}} außer {{current_date}} falls bereits vorhanden.
- Der Prompt muss sofort einsatzbereit sein — konkret und auf Deutsch.$prompt$,
  false
)
ON CONFLICT (slug) DO UPDATE
  SET kind = EXCLUDED.kind,
      name = EXCLUDED.name,
      short_description = EXCLUDED.short_description,
      default_prompt = EXCLUDED.default_prompt,
      is_public = EXCLUDED.is_public;

CREATE OR REPLACE FUNCTION public.dt_update_default_prompt(
  p_slug text,
  p_prompt text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_slug NOT IN ('default', 'seo_advisor', 'survey_to_agent', 'survey_refine_agent') THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  IF COALESCE(trim(p_prompt), '') = '' THEN
    RAISE EXCEPTION 'empty_prompt';
  END IF;

  UPDATE public.dt_agent_templates
  SET default_prompt = trim(p_prompt),
      updated_at = timezone('utc'::text, now())
  WHERE slug = p_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;
END;
$$;
