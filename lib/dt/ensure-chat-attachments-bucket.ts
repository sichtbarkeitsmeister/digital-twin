import { createServiceClient } from "@/lib/supabase/service";

const DT_CHAT_ATTACHMENTS_BUCKET = "dt-chat-attachments";

let openedAllMimes = false;
let opening: Promise<void> | null = null;

/**
 * Production still has the old MIME allowlist (no octet-stream / HTML / Word).
 * Open the private bucket to every type once, using the service role.
 */
export async function ensureDtChatAttachmentsAcceptAllMimes(): Promise<void> {
  if (openedAllMimes) return;
  if (opening) {
    await opening;
    return;
  }
  opening = (async () => {
    try {
      const service = createServiceClient();
      const { error } = await service.storage.updateBucket(DT_CHAT_ATTACHMENTS_BUCKET, {
        public: false,
        allowedMimeTypes: null,
        fileSizeLimit: 10 * 1024 * 1024,
      });
      if (error) {
        console.warn("[dt] open chat-attachment MIME list:", error.message);
        return;
      }
      openedAllMimes = true;
    } catch (err) {
      console.warn(
        "[dt] open chat-attachment MIME list:",
        err instanceof Error ? err.message : err,
      );
    }
  })();
  await opening;
  opening = null;
}
