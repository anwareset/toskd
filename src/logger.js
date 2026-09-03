// src/logger.js
//
// Pino structured-JSON logger untuk toskd:
//   - field `service: "toskd"` di setiap log
//   - pino-redact untuk data sensitif (password/token/cookie/authorization/
//     request body/jawaban ujian) — defense-in-depth di atas disiplin manual
//   - transport pino-pretty (human-readable) HANYA di luar production;
//     di container prod output JSON murni ke stdout
//   - trace_id/span_id di-inject otomatis oleh @opentelemetry/instrumentation-pino
//     (terdaftar di src/otel.js — module ini HARUS di-import SETELAH otel.js)
import pino from "pino";

// Daftar path yang disensor pino-redact. `*.x` = key bernama x di kedalaman
// mana pun; `req.headers.cookie` = path nested eksplisit. Nilai yang cocok
// diganti [REDACTED] saat serialisasi.
export const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "cookie",
  "*.cookie",
  "req.headers.cookie",
  "authorization",
  "*.authorization",
  "req.headers.authorization",
  "body",
  "*.body",
  "answers",
  "*.answers",
  "*.options",
];

// Normalisasi error apa pun (Error instance, objek PostgREST, string) ke
// bentuk { type, code, message, stack, cause } sesuai contoh log spec §12.2
// (+ cause: Node fetch error menyimpan penyebab jaringan di `err.cause` —
// tanpa ini log fetch/Supabase hanya "fetch failed" tanpa akar masalah).
export function errorField(err) {
  if (err == null) {
    return { type: null, code: null, message: null, stack: null, cause: null };
  }
  if (typeof err === "string") {
    return { type: "Error", code: null, message: err, stack: null, cause: null };
  }
  return {
    type: err?.name || "Error",
    code: err?.code ?? null,
    message: err?.message ?? String(err),
    stack: err?.stack ?? null,
    cause: err?.cause?.message ?? null,
  };
}

// Factory supaya test bisa membuat logger terisolasi (stream sink, tanpa
// transport). Production memakai singleton di bawah (stdout).
export function createLogger({ level, destination, pretty = false } = {}) {
  const opts = {
    level: level || process.env.LOG_LEVEL || "info",
    base: { service: "toskd" },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };
  if (pretty) {
    opts.transport = {
      target: "pino-pretty",
      options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
    };
  }
  if (destination) return pino(opts, destination);
  return pino(opts);
}

const isProd = process.env.NODE_ENV?.toLowerCase() === "production";

// Singleton yang dipakai seluruh src/server.js. Prod → JSON murni ke stdout
// (docker logs); dev → human-readable via pino-pretty.
export const logger = createLogger({ pretty: !isProd });
