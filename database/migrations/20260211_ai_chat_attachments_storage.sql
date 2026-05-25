-- Private bucket for Survey KI multimodal uploads (PNG, JPEG, PDF, …).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-chat-attachments',
  'ai-chat-attachments',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path layout: {auth.uid()}/{chat_id}/{message_id}/...

DROP POLICY IF EXISTS "ai_chat_attachments_select_own" ON storage.objects;
CREATE POLICY "ai_chat_attachments_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ai-chat-attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "ai_chat_attachments_insert_own" ON storage.objects;
CREATE POLICY "ai_chat_attachments_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ai-chat-attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "ai_chat_attachments_update_own" ON storage.objects;
CREATE POLICY "ai_chat_attachments_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'ai-chat-attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'ai-chat-attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "ai_chat_attachments_delete_own" ON storage.objects;
CREATE POLICY "ai_chat_attachments_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'ai-chat-attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
);
