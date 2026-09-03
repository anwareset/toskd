// Lock-in SINGLE SOURCE OF TRUTH keputusan tracking request observability. Modul bersama
// src/tracked-request.js dipakai oleh middleware metrik/access-log di
// server.js (isTrackedRequest) DAN hook trace di otel.js (isTrackedUrl).
// Test ini mengunci aturan: hanya /api/* + *.html yang di-track; /health,
// static, dan path lain TIDAK di-track — dengan query string yang TIDAK
// boleh mengubah keputusan.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTrackedPath,
  isTrackedUrl,
  isTrackedRequest,
} from "../src/tracked-request.js";

test("isTrackedPath: /api/* dan *.html di-track", () => {
  assert.equal(isTrackedPath("/api/packs"), true);
  assert.equal(isTrackedPath("/api/packs/123"), true);
  assert.equal(isTrackedPath("/api/exam/submit"), true);
  assert.equal(isTrackedPath("/api/questions/bulk"), true);
  assert.equal(isTrackedPath("/index.html"), true);
  assert.equal(isTrackedPath("/bank-soal.html"), true);
  assert.equal(isTrackedPath("/paket-detail.html"), true);
});

test("isTrackedPath: /health, static, dan path lain TIDAK di-track", () => {
  assert.equal(isTrackedPath("/health"), false);
  assert.equal(isTrackedPath("/css/tokens.css"), false);
  assert.equal(isTrackedPath("/js/theme.js"), false);
  assert.equal(isTrackedPath("/favicon.ico"), false);
  assert.equal(isTrackedPath("/robots.txt"), false);
  assert.equal(isTrackedPath("/manifest.json"), false);
  assert.equal(isTrackedPath("/"), false);
  assert.equal(isTrackedPath("/wp-json/"), false);
  // /api tanpa trailing slash = bukan route (prefix harus /api/)
  assert.equal(isTrackedPath("/api"), false);
});

test("isTrackedPath: defensive terhadap null/undefined", () => {
  assert.equal(isTrackedPath(undefined), false);
  assert.equal(isTrackedPath(null), false);
  assert.equal(isTrackedPath(""), false);
});

test("isTrackedUrl: query string tidak mengubah keputusan", () => {
  assert.equal(isTrackedUrl("/api/packs?page=2"), true);
  assert.equal(isTrackedUrl("/index.html?next=/bank-soal.html"), true);
  assert.equal(isTrackedUrl("/health?x=1"), false);
  assert.equal(isTrackedUrl("/css/tokens.css?v=123"), false);
  assert.equal(isTrackedUrl("/api/packs"), true);
  assert.equal(isTrackedUrl("/health"), false);
  assert.equal(isTrackedUrl(""), false);
});

test("paritas: ketiga fungsi memutuskan SAMA untuk kasus representatif", () => {
  // Janji refactor: metrik (req.path), trace (url), dan access log sepakat
  // memutuskan — paritas by construction, bukan kebetulan implementasi.
  const cases = [
    { url: "/api/packs?page=2", path: "/api/packs", expected: true },
    { url: "/index.html?next=/login", path: "/index.html", expected: true },
    { url: "/health?x=1", path: "/health", expected: false },
    { url: "/css/tokens.css?v=1", path: "/css/tokens.css", expected: false },
  ];
  for (const { url, path, expected } of cases) {
    assert.equal(isTrackedUrl(url), expected, `isTrackedUrl(${url})`);
    assert.equal(isTrackedPath(path), expected, `isTrackedPath(${path})`);
    assert.equal(
      isTrackedRequest({ path }),
      expected,
      `isTrackedRequest(${path})`,
    );
  }
});

test("isTrackedRequest: express req.path (tanpa query, sudah URL-decoded)", () => {
  assert.equal(isTrackedRequest({ path: "/api/packs" }), true);
  assert.equal(isTrackedRequest({ path: "/bank-soal.html" }), true);
  assert.equal(isTrackedRequest({ path: "/health" }), false);
  assert.equal(isTrackedRequest({ path: "/css/styles.css" }), false);
  // req tanpa path (defensive) → false, tidak throw
  assert.equal(isTrackedRequest({}), false);
  assert.equal(isTrackedRequest(undefined), false);
});
