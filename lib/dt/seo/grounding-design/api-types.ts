/** Response of GET/POST /api/dt/seo/grounding/design (the card „Design der Grounding Page“). */

import type { DesignExtractionReport } from "@/lib/dt/seo/grounding-design/extract";
import type { GroundingDesignProfile, GroundingDesignRecord } from "@/lib/dt/seo/grounding-design/profile";

export type GroundingDesignPayload = {
  ok: true;
  migrationMissing: boolean;
  message: string | null;
  websiteUrl: string | null;
  record: GroundingDesignRecord | null;
  profile: GroundingDesignProfile;
  report: DesignExtractionReport | null;
};
