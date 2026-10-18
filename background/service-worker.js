const DEFAULT_MODEL = "gemini-2.0-flash";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GENERATE_REPLY") {
    generateReply(message.payload)
      .then((reply) => sendResponse({ ok: true, reply }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "Failed to generate reply.",
        })
      );
    return true;
  }
  return false;
});

async function generateReply(payload) {
  const { apiKey, model } = await chrome.storage.sync.get({
    apiKey: "",
    model: DEFAULT_MODEL,
  });

  if (!apiKey) {
    throw new Error("Add your Gemini API key in Settings first.");
  }

  const modelId = (model || DEFAULT_MODEL).trim();
  if (!modelId) {
    throw new Error("Set a Gemini model name in Settings (e.g. gemini-2.0-flash).");
  }

  const {
    senderProfile = "",
    recipientProfile = "",
    keywords = "",
    conversation = "",
    tone = "professional",
  } = payload || {};

  if (!conversation.trim()) {
    throw new Error("Scan the page (or paste conversation history) before generating.");
  }

  const systemPrompt = [
    "You write short, natural message replies for ongoing chats.",
    "Use the sender profile as the voice and goals of the person who will send the reply.",
    "Use the recipient profile to tailor relevance and tone.",
    "Honour the chat keywords as themes, offers, or points that should appear when relevant.",
    "Reply only with the message text ready to paste. No quotes, labels, or markdown fences.",
    "Keep replies concise and conversational unless the history calls for more detail.",
  ].join(" ");

  const userPrompt = [
    `Tone preference: ${tone}`,
    "",
    "Sender profile (who is writing the reply):",
    senderProfile.trim() || "(not provided)",
    "",
    "Recipient profile (who will receive the reply):",
    recipientProfile.trim() || "(not provided)",
    "",
    "Chat keywords / themes to lean on:",
    keywords.trim() || "(none)",
    "",
    "Conversation history (oldest to newest):",
    conversation.trim(),
    "",
    "Write the next reply from the sender.",
  ].join("\n");

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.error?.status ||
      `Gemini error (${response.status})`;
    throw new Error(detail);
  }

  const reply = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();

  if (!reply) {
    const blocked = data?.candidates?.[0]?.finishReason;
    if (blocked && blocked !== "STOP") {
      throw new Error(`Gemini blocked the reply (${blocked}). Try different context.`);
    }
    throw new Error("Gemini returned an empty reply.");
  }

  return reply;
}
