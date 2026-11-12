import { z } from "zod";

import { CLIENT_WISHES_TEXT_MAX, parseClientWishes } from "@/lib/dt/content/client-wishes";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { saveContentClientWishes } from "@/lib/dt/content/store";
import type { ContentWishesResult } from "@/lib/dt/content/types";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  client_wishes: z.string().max(CLIENT_WISHES_TEXT_MAX),
});

/** „Kundenwünsche“: binding for every text step of the organisation, from the next step that runs. */
export async function PUT(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError(`Die Hinweise zum Texten dürfen höchstens ${CLIENT_WISHES_TEXT_MAX} Zeichen lang sein.`, 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const text = parsed.data.client_wishes.replace(/\r\n?/g, "\n").trim();
  const saved = await saveContentClientWishes(gated.gate.service, gated.gate.organisationId, text);
  if (!saved.ok) return contentError(saved.error, saved.status);
  const data: ContentWishesResult = { client_wishes: text, count: parseClientWishes(text).length };
  return contentOk(data);
}
