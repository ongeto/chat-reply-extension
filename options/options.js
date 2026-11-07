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

const DEFAULTS = {
  provider: "gemini",
  model: "gemini-3-flash-preview",
  geminiApiKey: "",
  openaiApiKey: "",
};

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
  const sync = await chrome.storage.sync.get({
    provider: DEFAULTS.provider,
    model: DEFAULTS.model,
    apiKey: "",
    geminiApiKey: DEFAULTS.geminiApiKey,
    openaiApiKey: DEFAULTS.openaiApiKey,
  });
  const local = await chrome.storage.local.get({
    senderProfile: "",
    defaultSenderProfile: "",
  });

  const provider = sync.provider === "openai" ? "openai" : "gemini";
  // Migrate older single apiKey field into geminiApiKey.
  const geminiApiKey = sync.geminiApiKey || sync.apiKey || "";

  els.provider.value = provider;
  els.geminiApiKey.value = geminiApiKey;
  els.openaiApiKey.value = sync.openaiApiKey || "";
  els.model.value = sync.model || DEFAULTS.model;
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

  await chrome.storage.sync.set({
    provider,
    model,
    geminiApiKey,
    openaiApiKey,
    // Keep legacy key mirrored for older installs.
    apiKey: geminiApiKey,
    ollamaBaseUrl: "",
  });

  const localPatch = { defaultSenderProfile };
  const existing = await chrome.storage.local.get({ senderProfile: "" });
  if (!existing.senderProfile?.trim()) {
    localPatch.senderProfile = defaultSenderProfile;
  }
  await chrome.storage.local.set(localPatch);

  return { provider, model, geminiApiKey, openaiApiKey };
}

async function onSave() {
  setError("");
  setStatus("Saving…");
  els.saveBtn.disabled = true;

  try {
    await persistSettings();
    setStatus("Settings saved.");
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
