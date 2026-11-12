# Grammatikprüfung der fertigen Texte (Pipeline mit Watermark nach Lektorat)

Projekt: Einfach Entrümpelung - Gasanov · Prüfdatum: 12.11.2026 · Anrede laut Text: **Sie** (durchgehend eingehalten)

## Wie geprüft wurde – und was diese Prüfung nicht kann

- Geprüft wurden die **fertigen Texte** (Stand „Fertig“, nicht freigegeben) von 3 Seiten, als Textdateien geliefert.
- Maßstab ist der Lektorat-Schritt (`lib/dt/content/step-prompts.ts`, `LEKTORAT_DEFAULT`): Rechtschreibung, Grammatik, Zeichensetzung, Satzbau, Anrede, Frage-Überschriften.
- Ablauf: LanguageTool de-DE (öffentliche API) über alle drei Texte → Fehlalarme entfernt (Namen „Murad Gasanov“, „Gasanov“, „Einfach“ im Firmennamen, Kundennamen, wörtliche Google-Bewertungen, Platzhalter, „3 Sätze beginnen mit Sie“) → jeden Satz selbst gelesen.
- **Keine Vorher-Snapshots** (Stand vor der Watermark Entfernung) vorhanden. Deshalb ist bei jedem Fehler `origin = UNKNOWN`: Ich kann nicht belegen, ob Grok ihn eingeführt hat oder ob er schon nach dem Lektorat da war. Die Zahlen unten zeigen, **was beim Kunden ankommt**, nicht, welcher Schritt schuld ist. Hinweise auf die Herkunft stehen in Abschnitt 4.
- Wörtliche Zitate aus Google-Bewertungen wurden nicht als Fehler gezählt (z. B. fehlendes Komma in „…beauftragt nach dem Tod meiner Mutter die Wohnung aufzulösen“, „Eine 70 qm Messie-Wohnung … wurden“).
- Wortzahl ohne Platzhalter wie [LINK …], [FOTO …], [BITTE PRÜFEN …].

## 1. Ergebnis je Seite

| Seite | Seitentyp | Wörter | Fehler gesamt | davon kritisch | mittel | gering | Fehler / 1.000 Wörter | nur mittel / 1.000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Hauptthema (Startseite) | Startseite | 1.609 | 4 | 0 | 1 | 3 | 2,5 | 0,6 |
| Entsorgung | Hauptsilo-Seite | 1.406 | 11 | 0 | 4 | 7 | 7,8 | 2,8 |
| Wohnungsauflösung | Unterseite | 2.048 | 13 | 0 | 5 | 8 | 6,3 | 2,4 |

„Abschnitte umformuliert / gesamt“ und „Fehler vorher / nachher / INTRODUCED“ lassen sich ohne Vorher-Snapshot nicht bestimmen.

## 2. Summe (3 Seiten)

| Wörter | Fehler | kritisch | mittel | gering | Fehler / 1.000 Wörter |
|---:|---:|---:|---:|---:|---:|
| 5.063 | **28** | 0 | 10 | 18 | **5,5** |

Nach Kategorie: Grammatik 12 · Rechtschreibung (Getrennt-/Zusammenschreibung) 9 · Satzbruch 3 · Sinnänderung / Widerspruch 4 · Zeichensetzung 0 · Anrede 0.
Ohne die 9 Fälle „weg muss“ / „weg sollen“ / „raus soll“: 19 Fehler = 3,8 je 1.000 Wörter.

## 3. Die 10 schwersten Fehler

