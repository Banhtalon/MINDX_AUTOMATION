import { config, getDynamicAdminConfig } from "../config";

const ENV_SECRET_KEY_RE = /(?:password|passwd|api_?key|secret|token)/i;

function collectActiveSecrets(extraSecrets?: string[]): string[] {
  const rawSet = new Set<string>();
  const adminCfg = getDynamicAdminConfig();

  const staticCandidates = [
    config.teachingPassword,
    config.lmsPassword,
    config.adminLmsPassword,
    config.adminTeachingPassword,
    config.geminiApiKey,
    adminCfg.adminLmsPassword,
    adminCfg.adminTeachingPassword,
  ];
  for (const val of staticCandidates) {
    if (typeof val === "string" && val.length >= 4) {
      rawSet.add(val);
    }
  }

  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && v.length >= 4 && ENV_SECRET_KEY_RE.test(k)) {
      rawSet.add(v);
    }
  }

  if (Array.isArray(extraSecrets)) {
    for (const val of extraSecrets) {
      if (typeof val === "string" && val.length >= 4) {
        rawSet.add(val);
      }
    }
  }

  const expanded = new Set<string>();
  for (const secret of rawSet) {
    expanded.add(secret);
    try {
      const encoded = encodeURIComponent(secret);
      if (encoded && encoded.length >= 4) expanded.add(encoded);
    } catch {
      // ignore URI encode issues
    }
    try {
      const jsonEscaped = JSON.stringify(secret).slice(1, -1);
      if (jsonEscaped && jsonEscaped.length >= 4) expanded.add(jsonEscaped);
    } catch {
      // ignore JSON stringify issues
    }
  }

  // Sort longest first so shorter substrings do not partially mask longer secrets
  return Array.from(expanded).sort((a, b) => b.length - a.length);
}

/**
 * Redacts configured passwords, API keys, auth headers, and token query params
 * from error messages, logs, and API responses.
 */
export function redactSecrets(input: unknown, extraSecrets?: string[]): string {
  let text =
    input === null || input === undefined
      ? ""
      : typeof input === "string"
        ? input
        : input instanceof Error
          ? input.message || String(input)
          : String(input);

  if (!text) return "";

  const secrets = collectActiveSecrets(extraSecrets);
  for (const secret of secrets) {
    if (text.includes(secret)) {
      text = text.split(secret).join("[REDACTED]");
    }
  }

  text = text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .replace(/(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:password|passwd|pwd|token|api_?key|access_token|id_token|refresh_token)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(PHPSESSID\s*=\s*)[^;\s"']+/gi, "$1[REDACTED]")
    .replace(
      /("(?:password|adminLmsPassword|adminTeachingPassword|teachingPassword|lmsPassword|geminiApiKey|apiKey|accessToken|refreshToken|idToken)"\s*:\s*")[^"]*"/gi,
      '$1[REDACTED]"'
    );

  return text;
}

/**
 * Extracts and redacts a human-safe error string from any thrown value.
 */
export function sanitizeErrorMessage(err: unknown, extraSecrets?: string[]): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  return redactSecrets(raw, extraSecrets);
}

/**
 * Returns an Error instance with redacted message and sanitized stack trace.
 */
export function sanitizeError(err: unknown, extraSecrets?: string[]): Error {
  const safeMsg = sanitizeErrorMessage(err, extraSecrets);
  const clean = new Error(safeMsg);
  if (err instanceof Error && err.stack) {
    clean.stack = redactSecrets(err.stack, extraSecrets);
  }
  return clean;
}
