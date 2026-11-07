const DEFAULTS = {
  provider: "gemini",
  model: "gemini-3-flash-preview",
  geminiApiKey: "",
  openaiApiKey: "",
};

/**
 * Prefer chrome.storage.local for API keys/settings.
 * sync is unreliable in many antidetect / unpacked setups and can look "cleared" on reload.
 */
export async function loadSettings() {
  const [local, sync] = await Promise.all([
    chrome.storage.local.get({
      provider: "",
      model: "",
      geminiApiKey: "",
      openaiApiKey: "",
      apiKey: "",
    }),
    chrome.storage.sync.get({
      provider: "",
      model: "",
      geminiApiKey: "",
      openaiApiKey: "",
      apiKey: "",
    }),
  ]);

  const geminiApiKey =
    local.geminiApiKey || local.apiKey || sync.geminiApiKey || sync.apiKey || "";
  const openaiApiKey = local.openaiApiKey || sync.openaiApiKey || "";
  const providerRaw = local.provider || sync.provider || DEFAULTS.provider;
  const provider = providerRaw === "openai" ? "openai" : "gemini";
  const model = local.model || sync.model || DEFAULTS.model;

  const settings = {
    provider,
    model,
    geminiApiKey,
    openaiApiKey,
    apiKey: provider === "openai" ? openaiApiKey : geminiApiKey,
  };

  // One-time migration: copy sync → local if local is empty.
  const localEmpty =
    !local.geminiApiKey && !local.openaiApiKey && !local.apiKey && !local.model;
  const syncHasData = Boolean(
    sync.geminiApiKey || sync.openaiApiKey || sync.apiKey || sync.model
  );
  if (localEmpty && syncHasData) {
    await chrome.storage.local.set({
      provider: settings.provider,
      model: settings.model,
      geminiApiKey: settings.geminiApiKey,
      openaiApiKey: settings.openaiApiKey,
      apiKey: settings.apiKey,
    });
  }

  return settings;
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const next = {
    provider:
      partial.provider === "openai" || partial.provider === "gemini"
        ? partial.provider
        : current.provider,
    model: String(partial.model ?? current.model).trim(),
    geminiApiKey: String(partial.geminiApiKey ?? current.geminiApiKey).trim(),
    openaiApiKey: String(partial.openaiApiKey ?? current.openaiApiKey).trim(),
  };
  next.apiKey = next.provider === "openai" ? next.openaiApiKey : next.geminiApiKey;

  await chrome.storage.local.set({
    provider: next.provider,
    model: next.model,
    geminiApiKey: next.geminiApiKey,
    openaiApiKey: next.openaiApiKey,
    apiKey: next.apiKey,
  });

  try {
    await chrome.storage.sync.set({
      provider: next.provider,
      model: next.model,
      geminiApiKey: next.geminiApiKey,
      openaiApiKey: next.openaiApiKey,
      apiKey: next.apiKey,
      ollamaBaseUrl: "",
    });
  } catch {
    // sync quota / disabled — local is enough
  }

  return next;
}

export { DEFAULTS };
