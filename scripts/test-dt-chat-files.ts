/**
 * Chat file ingest + generated artifacts (HTML/PDF/Excel).
 * Run: npx tsx scripts/test-dt-chat-files.ts
 */
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import { extractTextPreviewFromBytes, isDtPlaceholderAttachmentText } from "../lib/dt/parse-attachment-text";
import { guessDtMimeFromName, isDtPreviewableMime, resolveDtStorageMime } from "../lib/dt/attachments-shared";
import { formatAttachedFilesForPrompt } from "../lib/dt/format-attached-files-for-prompt";
import {
  buildCreatedChatFile,
  ensureFileNameExtension,
  formatFromFileName,
  mergeCreatedChatFiles,
  wrapHtmlDocument,
} from "../lib/dt/chat-files";
import { parseDtCreatedFilesFromText, stripDtCreatedFileFences } from "../lib/dt/parse-chat-file-fences";
import { createPdfFromText, toWinAnsiPdfText } from "../lib/dt/chat-file-pdf";
import { dtAttachmentInboundSchema } from "../lib/dt/attachments";
import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import { ensureLatestTurnHasMultimodalBlocks } from "../lib/dt/hydrate-ephemeral-attachments";
import { bufferToAnthropicBlocks } from "../lib/ai/chat-attachments";

function xlsxBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Leistung", "Preis"],
    ["Prüfung", "1200"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Angebot");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

async function testExcelExtract() {
  const extracted = await extractTextPreviewFromBytes(
    "preise.xlsx",
    "application/octet-stream",
    xlsxBytes(),
  );
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.match(extracted.text, /Prüfung/);
  assert.match(extracted.text, /1200/);
  console.log("excel extract: ok");
}

async function testUnknownBinaryStillAccepted() {
  const extracted = await extractTextPreviewFromBytes(
    "archiv.zip",
    "application/zip",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]),
  );
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.match(extracted.text, /archiv\.zip/);
  console.log("unknown binary placeholder: ok");
}

async function testWordNotRejectedBySchema() {
  const parsed = dtAttachmentInboundSchema.safeParse({
    fileName: "brief.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 12,
    dataBase64: Buffer.from("not-a-real-docx").toString("base64"),
  });
  assert.equal(parsed.success, true);
  console.log("word inbound schema: ok");
}

async function testCreateHtmlAndPdfAndXlsx() {
  const html = await buildCreatedChatFile({
    fileName: "landing",
    format: "html",
    content: "<h1>Hallo</h1><p>Westprüfung</p>",
    title: "Landingpage",
  });
  assert.equal(html.ok, true);
  if (!html.ok) return;
  const htmlText = new TextDecoder().decode(html.file.bytes);
  assert.match(htmlText, /<!DOCTYPE html>/);
  assert.match(htmlText, /Westprüfung/);
  assert.equal(html.file.mimeType, "text/html");

  const pdf = await buildCreatedChatFile({
    fileName: "angebot.pdf",
    format: "pdf",
    content: "Sehr geehrte Damen und Herren,\n\ndie Prüfung kostet 1.200 Euro.",
    title: "Angebot",
  });
  assert.equal(pdf.ok, true);
  if (!pdf.ok) return;
  assert.equal(pdf.file.mimeType, "application/pdf");
  assert.ok(pdf.file.bytes.byteLength > 200);
  const pdfHead = new TextDecoder("latin1").decode(pdf.file.bytes.slice(0, 5));
  assert.equal(pdfHead, "%PDF-");

  const xlsx = await buildCreatedChatFile({
    fileName: "preise.xlsx",
    format: "xlsx",
    content: "Leistung,Preis\nPrüfung,1200",
  });
  assert.equal(xlsx.ok, true);
  if (!xlsx.ok) return;
  const wb = XLSX.read(xlsx.file.bytes, { type: "array" });
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]!]);
  assert.match(csv, /Prüfung/);
  console.log("create html/pdf/xlsx: ok");
}