| # | Seite | Stelle | Text | Problem | Vorschlag |
|---|---|---|---|---|---|
| 1 | Wohnungsauflösung | „Welche Situation betrifft Sie?“ | Am häufigsten sind der Umzug ins Pflegeheim und der eigene Umzug. Diese Lagen kommen am häufigsten vor. | Satz ohne vollständiges Prädikat, dann dieselbe Aussage noch einmal | Am häufigsten kommen der Umzug ins Pflegeheim und der eigene Umzug vor. |
| 2 | Wohnungsauflösung | „Murad Gasanov“ | Dazu arbeitet er mit DMD Transport zusammen. Der Möbellift kommt bei Umzügen … zum Einsatz. | „Der Möbellift“ ohne Bezug, vorher wird kein Möbellift erwähnt | …, deren Möbellift bei Umzügen und Entrümpelungen zum Einsatz kommt. |
| 3 | Wohnungsauflösung | L39 / L43 | Der Inhaber führt Aufträge selbst aus … / Er koordiniert, sein Team führt aus. | Widerspruch innerhalb von vier Zeilen | Der Inhaber begleitet jeden Auftrag persönlich. |
| 4 | Entsorgung | FAQ „brauchbare Möbel“ | Möglich sind außerdem die Abgabe an Sozialkaufhäuser oder gemeinnützige Einrichtungen. | Kongruenz: „die Abgabe“ ist Singular | Möglich ist außerdem die Abgabe … |
| 5 | Entsorgung | FAQ „einzelne Möbel“ | Ja, die einzelne Möbelentsorgung gehört zum Angebot. | Adjektiv am falschen Wort | die Entsorgung einzelner Möbel |
| 6 | Entsorgung | „Wann Sie jemanden brauchen …“ | Ob privat oder gewerblich, ändert weder Ablauf noch Preis. | Satz grammatisch unvollständig (ob-Satz ohne Verb als Subjekt) | Ob privat oder gewerblich: Ablauf und Preis sind gleich. |
| 7 | Wohnungsauflösung | „Ganzes Haus, Keller …“ | Erst danach steht der Festpreis. | Verbpartikel „fest“ fehlt | Erst danach steht der Festpreis fest. |
| 8 | Startseite | „In drei Schritten …“ | Überschrift „In drei Schritten“, darunter 4 Schritte | Zahl stimmt nicht | In vier Schritten zur geräumten Wohnung |
| 9 | Entsorgung | FAQ „ordentlich entsorgt?“ | …und bringen Sperrmüll über den Wertstoffhof. | Falsche Präposition | …und entsorgen Sperrmüll über den Wertstoffhof. |
| 10 | Wohnungsauflösung | FAQ „Was kostet …“ | Als Richtwert beginnt eine 50-m²-Wohnung ab etwa 1.200 €. | „beginnt … ab“ vermischt zwei Konstruktionen | Als Richtwert kostet eine 50-m²-Wohnung ab etwa 1.200 €. |

Die vollständige Liste mit Erklärung und Korrekturvorschlag steht in `eval/watermark-errors.csv`.

## 4. Muster

1. **Zusammenschreibung von Verbpartikeln** (9×): „was weg muss“, „die weg sollen“, „falls sie raus soll“. Das ist ein Stereotyp, das auf allen 3 Seiten vorkommt. Es ist harmlos, aber LanguageTool findet es zuverlässig und kann es automatisch korrigieren.
2. **Kürzungen, bei denen der Rest nicht angepasst wurde.** Aus „die Weitergabe … und die Zusammenarbeit …“ (Entsorgung L38, korrekt im Plural) wird im FAQ „die Abgabe …“, das Verb bleibt aber „sind“. Andere Fälle: „Erst danach steht der Festpreis“ ohne „fest“, „Der Möbellift“ nach einem abgetrennten Satz, „Ob privat oder gewerblich, ändert …“. Das ist das typische Bild eines Satzes, der umformuliert und dabei verkürzt wurde.
3. **Doppelte Aussagen.** „Am häufigsten sind … Diese Lagen kommen am häufigsten vor.“ Ursprungs- und Umformulierungssatz stehen offenbar beide im Text.
4. **Angehängte Satzglieder ohne Bezug:** „…, als Aufpreis“ (2×), „auch am selben Tag oder im Notfall“ (2×). Kurze Nachträge werden hinten an Sätze geklebt, der Bezug geht dabei verloren.
5. **Kompakte Nominalisierungen mit falschem Bezug:** „die einzelne Möbelentsorgung“, „ein Angebot nur nach Telefon“.

