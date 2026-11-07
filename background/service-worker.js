import {
  GenerateFailure,
  classifyFailure,
  looksLikeModelRefusal,
} from "../shared/failure.js";
import { loadSettings } from "../shared/settings.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GENERATE_REPLY") {
    generateReply(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        const failure =
          error?.failure ||
          classifyFailure(error?.message || "Failed to generate reply.", {
            provider: error?.failure?.provider,
            model: error?.failure?.model,
            rawReply: error?.failure?.rawReply,
            finishReason: error?.failure?.finishReason,
            status: error?.failure?.status,
          });
        sendResponse({
          ok: false,
          error: failure.message,
          failure,
          systemPrompt: error?.systemPrompt || null,
          userPrompt: error?.userPrompt || null,
          provider: failure.provider || null,
          model: failure.model || null,
          rawProviderPayload: error?.rawProviderPayload || null,
        });
      });
    return true;
  }

  if (message?.type === "TEST_PROVIDER") {
    testProvider()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "Connection test failed.",
        })
      );
    return true;
  }

  if (message?.type === "GET_PROVIDER_LABEL") {
    getConfig().then((cfg) =>
      sendResponse({
        ok: true,
        provider: cfg.provider,
        model: cfg.model,
      })
    );
    return true;
  }

  return false;
});

async function getConfig() {
  return loadSettings();
}

function styleInstructions(styleMode) {
  switch (styleMode) {
    case "playful":
      return "Style: playful banter. Keep it light, teasing, and fun while still answering the latest message.";
    case "flirty":
      return "Style: flirty and forward between consenting adults. Match the heat already in the thread; do not lecture or sanitize the user's voice.";
    case "casual_adult":
      return [
        "Style: casual adult chat / game-like roleplay between consenting adults.",
        "Match the explicitness already present in the conversation.",
        "Stay in character as the sender. Do not moralize, warn, or refuse because the chat is spicy or vulgar.",
        "Still refuse anything involving minors or non-consensual harm.",
      ].join(" ");
    default:
      return "Style: normal chat reply matching the selected tone.";
  }
}

