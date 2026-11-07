import { DEFAULTS, loadSettings, saveSettings } from "../shared/settings.js";

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

const OPENAI_MODELS = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
  "o4-mini",
];

const els = {
  provider: document.getElementById("provider"),
  geminiApiKey: document.getElementById("geminiApiKey"),
  openaiApiKey: document.getElementById("openaiApiKey"),
  geminiFields: document.getElementById("geminiFields"),
  openaiFields: document.getElementById("openaiFields"),
  model: document.getElementById("model"),
  modelSuggestions: document.getElementById("modelSuggestions"),
  modelHint: document.getElementById("modelHint"),
  defaultSenderProfile: document.getElementById("defaultSenderProfile"),
  saveBtn: document.getElementById("saveBtn"),
  testBtn: document.getElementById("testBtn"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
};

init();

async function init() {
  const settings = await loadSettings();
  const local = await chrome.storage.local.get({
    senderProfile: "",
    defaultSenderProfile: "",
  });

  els.provider.value = settings.provider || DEFAULTS.provider;
  els.geminiApiKey.value = settings.geminiApiKey || "";
  els.openaiApiKey.value = settings.openaiApiKey || "";
  els.model.value = settings.model || DEFAULTS.model;
  els.defaultSenderProfile.value =
    local.defaultSenderProfile || local.senderProfile || "";

  syncProviderUi({ resetModelIfNeeded: false });
  els.provider.addEventListener("change", () =>
    syncProviderUi({ resetModelIfNeeded: true })
  );
  els.saveBtn.addEventListener("click", onSave);
  els.testBtn.addEventListener("click", onTest);
}

function syncProviderUi({ resetModelIfNeeded }) {
  const provider = els.provider.value;
  const isGemini = provider === "gemini";
  els.geminiFields.hidden = !isGemini;
  els.openaiFields.hidden = isGemini;

  const models = isGemini ? GEMINI_MODELS : OPENAI_MODELS;
  els.modelSuggestions.innerHTML = models
    .map((id) => `<option value="${id}"></option>`)
    .join("");
  els.model.placeholder = models[0];
  els.modelHint.textContent = isGemini
    ? "Gemini model id from Google AI Studio."
    : "OpenAI model id from the OpenAI dashboard.";

  if (resetModelIfNeeded) {
    const current = els.model.value.trim();
    const fits =
      (isGemini && current.startsWith("gemini")) ||
      (!isGemini && (current.startsWith("gpt") || current.startsWith("o")));
    if (!fits) els.model.value = models[0];
  }
}

function setStatus(text) {
  els.error.hidden = true;
  els.status.hidden = !text;
  els.status.textContent = text || "";
}

function setError(text) {
  els.status.hidden = true;
  els.error.hidden = !text;
  els.error.textContent = text || "";
}

async function persistSettings() {
  const provider = els.provider.value === "openai" ? "openai" : "gemini";
  const geminiApiKey = els.geminiApiKey.value.trim();
  const openaiApiKey = els.openaiApiKey.value.trim();
  const model = els.model.value.trim();
  const defaultSenderProfile = els.defaultSenderProfile.value.trim();

  if (!model) {
    throw new Error(
      provider === "gemini"
        ? "Enter a Gemini model id."
        : "Enter an OpenAI model id."
    );
  }

  if (provider === "gemini" && !geminiApiKey) {
    throw new Error("Paste a Gemini API key, or switch provider to OpenAI.");
  }
  if (provider === "openai" && !openaiApiKey) {
    throw new Error("Paste an OpenAI API key, or switch provider to Gemini.");
  }

  // Preserve the other provider's key from storage if that field was empty in the UI
  // (e.g. user only filled the active provider).
  const existing = await loadSettings();
  const saved = await saveSettings({
    provider,
    model,
    geminiApiKey: geminiApiKey || existing.geminiApiKey,
    openaiApiKey: openaiApiKey || existing.openaiApiKey,
  });

  // Reflect preserved keys back into the form so reload doesn't look blank.
  els.geminiApiKey.value = saved.geminiApiKey;
  els.openaiApiKey.value = saved.openaiApiKey;

  const localPatch = { defaultSenderProfile };
  const existingLocal = await chrome.storage.local.get({ senderProfile: "" });
  if (!existingLocal.senderProfile?.trim()) {
    localPatch.senderProfile = defaultSenderProfile;
  }
  await chrome.storage.local.set(localPatch);

  return saved;
}

async function onSave() {
  setError("");
  setStatus("Saving…");
  els.saveBtn.disabled = true;

  try {
    await persistSettings();
    setStatus("Settings saved on this browser.");
  } catch (error) {
    setError(error?.message || "Could not save settings.");
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function onTest() {
  setError("");
  setStatus("Testing connection…");
  els.testBtn.disabled = true;

  try {
    const saved = await persistSettings();
    setStatus(
      saved.provider === "openai" ? "Testing OpenAI…" : "Testing Gemini…"
    );
    const response = await chrome.runtime.sendMessage({ type: "TEST_PROVIDER" });
    if (!response?.ok) {
      throw new Error(response?.error || "Connection test failed.");
    }
    setStatus(response.message || "Connected.");
  } catch (error) {
    setError(error?.message || "Connection test failed.");
  } finally {
    els.testBtn.disabled = false;
  }
}
