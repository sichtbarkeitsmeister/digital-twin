import assert from "node:assert/strict";

import { checkSafePublicUrl, isBlockedFetchHost } from "../lib/shared/safe-fetch-url";

function testBlockedHosts() {
  const blocked = [
    "localhost",
    "app.localhost",
    "service.internal",
    "printer.local",
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "::1",
    "10.0.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "fd00::1",
    "fe80::1",
  ];
  for (const host of blocked) {
    assert.equal(isBlockedFetchHost(host), true, `sollte blockiert sein: ${host}`);
  }

  const allowed = ["example.de", "www.example.de", "172.32.0.1", "8.8.8.8", "sub.domain.co.uk"];
  for (const host of allowed) {
    assert.equal(isBlockedFetchHost(host), false, `sollte erlaubt sein: ${host}`);
  }
  console.log("blocked hosts: ok");
}

function testSafeUrlCheck() {
  assert.equal(checkSafePublicUrl("https://example.de/seite").ok, true);
  assert.equal(checkSafePublicUrl("http://example.de").ok, true);

  // Cloud metadata endpoint — the case that matters for prompt injection.
  const metadata = checkSafePublicUrl("http://169.254.169.254/latest/meta-data/");
  assert.equal(metadata.ok, false);

  assert.equal(checkSafePublicUrl("http://localhost:3000/api/dt/seo/tasks").ok, false);
  assert.equal(checkSafePublicUrl("file:///etc/passwd").ok, false);
  assert.equal(checkSafePublicUrl("ftp://example.de/x").ok, false);
  assert.equal(checkSafePublicUrl("nicht-mal-eine-url").ok, false);
  assert.equal(checkSafePublicUrl("   ").ok, false);
  console.log("safe url check: ok");
}

testBlockedHosts();
testSafeUrlCheck();
console.log("All safe-fetch-url tests passed.");