function buildPrompts(payload) {
  const {
    senderProfile = "",
    recipientProfile = "",
    keywords = "",
    conversation = "",
    tone = "casual",
    styleMode = "default",
  } = payload || {};

  if (!conversation.trim()) {
    throw new GenerateFailure(
      "Scan the page (or paste conversation history) before generating.",
      { code: "bad_input" }
    );
  }

  const isChatToolThread =
    /\bCustomer:\s/i.test(conversation) ||
    /\bModerator:\s/i.test(conversation) ||
    /Moderator \(you\)/i.test(senderProfile) ||
    /^Customer\b/m.test(recipientProfile);

  const systemPrompt = isChatToolThread
    ? [
        "You are drafting the next chat message inside a moderation ChatTool session.",
        "You write ONLY as the Moderator (the sender / persona). Never write as the Customer.",
        "The Customer is the other party. Reply to their latest message.",
        "If a line is labeled Customer:, that is incoming. If labeled Moderator:, that is already sent by you or another agent.",
        "Use Other Informations and Description from both profiles when they add relevant context.",
        "Match the Moderator's voice from the sender profile and prior Moderator lines.",
        "Read the latest Customer message carefully and answer what was asked or left open.",
        "Sound human: concrete and brief unless the thread needs more.",
        "Do not invent facts that are not in the profiles or conversation.",
        "Do not use markdown, bullet lists, labels like 'Reply:', or quotation marks around the whole message.",
        "Do not mention that you are an AI, a moderator tool, or an agent.",
        styleInstructions(styleMode),
      ].join(" ")
    : [
        "You draft the next chat message for an ongoing conversation (messaging apps, dating chats, games, or business threads).",
        "Write as the sender, matching their voice from the sender profile.",
        "Read the latest messages carefully and answer what was actually asked or left open.",
        "Sound human: concrete and brief unless the thread needs more.",
        "Do not invent facts that are not in the profiles or conversation.",
        "Do not use markdown, bullet lists, labels like 'Reply:', or quotation marks around the whole message.",
        styleInstructions(styleMode),
      ].join(" ");

  const userPrompt = [
    `Tone preference: ${tone}`,
    `Style mode: ${styleMode}`,
    "",
    isChatToolThread
      ? "Moderator / sender profile (who is writing — write AS this person):"
      : "Sender profile (who is writing the reply):",
    senderProfile.trim() || "(not provided)",
    "",
    isChatToolThread
      ? "Customer / recipient profile (who will receive the reply — write TO this person):"
      : "Recipient profile (who will receive the reply):",
    recipientProfile.trim() || "(not provided)",
    "",
    "Chat keywords / themes to lean on if relevant:",
    keywords.trim() || "(none)",
    "",
    isChatToolThread
      ? "Conversation history (oldest to newest). Lines start with Customer: or Moderator:. Focus on the latest Customer message and write the next Moderator message:"
      : "Conversation history (oldest to newest). Focus on the latest recipient message:",
    conversation.trim(),
    "",
    isChatToolThread
      ? "Write only the next Moderator message to the Customer, ready to paste into Send a message."
      : "Write only the next message from the sender, ready to paste.",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

async function generateReply(payload) {
  const cfg = await getConfig();
  if (!cfg.apiKey) {
    throw new GenerateFailure(
      cfg.provider === "openai"
        ? "Add your OpenAI API key in Settings first."
        : "Add your Gemini API key in Settings first.",
      { code: "config_error", provider: cfg.provider }
    );
  }
  if (!cfg.model) {
    throw new GenerateFailure("Set a model in Settings.", {
      code: "config_error",
      provider: cfg.provider,
    });
  }

  let prompts;
  try {
    prompts = buildPrompts(payload);
  } catch (error) {
    if (error instanceof GenerateFailure) throw error;
    throw new GenerateFailure(error?.message || "Invalid input.", { code: "bad_input" });
  }

  try {
    const result =
      cfg.provider === "openai"
        ? await generateWithOpenAI(cfg, prompts)
        : await generateWithGemini(cfg, prompts);

    return {
      reply: result.reply,
      provider: cfg.provider,
      model: cfg.model,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      rawProviderPayload: result.rawProviderPayload || null,
    };
  } catch (error) {
    if (error instanceof GenerateFailure) {
      error.systemPrompt = prompts.systemPrompt;
      error.userPrompt = prompts.userPrompt;
      if (!error.failure.provider) error.failure.provider = cfg.provider;
      if (!error.failure.model) error.failure.model = cfg.model;
      throw error;
    }
    const wrapped = new GenerateFailure(error?.message || "Failed to generate reply.", {
      provider: cfg.provider,
      model: cfg.model,
    });
    wrapped.systemPrompt = prompts.systemPrompt;
    wrapped.userPrompt = prompts.userPrompt;
    throw wrapped;
  }
}

async function generateWithGemini(cfg, { systemPrompt, userPrompt }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

  let response;
  try {
    response = await fetch(url, {
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
  } catch (error) {
    throw new GenerateFailure(error?.message || "Cannot reach Gemini.", {
      provider: "gemini",
      model: cfg.model,
      code: "model_unavailable",
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.error?.status ||
      `Gemini error (${response.status})`;
    throw new GenerateFailure(detail, {
      provider: "gemini",
      model: cfg.model,
      status: response.status,
      rawProviderPayload: data,
    });
  }

  const candidate = data?.candidates?.[0] || {};
  const finishReason = candidate.finishReason || "";
  const reply = (candidate.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();

  if (!reply) {
    if (finishReason && finishReason !== "STOP") {
      throw new GenerateFailure(`Gemini blocked the reply (${finishReason}).`, {
        provider: "gemini",
        model: cfg.model,
        code: "provider_safety_block",
        finishReason,
        rawProviderPayload: data,
      });
    }
    throw new GenerateFailure("Gemini returned an empty reply.", {
      provider: "gemini",
      model: cfg.model,
      code: "empty_output",
      rawProviderPayload: data,
    });
  }

  if (looksLikeModelRefusal(reply)) {
    throw new GenerateFailure("Model refused to answer this conversation.", {
      provider: "gemini",
      model: cfg.model,
      code: "model_refusal",
      rawReply: reply,
      finishReason,
      rawProviderPayload: data,
    });
  }

  return { reply, rawProviderPayload: data };
}

async function generateWithOpenAI(cfg, { systemPrompt, userPrompt }) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (error) {
    throw new GenerateFailure(error?.message || "Cannot reach OpenAI.", {
      provider: "openai",
      model: cfg.model,
      code: "model_unavailable",
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || `OpenAI error (${response.status})`;
    throw new GenerateFailure(detail, {
      provider: "openai",
      model: cfg.model,
      status: response.status,
      rawProviderPayload: data,
    });
  }

  const choice = data?.choices?.[0] || {};
  const reply = String(choice?.message?.content || "").trim();
  const finishReason = choice?.finish_reason || "";

  if (!reply) {
    if (finishReason && finishReason !== "stop") {
      throw new GenerateFailure(`OpenAI stopped with finish_reason=${finishReason}.`, {
        provider: "openai",
        model: cfg.model,
        code: "provider_safety_block",
        finishReason,
        rawProviderPayload: data,
      });
    }
    throw new GenerateFailure("OpenAI returned an empty reply.", {
      provider: "openai",
      model: cfg.model,
      code: "empty_output",
      rawProviderPayload: data,
    });
  }

  if (looksLikeModelRefusal(reply)) {
    throw new GenerateFailure("Model refused to answer this conversation.", {
      provider: "openai",
      model: cfg.model,
      code: "model_refusal",
      rawReply: reply,
      finishReason,
      rawProviderPayload: data,
    });
  }

  return { reply, rawProviderPayload: data };
}

async function testProvider() {
  const cfg = await getConfig();
  if (!cfg.apiKey) {
    throw new Error(
      cfg.provider === "openai"
        ? "Add an OpenAI API key before testing."
        : "Add a Gemini API key before testing."
    );
  }
  if (!cfg.model) {
    throw new Error("Enter a model id before testing.");
  }

  if (cfg.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/models/" + encodeURIComponent(cfg.model), {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI error (${response.status})`);
    }
    return {
      provider: "openai",
      message: `Connected. Model "${data?.id || cfg.model}" is reachable.`,
    };
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(cfg.model)}?key=${encodeURIComponent(cfg.apiKey)}`;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini error (${response.status})`);
  }
  return {
    provider: "gemini",
    message: `Connected. Model "${data?.name || cfg.model}" is reachable.`,
  };
}
