import {
  clearUsageLogs,
  downloadUsageLogsJson,
  getUsageLogs,
  rateUsageLog,
  summarizeFailures,
} from "../shared/usage-log.js";

const listEl = document.getElementById("list");
const summaryEl = document.getElementById("summary");

document.getElementById("refreshBtn").addEventListener("click", render);
document.getElementById("exportBtn").addEventListener("click", onExport);
document.getElementById("clearBtn").addEventListener("click", onClear);

render();

async function render() {
  const logs = await getUsageLogs();
  const scans = logs.filter((l) => l.type === "scan").length;
  const generates = logs.filter((l) => l.type === "generate").length;
  const errors = logs.filter((l) => l.type === "generate" && l.status === "error").length;
  const good = logs.filter((l) => l.rating === "good").length;
  const bad = logs.filter((l) => l.rating === "bad").length;
  const failureSummary = summarizeFailures(logs);
  const failureBits = Object.entries(failureSummary.byCode)
    .map(([code, count]) => `${code}:${count}`)
    .join(" · ");

  summaryEl.textContent = logs.length
    ? `${logs.length} entries · ${scans} scans · ${generates} generates · ${errors} failures · ${good} good · ${bad} bad` +
      (failureBits ? ` | ${failureBits}` : "")
    : "No logs yet. Scan a page or generate a reply in the extension popup.";

  if (!logs.length) {
    listEl.innerHTML = `<div class="empty">Logs will appear here after you use Scan page or Generate reply.</div>`;
    return;
  }

  listEl.innerHTML = logs.map(renderCard).join("");
  listEl.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const rating = btn.getAttribute("data-rate");
      const notes =
        listEl.querySelector(`textarea[data-notes-id="${id}"]`)?.value?.trim() || "";
      await rateUsageLog(id, rating, notes);
      await render();
    });
  });
}

function renderCard(log) {
  const when = escapeHtml(formatTime(log.at));
  const page = escapeHtml(log.pageUrl || log.pageTitle || "—");
  const provider = [log.provider, log.model].filter(Boolean).join(" · ");
  const ratingBadge = log.rating
    ? `<span class="badge ${log.rating}">${escapeHtml(log.rating)}</span>`
    : "";
  const failBadge =
    log.status === "error"
      ? `<span class="badge bad">${escapeHtml(log.failure?.label || "failure")}</span>`
      : "";

  const input = log.input || {};
  const blocks = [
    block("Style / tone", [input.styleMode, input.tone].filter(Boolean).join(" · ")),
    block("Recipient", input.recipientProfile),
    block("Keywords", input.keywords),
    block("Conversation", input.conversation),
    block("Sender", input.senderProfile),
  ];

  if (log.type === "generate") {
    if (log.status === "error") {
      blocks.push(
        block(
          "Failure",
          [
            log.failure?.code || "unknown",
            log.failure?.label || "",
            log.failure?.message || log.output?.error || "",
            log.failure?.finishReason ? `finishReason=${log.failure.finishReason}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        )
      );
      if (log.failure?.rawReply) {
        blocks.push(block("Model refusal text", log.failure.rawReply));
      }
    } else {
      blocks.push(block("Reply", log.output?.reply || ""));
    }
    if (log.prompts?.userPrompt) {
      blocks.push(block("Prompt sent to model", log.prompts.userPrompt));
    }
  }

  const rateRow =
    log.type === "generate"
      ? `<div class="actions">
          <button type="button" class="btn tiny secondary" data-rate="good" data-id="${escapeAttr(log.id)}">Mark good</button>
          <button type="button" class="btn tiny danger" data-rate="bad" data-id="${escapeAttr(log.id)}">Mark bad</button>
          <textarea class="notes" data-notes-id="${escapeAttr(log.id)}" rows="2" placeholder="Optional note: what was wrong or what a good reply should have said">${escapeHtml(log.notes || "")}</textarea>
        </div>`
      : "";

  return `<article class="card">
    <div class="meta">
      <span class="badge ${escapeAttr(log.type)}">${escapeHtml(log.type)}</span>
      ${failBadge}
      ${ratingBadge}
      <span>${when}</span>
      ${provider ? `<span>${escapeHtml(provider)}</span>` : ""}
      <span title="${page}">${truncate(page, 80)}</span>
    </div>
    ${blocks.join("")}
    ${rateRow}
  </article>`;
}

function block(title, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<div class="block"><h3>${escapeHtml(title)}</h3><pre>${escapeHtml(text)}</pre></div>`;
}

async function onExport() {
  const logs = await getUsageLogs();
  downloadUsageLogsJson(logs);
}

async function onClear() {
  if (!confirm("Clear all usage logs on this browser?")) return;
  await clearUsageLogs();
  await render();
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
