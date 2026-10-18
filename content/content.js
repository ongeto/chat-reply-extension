/**
 * Pulls chat context from the active page.
 * Priority: selected text → LinkedIn messaging → WhatsApp Web → generic page text.
 * Always returns recipientProfile + keywords when they can be inferred.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "EXTRACT_CONTEXT") return false;

  try {
    sendResponse({ ok: true, context: extractContext() });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error?.message || "Could not read page context.",
    });
  }
  return false;
});

function extractContext() {
  const selection = window.getSelection()?.toString()?.trim();
  if (selection && selection.length > 20) {
    return withKeywords({
      conversation: selection,
      source: "selection",
      recipientName: "",
      recipientProfile: "",
      keywordSeeds: [document.title, selection],
    });
  }

  const host = location.hostname;

  if (host.includes("linkedin.com")) {
    return withKeywords(extractLinkedIn());
  }

  if (host.includes("web.whatsapp.com")) {
    return withKeywords(extractWhatsApp());
  }

  const conversation = fallbackPageText();
  return withKeywords({
    conversation,
    source: "page",
    recipientName: "",
    recipientProfile: guessRecipientFromPage(),
    keywordSeeds: [document.title, conversation],
  });
}

function withKeywords(ctx) {
  const seeds = [
    ...(ctx.keywordSeeds || []),
    ctx.recipientProfile || "",
    ctx.recipientName || "",
    ctx.conversation || "",
  ];
  const keywords = extractKeywords(seeds.join("\n"));
  return {
    conversation: ctx.conversation || "",
    source: ctx.source || "page",
    recipientName: ctx.recipientName || "",
    recipientProfile: ctx.recipientProfile || "",
    keywords,
  };
}

function extractLinkedIn() {
  const recipientName =
    textOf(
      ".msg-overlay-bubble-header__title",
      ".msg-entity-lockup__entity-title",
      ".msg-s-message-list-content h2",
      ".msg-title-bar__title-line span",
      ".msg-thread__link-to-profile",
      "h1"
    ) || "";

  const recipientHeadline =
    textOf(
      ".msg-entity-lockup__entity-info",
      ".msg-overlay-bubble-header__subtitle",
      ".artdeco-entity-lockup__subtitle",
      ".msg-entity-lockup__entity-subtitle",
      ".text-body-small"
    ) || "";

  const aboutBits = [
    ...document.querySelectorAll(
      ".pv-top-card--list li, .pvs-header__subtitle, .inline-show-more-text, [data-anonymize='job-title'], [data-anonymize='headline']"
    ),
  ]
    .map((n) => cleanText(n.innerText))
    .filter(Boolean)
    .slice(0, 6);

  const nodes = [
    ...document.querySelectorAll(
      ".msg-s-event-listitem__body, .msg-s-message-list__event .msg-s-event-listitem__message-bubble, .msg-s-event__content, .msg-s-event-listitem__message-bubble"
    ),
  ];

  const lines = nodes
    .map((node) => cleanText(node.innerText || node.textContent))
    .filter(Boolean);

  const unique = dedupeConsecutive(lines);
  const conversation = unique.slice(-40).join("\n");
  const recipientProfile = [recipientName, recipientHeadline, ...aboutBits]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(" — ");

  return {
    conversation,
    source: "linkedin",
    recipientName,
    recipientProfile,
    keywordSeeds: [recipientName, recipientHeadline, ...aboutBits, conversation],
  };
}

function extractWhatsApp() {
  const recipientName =
    textOf(
      "header span[dir='auto']",
      "#main header span[title]",
      "header [data-testid='conversation-info-header-chat-title']",
      "#main header h1",
      "#main header span[dir='auto']"
    ) || "";

  const subtitle =
    textOf(
      "#main header span[title]:not([data-testid='conversation-info-header-chat-title'])",
      "header [data-testid='conversation-info-header-chat-subtitle']"
    ) || "";

  const nodes = [
    ...document.querySelectorAll(
      "#main div[data-testid='msg-container'], #main .message-in, #main .message-out, #main [data-id]"
    ),
  ];

  const lines = nodes
    .map((node) => {
      const copy = node.querySelector(
        "span.selectable-text, span[data-testid='conversation-text'], .copyable-text, span.selectable-text.copyable-text"
      );
      const text = cleanText(copy?.innerText || "");
      if (!text) return "";
      const outgoing = Boolean(
        node.classList.contains("message-out") ||
          node.querySelector(".message-out") ||
          node.closest(".message-out")
      );
      const prefix = outgoing ? "Me: " : `${recipientName || "Them"}: `;
      return prefix + text;
    })
    .filter(Boolean);

  const conversation = dedupeConsecutive(lines).slice(-40).join("\n");
  const recipientProfile = [recipientName, subtitle].filter(Boolean).join(" — ");

  return {
    conversation,
    source: "whatsapp",
    recipientName,
    recipientProfile,
    keywordSeeds: [recipientName, subtitle, conversation],
  };
}

function guessRecipientFromPage() {
  const title = cleanText(document.title).replace(/\s*[|\-–—].*$/, "");
  const heading = textOf("h1", "[role='heading']");
  return [heading, title].filter(Boolean).join(" — ");
}

function fallbackPageText() {
  const main =
    document.querySelector("main, [role='main'], #main, .messages, .chat") ||
    document.body;
  return cleanText(main?.innerText || "").slice(0, 4000);
}

function extractKeywords(raw) {
  const STOP = new Set([
    "a","an","the","and","or","but","if","then","so","to","of","in","on","for","with",
    "at","by","from","as","is","are","was","were","be","been","being","it","this","that",
    "these","those","i","you","he","she","we","they","me","my","your","our","their","them",
    "hi","hello","hey","thanks","thank","please","just","also","very","really","can","could",
    "would","should","will","shall","do","does","did","have","has","had","not","no","yes",
    "ok","okay","sure","well","here","there","what","when","where","who","how","why","about",
    "into","over","under","again","more","most","some","any","all","than","too","out","up",
    "am","im","dont","didnt","cant","wont","ive","youre","theyre","linkedin","whatsapp",
    "message","messages","chat","conversation","profile","sent","seen","today","yesterday",
  ]);

  const counts = new Map();
  const tokens = String(raw || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s+#&./-]/gu, " ")
    .split(/[\s,/|;]+/)
    .map((t) => t.replace(/^[#.]+|[.]+$/g, ""))
    .filter((t) => t.length >= 3 && t.length <= 32 && !STOP.has(t) && !/^\d+$/.test(t));

  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  // Prefer multi-word phrases from headline-like lines
  const phraseHits = [];
  for (const line of String(raw || "").split(/\n+/)) {
    const cleaned = cleanText(line);
    if (cleaned.length < 8 || cleaned.length > 80) continue;
    if (/^(me|them):/i.test(cleaned)) continue;
    const words = cleaned.split(/\s+/);
    if (words.length >= 2 && words.length <= 6) {
      phraseHits.push(cleaned.replace(/^Me:\s*|^Them:\s*/i, "").trim());
    }
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([word]) => word);

  const phrases = phraseHits
    .filter((p, i, arr) => arr.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i)
    .slice(0, 3);

  // Mix short phrases + top tokens, keep unique-ish list
  const combined = [];
  for (const item of [...phrases, ...ranked]) {
    const key = item.toLowerCase();
    if (combined.some((c) => c.toLowerCase() === key)) continue;
    if (combined.some((c) => c.toLowerCase().includes(key) && c.length > item.length)) continue;
    combined.push(item);
    if (combined.length >= 8) break;
  }

  return combined.join(", ");
}

function textOf(...selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const text = cleanText(el?.innerText || el?.textContent || el?.getAttribute?.("title") || "");
    if (text) return text;
  }
  return "";
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dedupeConsecutive(lines) {
  const out = [];
  for (const line of lines) {
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out;
}
