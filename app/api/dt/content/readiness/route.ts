import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { contentError, gateContentRoute, loadContentReadiness, contentOk } from "@/lib/dt/content/route-helpers";
import { loadContentSettings, settingsFromRow } from "@/lib/dt/content/store";
import type { ContentReadinessResult } from "@/lib/dt/content/types";

export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const [{ readiness, local }, models, settingsRow] = await Promise.all([
      loadContentReadiness(gate.service, gate.organisationId),
      loadContentModelConfig(gate.service),
      loadContentSettings(gate.service, gate.organisationId),
    ]);

    const data: ContentReadinessResult = {
      readiness,
      local,
      pipeline: {
        model: models.write[0] ?? "",
        check_model: models.check[0] ?? "",
        source: models.source,
      },
      settings: settingsRow
        ? { ...settingsFromRow(settingsRow), avatar_agent_id: settingsRow.avatar_agent_id }
        : null,
    };
    return contentOk(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voraussetzungen konnten nicht geladen werden.";
    return contentError(message, 500);
  }
}
