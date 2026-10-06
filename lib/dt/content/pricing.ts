/**
 * Token prices for the cost column. Anthropic bills in USD per million tokens; the Texte tab
 * shows EUR, converted with `CONTENT_USD_EUR_RATE` (default 0.92). Unknown models are priced
 * like Sonnet so the column never shows 0 for a real call. Update when Anthropic changes prices.
 */

type Price = { match: RegExp; inputUsd: number; outputUsd: number };

const PRICES_USD_PER_MTOK: Price[] = [
  { match: /opus-4-[5-9]|opus-[5-9]/i, inputUsd: 5, outputUsd: 25 },
  { match: /opus/i, inputUsd: 15, outputUsd: 75 },
  { match: /haiku-4|haiku-[5-9]/i, inputUsd: 1, outputUsd: 5 },
  { match: /3-5-haiku|haiku-3/i, inputUsd: 0.8, outputUsd: 4 },
  { match: /sonnet/i, inputUsd: 3, outputUsd: 15 },
];

const DEFAULT_PRICE: Price = { match: /.*/, inputUsd: 3, outputUsd: 15 };
const DEFAULT_USD_EUR_RATE = 0.92;

export function usdEurRate(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.CONTENT_USD_EUR_RATE);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_USD_EUR_RATE;
}

export function priceForModel(model: string | null | undefined): Price {
  if (!model) return DEFAULT_PRICE;
  return PRICES_USD_PER_MTOK.find((p) => p.match.test(model)) ?? DEFAULT_PRICE;
}

export function estimateCostEur(
  model: string | null | undefined,
  usage: { inputTokens: number; outputTokens: number },
  rate = usdEurRate(),
): number {
  const price = priceForModel(model);
  const usd =
    (Math.max(0, usage.inputTokens) / 1_000_000) * price.inputUsd +
    (Math.max(0, usage.outputTokens) / 1_000_000) * price.outputUsd;
  return Math.round(usd * rate * 10_000) / 10_000;
}

export function roundEur(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
