/**
 * Classify generate failures so logs show why a run failed.
 * This is for observability — not for bypassing model safety systems.
 */

const REFUSAL_PATTERNS = [
  /\bi\s*(can('t|not)|won'?t|unable to)\b.{0,40}\b(help|assist|comply|generate|write|engage)/i,
  /\bas an ai\b/i,
  /\b(against|violat(e|es|ing))\b.{0,40}\b(guidelines|policy|policies|rules)/i,
  /\bcontent\s+(policy|filter|moderation)\b/i,
  /\bi\s*must\s*refuse\b/i,
  /\bnot\s+able\s+to\s+(continue|engage|discuss)\b/i,
  /\binappropriate\b.{0,30}\b(request|content)\b/i,
  /\bsafety\s+(filter|system|policy)\b/i,
  /\bblocked\b.{0,20}\b(request|content|prompt)\b/i,
];

export function looksLikeModelRefusal(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.length > 1200) return false;
  return REFUSAL_PATTERNS.some((re) => re.test(value));
}

export function classifyFailure(errorOrMessage, extras = {}) {
  const message = String(
    typeof errorOrMessage === "string"
      ? errorOrMessage
      : errorOrMessage?.message || errorOrMessage || "Unknown error"
  ).trim();
  const lower = message.toLowerCase();
  const status = extras.status;
  const finishReason = String(extras.finishReason || "").toUpperCase();
  const rawReply = extras.rawReply || "";

  if (extras.code) {
    return finalize(extras.code, message, extras);
  }

  if (/morelogin|black_whitelist_stop_page/i.test(message)) {
    return finalize("browser_local_block", message, extras);
  }

  if (
    /cannot reach ollama|failed to fetch|network error|timed out|econnrefused|unreachable/i.test(
      message
    )
  ) {
    return finalize("model_unavailable", message, extras);
  }

  if (/model .* not found|unknown model|pull .* first|no models are installed/i.test(message)) {
    return finalize("model_missing", message, extras);
  }

  if (status === 403 || /ollama blocked|403/.test(lower)) {
    return finalize("provider_forbidden", message, extras);
  }

  if (
    finishReason === "SAFETY" ||
    finishReason === "BLOCKLIST" ||
    finishReason === "PROHIBITED_CONTENT" ||
    finishReason === "RECITATION" ||
    /blocked the reply|safety|finishreason/i.test(message)
  ) {
    return finalize("provider_safety_block", message, {
      ...extras,
      finishReason,
    });
  }

  if (looksLikeModelRefusal(rawReply) || looksLikeModelRefusal(message)) {
    return finalize("model_refusal", message || "Model refused to answer.", {
      ...extras,
      rawReply: rawReply || message,
    });
  }

  if (/empty reply|returned an empty/i.test(message)) {
    return finalize("empty_output", message, extras);
  }

  if (/scan the page|conversation history|nothing useful/i.test(message)) {
    return finalize("bad_input", message, extras);
  }

  if (/api key|gemini api/i.test(message)) {
    return finalize("config_error", message, extras);
  }

  return finalize("unknown", message, extras);
}

function finalize(code, message, extras = {}) {
  return {
    code,
    label: failureLabel(code),
    message,
    status: extras.status ?? null,
    finishReason: extras.finishReason || null,
    rawReply: extras.rawReply || null,
    provider: extras.provider || null,
    model: extras.model || null,
  };
}

export function failureLabel(code) {
  switch (code) {
    case "model_unavailable":
      return "Model unavailable / connection";
    case "model_missing":
      return "Model not installed";
    case "provider_forbidden":
      return "Provider forbidden (403)";
    case "provider_safety_block":
      return "Provider safety block";
    case "model_refusal":
      return "Model refusal / guardrail";
    case "empty_output":
      return "Empty model output";
    case "bad_input":
      return "Missing / weak input";
    case "browser_local_block":
      return "Browser blocked localhost";
    case "config_error":
      return "Config error";
    default:
      return "Unknown failure";
  }
}

export class GenerateFailure extends Error {
  constructor(message, extras = {}) {
    const classified = classifyFailure(message, extras);
    super(classified.message);
    this.name = "GenerateFailure";
    this.failure = classified;
  }
}
