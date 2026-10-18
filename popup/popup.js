const els = {
  senderProfile: document.getElementById("senderProfile"),
  recipientProfile: document.getElementById("recipientProfile"),
  keywords: document.getElementById("keywords"),
  tone: document.getElementById("tone"),
  conversation: document.getElementById("conversation"),
  reply: document.getElementById("reply"),
  scanBtn: document.getElementById("scanBtn"),
  generateBtn: document.getElementById("generateBtn"),
  copyBtn: document.getElementById("copyBtn"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
};

const DRAFT_KEYS = [
  "senderProfile",
  "recipientProfile",
  "keywords",
  "tone",
  "conversation",
];

init();

async function init() {
  const saved = await chrome.storage.local.get({
    senderProfile: "",
    defaultSenderProfile: "",
    recipientProfile: "",
    keywords: "",
    tone: "professional",
    conversation: "",
    lastReply: "",
  });

  for (const key of DRAFT_KEYS) {
    if (els[key]) els[key].value = saved[key] || "";
  }
  if (!els.senderProfile.value.trim() && saved.defaultSenderProfile) {
    els.senderProfile.value = saved.defaultSenderProfile;
  }
  els.reply.value = saved.lastReply || "";
  els.copyBtn.disabled = !els.reply.value;

  for (const key of DRAFT_KEYS) {
    els[key].addEventListener("change", persistDraft);
    els[key].addEventListener("input", persistDraft);
  }

  els.scanBtn.addEventListener("click", onScan);
  els.generateBtn.addEventListener("click", onGenerate);
  els.copyBtn.addEventListener("click", onCopy);
  document.getElementById("settingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
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

async function onScan() {
  setError("");
  setStatus("Scanning page…");
  els.scanBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTEXT" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"],
      });
      response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTEXT" });
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
    // Always overwrite auto-fetched fields on scan
    els.recipientProfile.value = recipientProfile.trim();
    els.keywords.value = keywords.trim();

    await persistDraft();

    const bits = [];
    if (recipientProfile.trim()) bits.push("recipient");
    if (keywords.trim()) bits.push("keywords");
    if (conversation.trim()) bits.push("conversation");
    setStatus(`Scanned ${source}: updated ${bits.join(", ") || "fields"}.`);
  } catch (error) {
    setError(error?.message || "Scan failed. Select text on the page and retry.");
  } finally {
    els.scanBtn.disabled = false;
  }
}

async function onGenerate() {
  setError("");
  setStatus("Generating reply with Gemini…");
  els.generateBtn.disabled = true;
  els.copyBtn.disabled = true;

  try {
    await persistDraft();
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_REPLY",
      payload: {
        senderProfile: els.senderProfile.value,
        recipientProfile: els.recipientProfile.value,
        keywords: els.keywords.value,
        tone: els.tone.value,
        conversation: els.conversation.value,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Generation failed.");
    }

    els.reply.value = response.reply;
    els.copyBtn.disabled = false;
    await chrome.storage.local.set({ lastReply: response.reply });
    setStatus("Reply ready.");
  } catch (error) {
    setError(error?.message || "Could not generate a reply.");
  } finally {
    els.generateBtn.disabled = false;
  }
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