async function testFileFences() {
  const text = `Hier die Datei:\n\n\`\`\`file landing.html\n<h1>Test</h1>\n\`\`\`\n\nFertig.`;
  const files = await parseDtCreatedFilesFromText(text);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.fileName, "landing.html");
  assert.match(new TextDecoder().decode(files[0]!.bytes), /Test/);
  const stripped = stripDtCreatedFileFences(text);
  assert.match(stripped, /Hier die Datei/);
  assert.doesNotMatch(stripped, /```file/);
  console.log("file fences: ok");
}

function testResolveStorageMime() {
  const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  assert.match(
    resolveDtStorageMime("bericht.xlsx", "application/octet-stream", zipHeader),
    /spreadsheet/,
  );
  assert.match(
    resolveDtStorageMime("brief.docx", "application/x-zip-compressed", zipHeader),
    /wordprocessingml/,
  );
  assert.equal(
    resolveDtStorageMime(
      "scan.pdf",
      "application/octet-stream",
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    ),
    "application/pdf",
  );
  assert.notEqual(
    resolveDtStorageMime("daten.bin", "application/octet-stream"),
    "application/octet-stream",
  );
  console.log("resolve storage mime: ok");
}

function testHelpers() {
  assert.equal(guessDtMimeFromName("tabelle.xlsx").includes("spreadsheet"), true);
  assert.equal(guessDtMimeFromName("seite.html"), "text/html");
  assert.equal(isDtPreviewableMime("text/html", "x.html"), true);
  assert.equal(formatFromFileName("a.PDF"), "pdf");
  assert.equal(ensureFileNameExtension("bericht", "pdf"), "bericht.pdf");
  assert.match(wrapHtmlDocument("<p>Hi</p>"), /<!DOCTYPE html>/);
  assert.equal(toWinAnsiPdfText("Straße — „Test“"), 'Straße - "Test"');
  const merged = mergeCreatedChatFiles(
    [{ fileName: "a.html", mimeType: "text/html", bytes: new Uint8Array([1]) }],
    [{ fileName: "A.html", mimeType: "text/html", bytes: new Uint8Array([2]) }],
  );
  assert.equal(merged.length, 1);
  console.log("helpers: ok");
}

function testPromptMentionsFiles() {
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "Matthias",
      role: "Geschäftsführender Gesellschafter",
      prompt_template: "Du bleibst in der Kundenrolle.",
      kind: "persona",
    },
    org: { display_name: "Westprüfung Kanzlei" },
    mode: "default",
  });
  assert.match(prompt, /create_file/);
  assert.match(prompt, /Angehängte Datei/);
  console.log("system prompt files: ok");
}

async function testPdfExtract() {
  const bytes = await createPdfFromText({
    text: "Sprecher 1: Das Angebot ist zu teuer.\nSprecher 2: Dann machen wir 10 Prozent Rabatt.",
    title: "Transkript",
  });
  const extracted = await extractTextPreviewFromBytes(
    "16.09.2026_Transkript_S.pdf",
    "application/octet-stream",
    bytes,
  );
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.match(extracted.text, /Sprecher 1/);
  assert.match(extracted.text, /zu teuer/);
  assert.match(extracted.text, /10 Prozent Rabatt/);
  assert.doesNotMatch(extracted.text, /ist angehängt \(application\/pdf\)/);
  console.log("pdf extract: ok");
}

function testPlaceholderDetector() {
  assert.equal(
    isDtPlaceholderAttachmentText('[Datei „scan.pdf“ ist angehängt (application/pdf).]'),
    true,
  );
  assert.equal(isDtPlaceholderAttachmentText("Sprecher 1: Hallo"), false);
  assert.equal(isDtPlaceholderAttachmentText(""), true);
  console.log("placeholder detector: ok");
}

function testPdfDocumentBlock() {
  const blocks = bufferToAnthropicBlocks("application/pdf", Buffer.from("%PDF-1.4").toString("base64"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "document");
  const messages = ensureLatestTurnHasMultimodalBlocks(
    [{ role: "user", content: "kannst du die datei lesen?" }],
    [
      {
        fileName: "16.09.2026_Transkript_S.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        dataBase64: Buffer.from("%PDF-1.4 hello").toString("base64"),
      },
    ],
  );
  const last = messages.at(-1);
  assert.equal(last?.role, "user");
  assert.equal(Array.isArray(last?.content), true);
  const types = Array.isArray(last?.content) ? last.content.map((b) => b.type) : [];
  assert.ok(types.includes("text"));
  assert.ok(types.includes("document"));
  console.log("pdf document block: ok");
}

async function testUtf16Transcript() {
  const raw = "Hallo Transkript\nSprecher 1: Das Angebot ist zu teuer.";
  const bytes = Uint8Array.from(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(raw, "utf16le")]));
  const extracted = await extractTextPreviewFromBytes(
    "16.09.2026_Transkript_S.txt",
    "text/plain",
    bytes,
  );
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.match(extracted.text, /Sprecher 1/);
  assert.match(extracted.text, /zu teuer/);
  console.log("utf-16 transcript: ok");
}

function testAttachmentPromptBlock() {
  const withText = formatAttachedFilesForPrompt([
    { fileName: "16.09.2026_Transkript_S.txt", text: "Sprecher 1: Hallo" },
  ]);
  assert.match(withText, /Angehängte Datei: 16\.09\.2026_Transkript_S\.txt/);
  assert.match(withText, /Sprecher 1: Hallo/);
  const withoutText = formatAttachedFilesForPrompt([{ fileName: "notiz.docx", text: "" }]);
  assert.match(withoutText, /Angehängte Datei: notiz\.docx/);
  assert.match(withoutText, /angehängt/);
  console.log("attachment prompt block: ok");
}

async function main() {
  await testExcelExtract();
  await testUnknownBinaryStillAccepted();
  await testWordNotRejectedBySchema();
  await testCreateHtmlAndPdfAndXlsx();
  await testFileFences();
  testHelpers();
  testResolveStorageMime();
  testPromptMentionsFiles();
  testAttachmentPromptBlock();
  await testUtf16Transcript();
  await testPdfExtract();
  testPlaceholderDetector();
  testPdfDocumentBlock();
  console.log("all dt chat file tests passed");
}

void main();
