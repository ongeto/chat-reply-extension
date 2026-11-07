const LOG_KEY = "usageLogs";
const MAX_LOGS = 200;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function getUsageLogs() {
  const { [LOG_KEY]: logs = [] } = await chrome.storage.local.get({ [LOG_KEY]: [] });
  return Array.isArray(logs) ? logs : [];
}

async function saveLogs(logs) {
  await chrome.storage.local.set({ [LOG_KEY]: logs.slice(0, MAX_LOGS) });
}

export async function appendUsageLog(entry) {
  const logs = await getUsageLogs();
  const record = {
    id: makeId(),
    at: new Date().toISOString(),
    ...entry,
  };
  logs.unshift(record);
  await saveLogs(logs);
  return record;
}

export async function logScan({
  pageUrl = "",
  pageTitle = "",
  source = "",
  senderProfile = "",
  recipientProfile = "",
  keywords = "",
  conversation = "",
  tone = "",
  styleMode = "",
}) {
  return appendUsageLog({
    type: "scan",
    status: "ok",
    pageUrl,
    pageTitle,
    source,
    input: {
      senderProfile,
      recipientProfile,
      keywords,
      conversation,
      tone,
      styleMode,
    },
  });
}

export async function logGenerate({
  pageUrl = "",
  pageTitle = "",
  provider = "",
  model = "",
  senderProfile = "",
  recipientProfile = "",
  keywords = "",
  conversation = "",
  tone = "",
  styleMode = "",
  systemPrompt = "",
  userPrompt = "",
  reply = "",
  error = "",
  failure = null,
  rawProviderPayload = null,
}) {
  const failed = Boolean(error || failure);
  return appendUsageLog({
    type: "generate",
    status: failed ? "error" : "ok",
    pageUrl,
    pageTitle,
    provider,
    model,
    input: {
      senderProfile,
      recipientProfile,
      keywords,
      conversation,
      tone,
      styleMode,
    },
    prompts: {
      systemPrompt,
      userPrompt,
    },
    output: {
      reply: reply || "",
      error: error || failure?.message || null,
    },
    failure: failure
      ? {
          code: failure.code,
          label: failure.label,
          message: failure.message,
          status: failure.status ?? null,
          finishReason: failure.finishReason || null,
          rawReply: failure.rawReply || null,
        }
      : null,
    rawProviderPayload,
    rating: null,
    notes: "",
  });
}

export async function rateUsageLog(id, rating, notes = "") {
  const logs = await getUsageLogs();
  const next = logs.map((log) => {
    if (log.id !== id) return log;
    return {
      ...log,
      rating,
      notes: notes || log.notes || "",
      ratedAt: new Date().toISOString(),
    };
  });
  await saveLogs(next);
}

export async function clearUsageLogs() {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}

export function downloadUsageLogsJson(logs) {
  const blob = new Blob([JSON.stringify(logs, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reply-assistant-logs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function summarizeFailures(logs) {
  const failures = logs.filter((l) => l.type === "generate" && l.status === "error");
  const byCode = {};
  for (const log of failures) {
    const code = log.failure?.code || "unknown";
    byCode[code] = (byCode[code] || 0) + 1;
  }
  return { total: failures.length, byCode };
}
