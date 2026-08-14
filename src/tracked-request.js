// src/tracked-request.js
// Spec: specs/golden-signals-otel-spec.md §4.1/§4.2
//
// SINGLE SOURCE OF TRUTH untuk keputusan "request mana yang di-track" oleh
// observability (metrik golden-signals + access log + trace). Dipakai oleh:
//   - src/server.js → middleware observability (metrik + access log)
//   - src/otel.js   → HttpInstrumentation ignoreIncomingRequestHook (trace)
//   - tests/test-tracked-request.mjs → lock-in perilaku
//
// Aturan (keputusan interview R2 #7): hanya request BISNIS yang di-track —
// /api/* dan halaman *.html. /health (probe Docker HEALTHCHECK + monitoring
// eksternal) dan static assets (public/: css/js/svg/favicon/robots/manifest,
// dst.) di-exclude. Paritas metrik/trace/access-log dijamin BY CONSTRUCTION:
// karena ketiga sinyal memakai fungsi yang sama, request yang di-track oleh
// metrik pasti juga di-track oleh trace (dan sebaliknya) — tidak ada lagi
// aturan duplikat yang bisa melenceng.

// Inti predikat — path string TANPA query: prefix `/api/` atau suffix `.html`.
export function isTrackedPath(path) {
  const p = String(path ?? "");
  return p.startsWith("/api/") || p.endsWith(".html");
}

// Versi untuk raw URL (request.url dari node:http / instrumentation-http):
// query string dipotong dulu sebelum isTrackedPath. req.path Express sudah
// tanpa query, jadi ini menjaga paritas dengan isTrackedRequest() — query
// TIDAK boleh mengubah keputusan: `/health?x=1` → false (tetap tidak
// di-track), `/api/packs?x=1` → true.
export function isTrackedUrl(url) {
  return isTrackedPath(String(url ?? "").split("?")[0]);
}

// Versi untuk Express middleware — req.path sudah URL-decoded + tanpa query.
export function isTrackedRequest(req) {
  return isTrackedPath(req?.path ?? "");
}
