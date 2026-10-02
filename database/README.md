# Datenbank

Die aktuelle Anleitung steht im Wiki im Projektroot: [README.md](../README.md), Abschnitt **7. Die Datenbank einrichten**.

Kurzfassung:

1. Zuerst `schema.sql` im Supabase SQL Editor ausführen.
2. Danach jede Datei in `migrations/` ausführen, die älteste zuerst. Der Dateiname beginnt mit dem Datum.
3. `schema.sql` allein enthält nur Profile, Firmen, Mitglieder, Einladungen und Fragebögen. Chat, SEO, Onboarding, Jobs und Leadinfo kommen aus den Migrationen.

`pg_cron`, `pg_net` und die Tabelle `app_settings` erklärt derselbe Abschnitt.
