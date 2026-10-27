/**
 * Checks the Grok (xAI) access that Texte's Watermark Entfernung step uses, with the real key:
 *   1. is the key accepted (GET /v1/models), and which grok models does it see,
 *   2. does the configured model answer a tiny request, and how long does it take.
 *
 * Run: XAI_API_KEY=… npm run xai:check          (optionally XAI_DT_CONTENT_MODEL=…)
 * Nothing is written anywhere; the key is read from the environment only.
 */
import {
  DEFAULT_XAI_MODEL,
  XAI_BASE_URL,
  XAI_MODEL_ENV,
  resolveXaiApiKey,
  resolveXaiModels,
} from "../lib/dt/content/pipeline/xai";

const TIMEOUT_MS = 120_000;

async function request(path: string, apiKey: string, init: RequestInit = {}): Promise<{ status: number; body: string; ms: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${XAI_BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    return { status: res.status, body: await res.text(), ms: Date.now() - started };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { status: 0, body: aborted ? `Zeitlimit nach ${TIMEOUT_MS / 1000} s` : String(error), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const apiKey = resolveXaiApiKey();
  if (!apiKey) {
    console.error("XAI_API_KEY fehlt in der Umgebung. Aufruf: XAI_API_KEY=… npm run xai:check");
    process.exit(2);
  }
  console.log(`Schlüssel: ${apiKey.slice(0, 7)}… (${apiKey.length} Zeichen)`);

  const models = await request("/v1/models", apiKey);
  if (models.status !== 200) {
    console.error(`Schlüssel abgelehnt: HTTP ${models.status} nach ${models.ms} ms – ${models.body.slice(0, 300)}`);
    process.exit(1);
  }
  const available = ((JSON.parse(models.body) as { data?: Array<{ id?: string }> }).data ?? [])
    .map((m) => m.id ?? "")
    .filter(Boolean)
    .sort();
  console.log(`Schlüssel akzeptiert (${models.ms} ms). Sichtbare Modelle: ${available.join(", ") || "keine"}`);

  const candidates = resolveXaiModels();
  const configured = process.env[XAI_MODEL_ENV]?.trim() || DEFAULT_XAI_MODEL;
  for (const candidate of candidates) {
    const known = available.includes(candidate);
    console.log(`Modell ${candidate}${candidate === configured ? " (konfiguriert)" : " (Ausweichmodell)"}: ${known ? "in der Modellliste" : "NICHT in der Modellliste"}`);
  }

  for (const model of candidates) {
    process.stdout.write(`Testanfrage an ${model} … `);
    const chat = await request("/v1/chat/completions", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Antworte nur mit dem gelieferten HTML, den Satz neu formuliert." },
          { role: "user", content: '<section data-block-id="test"><p>Wir melden uns innerhalb eines Werktags bei Ihnen zurück.</p></section>' },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });
    if (chat.status === 200) {
      const parsed = JSON.parse(chat.body) as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = parsed.choices?.[0]?.message?.content?.trim() ?? "";
      console.log(`OK in ${chat.ms} ms, finish_reason ${parsed.choices?.[0]?.finish_reason ?? "?"}, Tokens ${parsed.usage?.prompt_tokens ?? "?"}/${parsed.usage?.completion_tokens ?? "?"}`);
      console.log(`  Antwort: ${text ? text.slice(0, 200) : "(leer!)"}`);
      process.exit(text ? 0 : 1);
    }
    console.log(`HTTP ${chat.status || "–"} nach ${chat.ms} ms – ${chat.body.slice(0, 300)}`);
    if (chat.status !== 404) process.exit(1);
  }
  console.error("Keines der Modelle ist verfügbar.");
  process.exit(1);
}

void main();
