import { logGenerate, logScan, rateUsageLog } from "../shared/usage-log.js";

const els = {
  senderProfile: document.getElementById("senderProfile"),
  recipientProfile: document.getElementById("recipientProfile"),
  keywords: document.getElementById("keywords"),
  tone: document.getElementById("tone"),
  styleMode: document.getElementById("styleMode"),
  conversation: document.getElementById("conversation"),
  reply: document.getElementById("reply"),
  scanBtn: document.getElementById("scanBtn"),
  generateBtn: document.getElementById("generateBtn"),
  copyBtn: document.getElementById("copyBtn"),
  rateGoodBtn: document.getElementById("rateGoodBtn"),
  rateBadBtn: document.getElementById("rateBadBtn"),
  logsBtn: document.getElementById("logsBtn"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
};

const DRAFT_KEYS = [
  "senderProfile",
  "recipientProfile",
  "keywords",
  "tone",
  "styleMode",
  "conversation",
];

let lastGenerateLogId = null;
let lastPageMeta = { pageUrl: "", pageTitle: "" };

init();

async function init() {
  const saved = await chrome.storage.local.get({
    senderProfile: "",
    defaultSenderProfile: "",
    recipientProfile: "",
    keywords: "",
    tone: "professional",
    styleMode: "default",
    conversation: "",
    lastReply: "",
    lastGenerateLogId: "",
  });

  for (const key of DRAFT_KEYS) {
    if (els[key]) els[key].value = saved[key] || "";
  }
  if (!els.senderProfile.value.trim() && saved.defaultSenderProfile) {
    els.senderProfile.value = saved.defaultSenderProfile;
  }
  els.reply.value = saved.lastReply || "";
  els.copyBtn.disabled = !els.reply.value;
  lastGenerateLogId = saved.lastGenerateLogId || null;
  setRatingEnabled(Boolean(lastGenerateLogId && els.reply.value));

  for (const key of DRAFT_KEYS) {
    els[key].addEventListener("change", persistDraft);
    els[key].addEventListener("input", persistDraft);
  }

  els.scanBtn.addEventListener("click", onScan);
  els.generateBtn.addEventListener("click", onGenerate);
  els.copyBtn.addEventListener("click", onCopy);
  els.rateGoodBtn.addEventListener("click", () => onRate("good"));
  els.rateBadBtn.addEventListener("click", () => onRate("bad"));
  els.logsBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("logs/logs.html") });
  });
  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  refreshProviderSubtitle();
}

function setRatingEnabled(enabled) {
  els.rateGoodBtn.disabled = !enabled;
  els.rateBadBtn.disabled = !enabled;
}

async function refreshProviderSubtitle() {
  const el = document.getElementById("providerSubtitle");
  if (!el) return;
  try {
    const info = await chrome.runtime.sendMessage({ type: "GET_PROVIDER_LABEL" });
    if (!info?.ok) return;
    const label = info.provider === "openai" ? "OpenAI" : "Gemini";
    el.textContent = `${label} · ${info.model || "model"}`;
  } catch {
    // keep default subtitle
  }
}

async function persistDraft() {
  const draft = {};
  for (const key of DRAFT_KEYS) draft[key] = els[key].value;
  await chrome.storage.local.set(draft);
}

function setStatus(text) {
  els.error.hidden = true;
  if (!text) {
    els.status.hidden = true;
    els.status.textContent = "";
    return;
  }
  els.status.hidden = false;
  els.status.textContent = text;
}

function setError(text) {
  els.status.hidden = true;
  if (!text) {
    els.error.hidden = true;
    els.error.textContent = "";
    return;
  }
  els.error.hidden = false;
  els.error.textContent = text;
}

async function getActivePageMeta() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return {
      pageUrl: tab?.url || "",
      pageTitle: tab?.title || "",
      tabId: tab?.id || null,
    };
  } catch {
    return { pageUrl: "", pageTitle: "", tabId: null };
  }
}

