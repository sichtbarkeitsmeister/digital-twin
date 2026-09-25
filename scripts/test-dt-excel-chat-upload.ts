/**
 * Excel lists in DigitalTwin chat: bounded parse + request-size budget.
 * Run: npx tsx scripts/test-dt-excel-chat-upload.ts
 */
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import { dtAttachmentInboundSchema, prepareInboundAttachments } from "../lib/dt/attachments";
import {
  DT_MAX_CHAT_REQUEST_CHARS,
  isDtChatOwnedStoragePath,
} from "../lib/dt/attachments-shared";
import {
  chatRequestCharCount,
  decidePastedList,
  indexesExceedingChatRequestBudget,
  pastedListMessagePreview,
} from "../lib/dt/chat-attachment-payload";
import { EXCEL_MAX_ROWS, extractExcelText } from "../lib/dt/excel-text";
import { extractTextPreviewFromBytes } from "../lib/dt/parse-attachment-text";
import { readDtApiJson } from "../lib/dt/read-api-json";

const ORG = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

function sheetBytes(rows: string[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Liste");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

async function testExcelExtractAndOffset() {
  const bytes = sheetBytes([
    ["Name", "Ort"],
    ["Westprüfung", "Dortmund"],
  ]);
  const extracted = await extractTextPreviewFromBytes(
    "kunden.xlsx",
    "application/octet-stream",
    bytes,
  );
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.match(extracted.text, /Westprüfung/);
  assert.match(extracted.text, /Dortmund/);

  const padded = new Uint8Array(bytes.length + 24);
  padded.set(bytes, 12);
  const view = padded.subarray(12, 12 + bytes.length);
  assert.notEqual(view.byteOffset, 0);
  const fromView = extractExcelText(view);
  assert.match(fromView, /Dortmund/);
  console.log("excel extract + offset buffer: ok");
}

function testRowCap() {
  const rows: string[][] = [["Nr"]];
  for (let i = 0; i < EXCEL_MAX_ROWS + 400; i += 1) rows.push([`zeile-${i}`]);
  const text = extractExcelText(sheetBytes(rows));
  assert.match(text, /gekürzt/);
  assert.match(text, /zeile-0/);
  assert.doesNotMatch(text, /zeile-2399/);
  console.log("excel row cap: ok");
}

function testOwnedPath() {
  const ok = `org_${ORG}/chat_${CHAT}/inbox/1_liste.xlsx`;
  assert.equal(isDtChatOwnedStoragePath(ok, ORG, CHAT), true);
  assert.equal(isDtChatOwnedStoragePath(`org_${ORG}/chat_${CHAT}/../secret`, ORG, CHAT), false);
  assert.equal(
    isDtChatOwnedStoragePath(`org_other/chat_${CHAT}/inbox/1_liste.xlsx`, ORG, CHAT),
    false,
  );
  assert.equal(isDtChatOwnedStoragePath(`${ok}/`, ORG, CHAT), false);
  console.log("storage path: ok");
}

async function testStoredAttachmentSchema() {
  const parsed = dtAttachmentInboundSchema.safeParse({
    fileName: "liste.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 120,
    storagePath: `org_${ORG}/chat_${CHAT}/inbox/1_liste.xlsx`,
  });
  assert.equal(parsed.success, true);

  const rejected = await prepareInboundAttachments(
    [
      {
        fileName: "liste.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 120,
        storagePath: `org_other/chat_${CHAT}/inbox/1_liste.xlsx`,
      },
    ],
    {
      supabase: {} as never,
      organisationId: ORG,
      chatId: CHAT,
    },
  );
  assert.equal(rejected.ok, false);
  console.log("stored attachment schema: ok");
}

function testRequestBudget() {
  const big = "a".repeat(3_300_000);
  const attachments = [
    { fileName: "a.xlsx", dataBase64: big },
    { fileName: "b.xlsx", dataBase64: big },
  ];
  assert.ok(chatRequestCharCount("hi", attachments) > DT_MAX_CHAT_REQUEST_CHARS);
  const drop = indexesExceedingChatRequestBudget("hi", attachments);
  assert.deepEqual(drop, [0, 1]);
  const small = indexesExceedingChatRequestBudget("hi", [
    { fileName: "a.xlsx", dataBase64: "abc" },
  ]);
  assert.deepEqual(small, []);
  console.log("request budget: ok");
}

function testPastedList() {
  assert.equal(decidePastedList("kurz").action, "send");
  assert.equal(decidePastedList("x".repeat(40_000)).action, "too-long");
  const table = Array.from({ length: 4000 }, (_, i) => `Name\tOrt\tEintrag-${i}`).join("\n");
  assert.equal(decidePastedList(table).action, "attach");
  assert.match(pastedListMessagePreview(table), /^Name\tOrt\tEintrag-0/);
  console.log("pasted list: ok");
}

async function testNonJsonResponse() {
  await assert.rejects(
    () => readDtApiJson(new Response("Request Entity Too Large", { status: 413 })),
    /zu groß/,
  );
  const ok = await readDtApiJson<{ ok: boolean }>(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  assert.equal(ok.ok, true);
  console.log("non-json response: ok");
}

async function main() {
  await testExcelExtractAndOffset();
  testRowCap();
  testOwnedPath();
  await testStoredAttachmentSchema();
  testRequestBudget();
  testPastedList();
  await testNonJsonResponse();
  console.log("dt excel chat upload: all ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
