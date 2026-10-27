-- Schnelltests / Quick Actions: Gesprächsstarter an den Avatar, keine Übungsaufträge.
-- Updates the stored „Anbieter-Avatare“ and „Mix-Avatar“ templates when they still carry
-- the old task-style examples (Flyer prüfen / Erstgespräch durchspielen).

UPDATE public.dt_agent_templates
SET default_prompt = replace(
  default_prompt,
  $old$QUICK ACTIONS
4 bis 6 Stück, immer aus Sicht des Mitarbeiters, nie aus Sicht der Persona. Richtig: „Flyer-Entwurf prüfen“, „Antwort auf Google-Bewertung testen“. Falsch: „Ich brauche dringend Hilfe“. Keine beginnt mit Ich, Mir, Mich oder Mein.$old$,
  $new$QUICK ACTIONS (Schnelltests)
4 bis 6 kurze Starter, die der Mitarbeiter dem Avatar persönlich sagt oder fragt, so als spräche er mit ihm im Chat. Es sind Gesprächseinstiege an die Persona, keine Übungsaufträge und keine internen Trainings-Notizen.
Richtig: „Stell dich bitte vor“, „Woher kennst du uns?“, „Was ist gerade dein Schmerzpunkt?“, „Was weißt du schon über uns?“, „Wie kann ich dir helfen?“
Falsch (Aufgaben/Training): „Einwand entkräften“, „Erstkontakt simulieren“, „Reaktion auf Skepsis trainieren“, „Flyer-Entwurf prüfen“.
Falsch (Persona-Sicht): „Ich brauche dringend Hilfe“, Sätze die mit Ich, Mir, Mich oder Mein beginnen.
Jede Quick Action klingt wie gesprochene Ansprache: Frage mit „?“ oder Imperativ mit du/dich/dir/dein.$new$
)
WHERE slug = 'avatar_generator'
  AND default_prompt LIKE '%Flyer-Entwurf prüfen%';

UPDATE public.dt_agent_templates
SET default_prompt = replace(
  default_prompt,
  $old$QUICK ACTIONS
4 bis 6, aus Sicht des Mitarbeiters, passend für alle Zielgruppen (z. B. „Erstgespräch durchspielen“, „Angebotstext testen“). Keine beginnt mit Ich, Mir, Mich oder Mein.$old$,
  $new$QUICK ACTIONS (Schnelltests)
4 bis 6 kurze Starter, die der Mitarbeiter dem Mix-Avatar persönlich sagt oder fragt: Gesprächseinstiege, keine Übungsaufträge.
Richtig: „Stell dich bitte vor“, „Woher kennt ihr uns?“, „Was belastet euch gerade am meisten?“
Falsch: „Einwand üben“, „Erstgespräch durchspielen“, „Angebotstext testen“.
Keine beginnt mit Ich, Mir, Mich oder Mein. Frage mit „?“ oder Imperativ mit du/euch/dein.$new$
)
WHERE slug = 'avatar_mix'
  AND default_prompt LIKE '%Erstgespräch durchspielen%';