Betroffen sind vor allem **FAQ-Antworten und kurze H3-Abschnitte**. Dort wird kurz geschrieben und stark verdichtet. Lange Fließtext-Abschnitte (Preis, Ablauf) sind weitgehend sauber.

**Zur Herkunft (nicht belegt, nur Einschätzung):** Kongruenzfehler, fehlende Verbpartikel, doppelte Sätze und Artikel ohne Bezug korrigiert ein Claude-Lektorat normalerweise. Dass sie im Endtext stehen, passt zu der Annahme, dass sie **nach** dem Lektorat entstanden sind, also bei der Watermark Entfernung. „weg muss“ und der Widerspruch „Inhaber führt aus“ / „Team führt aus“ können auch älter sein. Belegen lässt sich das nur mit Vorher-Snapshots an der Durchsicht-Stelle.

## 5. Urteil

Die Schwellen waren für **eingeführte** Fehler gedacht, und die kann ich nicht isolieren. Angewendet auf alle Fehler im Endtext:

- 5,5 Fehler je 1.000 Wörter, auch ohne die Zusammenschreibung noch 3,8, und nur die mittleren gezählt 2,0.
- 0 kritische Fehler.

→ **Erheblich (significant)**, wenn man alle Fehler zählt, an der Grenze „merklich / erheblich“, wenn man nur die mittleren zählt. Auch wenn nur ein Teil davon von Grok stammt: Fast jede Seite hat 2–5 Sätze, die ein Kunde als falsch erkennt (Nr. 1–7 oben). Ohne einen Korrekturschritt nach der Watermark gehen sie so raus.

## 6. Lösungsmöglichkeiten (nicht umgesetzt)

**A. Reiner Korrekturdurchgang nach der Watermark** (neuer Schritt oder Teil der Endabnahme)
Claude bekommt den Auftrag, nur Fehler zu korrigieren und keine Formulierung zu ändern. Eine Prüfung im Code lässt nur kleine Änderungen pro Satz zu (z. B. höchstens 3 Wörter, Wortlaut sonst gleich). Größere Änderungen werden verworfen und als offener Punkt gemeldet, so wie es `rephrase-guard.ts` heute schon macht.
- Vorteil: Findet auch, was LanguageTool übersieht (Nr. 1–3, 6).
- Nachteil: Ein weiterer LLM-Aufruf pro Seite (rund 0,2–0,4 € nach den heutigen Seitenkosten). Ohne die harte Grenze bringt Claude wieder KI-Muster hinein, also genau das Problem, das zur Umstellung geführt hat.
- Dateien: `lib/dt/content/pipeline/steps.ts` (Schritt anlegen), `prompts.ts` (Spezifikation), `step-prompts.ts` (Standard-Anweisung), `run-step.ts` (Ausführung und Prüfung), neue Prüffunktion neben `rephrase-guard.ts`.

**B. LanguageTool-Prüfung pro Abschnitt als Schutz in der Watermark Entfernung** (empfohlen als erster Schritt)
Jeder Abschnitt wird vor und nach der Grok-Umformulierung mit LanguageTool geprüft. Bringt die Umformulierung **neue** Fehler aus Grammatik oder Rechtschreibung, wird sie für diesen Abschnitt verworfen (bestehender Weg „Umformulierung verworfen …“) oder Grok bekommt den Abschnitt einmal mit der Fehlerliste zurück. Eindeutige Regeln wie die Zusammenschreibung lassen sich auch direkt automatisch korrigieren.
- Vorteil: Läuft fest im Code, kostet kein LLM-Geld und kann keine KI-Muster zurückbringen. Fängt Nr. 4, 7, 9, 10 und die Zusammenschreibung.
- Nachteil: Übersieht doppelte Sätze, Bezugsfehler und Widersprüche (Nr. 1–3). Braucht einen LanguageTool-Server, entweder selbst betrieben (Docker) oder Premium-API, weil die öffentliche API auf 20 Anfragen pro Minute begrenzt ist. Wird mehr verworfen, bleiben mehr Abschnitte im Lektorat-Wortlaut.
- Dateien: `lib/dt/content/pipeline/rephrase-guard.ts` (zusätzliche Prüfung), `rephrase-runner.ts` (Prüfung pro Abschnitt / erneuter Versuch), neues Modul `lib/dt/content/pipeline/languagetool.ts`, Konfiguration (URL / Schlüssel).