async function onScan() {
  setError("");
  setStatus("Scanning page…");
  els.scanBtn.disabled = true;

  try {
    const page = await getActivePageMeta();
    lastPageMeta = { pageUrl: page.pageUrl, pageTitle: page.pageTitle };
    if (!page.tabId) throw new Error("No active tab found.");

    let response;
    try {
      response = await chrome.tabs.sendMessage(page.tabId, { type: "EXTRACT_CONTEXT" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: page.tabId },
        files: ["content/content.js"],
      });
      response = await chrome.tabs.sendMessage(page.tabId, { type: "EXTRACT_CONTEXT" });
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Could not read this page.");
    }

    const {
      conversation = "",
      recipientProfile = "",
      keywords = "",
      source = "page",
    } = response.context || {};

    if (!conversation.trim() && !recipientProfile.trim()) {
      throw new Error("Nothing useful found. Open a chat or select messages, then scan again.");
    }

    if (conversation.trim()) {
      els.conversation.value = conversation.trim();
    }
    els.recipientProfile.value = recipientProfile.trim();
    els.keywords.value = keywords.trim();

    await persistDraft();
    await logScan({
      ...lastPageMeta,
      source,
      senderProfile: els.senderProfile.value,
      recipientProfile: els.recipientProfile.value,
      keywords: els.keywords.value,
      conversation: els.conversation.value,
      tone: els.tone.value,
      styleMode: els.styleMode.value,
    });

    const bits = [];
    if (recipientProfile.trim()) bits.push("recipient");
    if (keywords.trim()) bits.push("keywords");
    if (conversation.trim()) bits.push("conversation");
    setStatus(`Scanned ${source}: updated ${bits.join(", ") || "fields"}. Logged.`);
  } catch (error) {
    setError(error?.message || "Scan failed. Select text on the page and retry.");
  } finally {
    els.scanBtn.disabled = false;
  }
}

async function onGenerate() {
  setError("");
  setStatus("Generating reply…");
  els.generateBtn.disabled = true;
  els.copyBtn.disabled = true;
  setRatingEnabled(false);

  const page = await getActivePageMeta();
  lastPageMeta = { pageUrl: page.pageUrl, pageTitle: page.pageTitle };

  const inputSnapshot = {
    senderProfile: els.senderProfile.value,
    recipientProfile: els.recipientProfile.value,
    keywords: els.keywords.value,
    tone: els.tone.value,
    styleMode: els.styleMode.value,
    conversation: els.conversation.value,
  };

  try {
    const info = await chrome.runtime.sendMessage({ type: "GET_PROVIDER_LABEL" });
    if (info?.ok) {
      const label = info.provider === "openai" ? "OpenAI" : "Gemini";
      setStatus(`Generating with ${label} (${info.model})…`);
    }

    await persistDraft();
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_REPLY",
      payload: inputSnapshot,
    });

    if (!response?.ok) {
      const failure = response?.failure || {
        code: "unknown",
        label: "Unknown failure",
        message: response?.error || "Generation failed.",
      };
      await logGenerate({
        ...lastPageMeta,
        provider: response?.provider || info?.provider || "",
        model: response?.model || info?.model || "",
        ...inputSnapshot,
        systemPrompt: response?.systemPrompt || "",
        userPrompt: response?.userPrompt || "",
        reply: failure.rawReply || "",
        error: failure.message,
        failure,
        rawProviderPayload: response?.rawProviderPayload || null,
      });
      setError(`${failure.label}: ${failure.message}`);
      return;
    }

    els.reply.value = response.reply;
    els.copyBtn.disabled = false;

    const log = await logGenerate({
      ...lastPageMeta,
      provider: response.provider || info?.provider || "",
      model: response.model || info?.model || "",
      ...inputSnapshot,
      systemPrompt: response.systemPrompt || "",
      userPrompt: response.userPrompt || "",
      reply: response.reply,
      rawProviderPayload: response.rawProviderPayload || null,
    });
    lastGenerateLogId = log.id;
    await chrome.storage.local.set({
      lastReply: response.reply,
      lastGenerateLogId: log.id,
    });
    setRatingEnabled(true);
    setStatus("Reply ready. Rate it so we can improve quality.");
  } catch (error) {
    const message = error?.message || "Could not generate a reply.";
    await logGenerate({
      ...lastPageMeta,
      ...inputSnapshot,
      reply: "",
      error: message,
      failure: {
        code: "unknown",
        label: "Unknown failure",
        message,
      },
    });
    setError(message);
  } finally {
    els.generateBtn.disabled = false;
  }
}

async function onRate(rating) {
  if (!lastGenerateLogId) {
    setError("Generate a reply first, then rate it.");
    return;
  }
  await rateUsageLog(lastGenerateLogId, rating);
  setStatus(rating === "good" ? "Marked good — logged." : "Marked bad — logged.");
}

async function onCopy() {
  const text = els.reply.value.trim();
  if (!text) {
    setError("Nothing to copy yet. Generate a reply first.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied to clipboard.");
  } catch {
    els.reply.select();
    document.execCommand("copy");
    setStatus("Copied to clipboard.");
  }
}
