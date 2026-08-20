/**
 * Meeting-document text extraction.
 * Run: npx tsx scripts/test-extract-meeting-document.ts
 */
import assert from "node:assert/strict";

import { extractMeetingDocumentText } from "../lib/surveys/extract-meeting-document-text";

const txt = extractMeetingDocumentText({
  fileName: "meeting.txt",
  mimeType: "text/plain",
  bytes: new TextEncoder().encode("Firmenname: Muster GmbH\nRegion: Hamm"),
});
assert.equal(txt.ok, true);
if (txt.ok) assert.match(txt.text, /Muster GmbH/);

const empty = extractMeetingDocumentText({
  fileName: "leer.txt",
  mimeType: "text/plain",
  bytes: new Uint8Array(),
});
assert.equal(empty.ok, false);

const oldDoc = extractMeetingDocumentText({
  fileName: "alt.doc",
  mimeType: "application/msword",
  bytes: new Uint8Array([1, 2, 3]),
});
assert.equal(oldDoc.ok, false);

console.log("extract-meeting-document: ok");
