const DEFAULT_MODEL = "gemini-2.0-flash";

const els = {
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  defaultSenderProfile: document.getElementById("defaultSenderProfile"),
  saveBtn: document.getElementById("saveBtn"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
};

init();

async function init() {
  const sync = await chrome.storage.sync.get({
    apiKey: "",
    model: DEFAULT_MODEL,
  });
  const local = await chrome.storage.local.get({
    senderProfile: "",
    defaultSenderProfile: "",
  });

  els.apiKey.value = sync.apiKey || "";
  els.model.value = sync.model || DEFAULT_MODEL;
  els.defaultSenderProfile.value =
    local.defaultSenderProfile || local.senderProfile || "";

  els.saveBtn.addEventListener("click", onSave);
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

async function onSave() {
  setError("");
  setStatus("Saving…");
  els.saveBtn.disabled = true;

  try {
    const apiKey = els.apiKey.value.trim();
    const model = els.model.value.trim();
    const defaultSenderProfile = els.defaultSenderProfile.value.trim();

    if (!apiKey) {
      throw new Error("Paste a Gemini API key before saving.");
    }
    if (!model) {
      throw new Error("Enter a Gemini model id (e.g. gemini-2.0-flash).");
    }

    await chrome.storage.sync.set({ apiKey, model });

    const localPatch = { defaultSenderProfile };
    const existing = await chrome.storage.local.get({ senderProfile: "" });
    if (!existing.senderProfile?.trim()) {
      localPatch.senderProfile = defaultSenderProfile;
    }
    await chrome.storage.local.set(localPatch);

    setStatus("Settings saved.");
  } catch (error) {
    setError(error?.message || "Could not save settings.");
  } finally {
    els.saveBtn.disabled = false;
  }
}
