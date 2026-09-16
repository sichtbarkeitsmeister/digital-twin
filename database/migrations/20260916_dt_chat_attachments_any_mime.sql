-- Allow any MIME type in DigitalTwin chat attachments (Excel, Word, HTML, generated PDFs, …).
-- NULL allowed_mime_types = no restriction; size stays 10 MiB.

UPDATE storage.buckets
SET
  allowed_mime_types = NULL,
  file_size_limit = 10485760
WHERE id = 'dt-chat-attachments';