**C. Watermark-Anweisung verschärfen**
Grok bekommt in `rephrase.ts` ausdrücklich die Regeln mit: Satz nach dem Umformulieren auf Vollständigkeit und Kongruenz prüfen, keine Aussage doppelt stehen lassen, keine Satzglieder hinten anhängen, kein bestimmter Artikel ohne vorherige Erwähnung, Verbpartikel zusammenschreiben.
- Vorteil: Billig, nur eine Änderung an der Anweisung.
- Nachteil: Kein Beweis, dass es wirkt. Grok hält sich nicht verlässlich an solche Listen. Allein genügt das nicht.
- Dateien: `lib/dt/content/pipeline/rephrase.ts`.

Empfehlung: **B + C** zuerst. A nur, wenn danach noch Satzbrüche wie Nr. 1–3 auftauchen.

## Weitere Auffälligkeiten (nicht als Grammatikfehler gezählt)

- **Platzhalter im Endtext:** Entsorgung hat „[BITTE PRÜFEN: verbindliche Schreibweise des Firmennamens]“, obwohl derselbe Text weiter unten „Einfach Entrümpelung - Gasanov“ schreibt. Startseite und Entsorgung haben „[BITTE PRÜFEN: Telefonnummer …]“, die Wohnungsauflösung nennt die Nummern (0211 46841571, 0152 248 99 875). Außerdem [DATUM], [QUELLE …].
- **Unterschiedliche Fakten zwischen den Seiten:** Gleicher Tag laut Startseite „oft noch am selben Tag“, laut Wohnungsauflösung „in Notfällen auch am selben Tag“, laut Entsorgung „auch am selben Tag oder im Notfall“. Firmenname auf der Startseite einmal nur „Einfach Entrümpelung“. Weiterverwertung auf der Startseite „alternativ“, auf der Wohnungsauflösung als feste Reihenfolge („zuerst … danach … dann“).
- **Zweifelsfälle (nicht gezählt):**
  - „zum Beispiel ob“ / „etwa ob“ / „zum Beispiel weil“ ohne Komma (Komma vor „ob“/„weil“ empfehlenswert, nach „z. B.“ strittig).
  - „Nur Sondermüll oder Elektroschrott kosten extra“ (bei „oder“ ist der Singular üblich, der Plural aber zulässig).
  - „Das Team führt aus“ / „sein Team führt aus“ ohne Objekt (vermutlich bewusst übernommenes Zitat des Inhabers).
  - „Wir entrümpeln nur den Keller“ (klingt, als machten sie nur Keller; gemeint ist „auch nur den Keller“).
  - „Vor und nach der Entrümpelung dokumentieren wir mit Fotos“ (Objekt fehlt).
  - „Wohnungsauflösung besichtigen lassen“ (man besichtigt die Wohnung, nicht die Auflösung).
  - „Eine 50-m²-Wohnung beginnt / startet bei …“ (umgangssprachlich).
  - Bindestrich statt Halbgeviertstrich im Firmennamen (Typografie).

## Abschluss

- **Getestete Seiten:** 3 statt 5, alle von dir selbst gestartet. Hauptthema (Startseite), Wohnungsauflösung (Unterseite), Entsorgung (Hauptsilo-Seite).
- **Kosten laut Tool:** 2,35 € + 3,14 € + 3,57 € = **9,06 €**.
- **Was nicht geklappt hat:** Diese Session konnte sich nicht in der Live-App anmelden (Magic-Link-Login). Deshalb habe ich keine Läufe gestartet und keine Vorher-Snapshots an der Durchsicht-Stelle gezogen. Die Auswertung beruht nur auf den gelieferten Endtexten, deshalb ist die Zuordnung INTRODUCED / PRE-EXISTING / FIXED nicht möglich. Für eine belastbare Zuordnung: bei 1–2 weiteren Seiten den Text an der Stelle „Zur Durchsicht“ mitschicken.
