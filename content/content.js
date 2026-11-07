/**
 * Pulls chat context from the active page.
 * Priority: selection → ChatTool → LinkedIn → WhatsApp → generic page text.
 * ChatTool: Customer = recipient, Moderator = sender (you).
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
  if (selection && selection.length > 20 && !isChatToolHost()) {
    return withKeywords({
      conversation: selection,
      source: "selection",
      recipientName: "",
      recipientProfile: "",
      senderProfile: "",
      keywordSeeds: [document.title, selection],
    });
  }

  const host = location.hostname;

  if (isChatToolHost() || isChatToolPage()) {
    return withKeywords(extractChatTool());
  }

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
    senderProfile: "",
    keywordSeeds: [document.title, conversation],
  });
}

function withKeywords(ctx) {
  const seeds = [
    ...(ctx.keywordSeeds || []),
    ctx.recipientProfile || "",
    ctx.recipientName || "",
    ctx.senderProfile || "",
    ctx.conversation || "",
  ];
  const keywords = extractKeywords(seeds.join("\n"), {
    chatTool: ctx.source === "chattool",
  });
  return {
    conversation: ctx.conversation || "",
    source: ctx.source || "page",
    recipientName: ctx.recipientName || "",
    recipientProfile: ctx.recipientProfile || "",
    senderProfile: ctx.senderProfile || "",
    keywords,
  };
}

function isChatToolHost() {
  return location.hostname.includes("moderationinterface.com");
}

function isChatToolPage() {
  const text = cleanText(document.body?.innerText || "").slice(0, 2500);
  return (
    /ChatTool/i.test(text) &&
    /\bCustomer\b/.test(text) &&
    /\bModerator\b/.test(text) &&
    /PANIC ROOM|SEND MESSAGE/i.test(text)
  );
}

/**
 * ChatTool layout (from live UI):
 * Left = Customer profile (Other Informations, Description, Name, Age, …)
 * Center = compose + message timeline
 * Right = Moderator profile (persona you write as)
 *
 * Message icons (Material Icons text content):
 *   face          → Customer
 *   perm_identity → Moderator (agent)
 *   extension     → Moderator (automated)
 */
function extractChatTool() {
  const customer = extractChatToolSideProfile("customer");
  const moderator = extractChatToolSideProfile("moderator");
  const serviceKeyword = extractChatToolServiceKeyword();
  let messages = extractChatToolMessagesFromDom();

  if (messages.length < 2) {
    messages = parseChatToolMessagesFromText(document.body?.innerText || "");
  }

  // Page lists newest first; prompt wants oldest → newest, last 5–10 turns.
  const chronological = [...messages].reverse();
  const recent = chronological.slice(-10);
  const conversation = recent
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n\n");

  const recipientProfile = formatChatToolProfile("Customer", customer);
  const senderProfile = formatChatToolProfile("Moderator (you)", moderator);

  const keywordSeeds = [
    serviceKeyword,
    customer.name,
    customer.city,
    customer.description,
    customer.otherInformations,
    moderator.name,
    moderator.description,
    ...recent.map((m) => m.text),
  ].filter(Boolean);

  return {
    conversation,
    source: "chattool",
    recipientName: customer.name || "",
    recipientProfile,
    senderProfile,
    keywordSeeds,
  };
}

function extractChatToolSideProfile(side) {
  const midX = window.innerWidth / 2;
  const profile = {
    name: "",
    age: "",
    city: "",
    sex: "",
    otherInformations: "",
    description: "",
    extras: [],
  };

  const fieldLabels = [
    "Name",
    "Age",
    "City",
    "Job",
    "Sex Preferences",
    "Booked Holidays",
    "Others",
    "Postcode",
    "Chat Preference",
    "Chat",
  ];

  for (const input of document.querySelectorAll("input, textarea, select")) {
    const rect = input.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) continue;
    const centerX = rect.left + rect.width / 2;
    const onLeft = centerX < midX - 40;
    const onRight = centerX > midX + 40;
    if (side === "customer" && !onLeft) continue;
    if (side === "moderator" && !onRight) continue;

    const value = cleanText(
      input.value != null && String(input.value).length
        ? input.value
        : input.innerText || input.textContent || ""
    );
    if (!value || isChatToolPlaceholder(value)) continue;

    const label = findNearbyFieldLabel(input, fieldLabels);
    const tag = (input.tagName || "").toLowerCase();

    if (tag === "textarea" || (input.rows && Number(input.rows) > 1)) {
      if (!profile.otherInformations && looksLikeOtherInformations(value, label)) {
        profile.otherInformations = value;
        continue;
      }
      if (!profile.description && looksLikeDescription(value, label)) {
        profile.description = value;
        continue;
      }
      // First large textarea on a side is usually Other Informations; second is Description.
      if (!profile.otherInformations) {
        profile.otherInformations = value;
      } else if (!profile.description && value !== profile.otherInformations) {
        profile.description = value;
      } else if (value.length > 20) {
        profile.extras.push(value);
      }
      continue;
    }

    if (/^name$/i.test(label) && !profile.name) profile.name = value;
    else if (/^age$/i.test(label) && !profile.age) profile.age = value;
    else if (/^city$/i.test(label) && !profile.city) profile.city = value;
    else if (/job|sex preferences|booked|others|postcode|chat preference|^chat$/i.test(label)) {
      profile.extras.push(`${label}: ${value}`);
    } else if (!label && value.length <= 40 && !profile.name && /^[A-Za-z0-9._-]{2,40}$/.test(value)) {
      profile.name = value;
    }
  }

  // Sex radios: checked input near Female/Male on this side
  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    const rect = radio.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (side === "customer" && centerX >= midX) continue;
    if (side === "moderator" && centerX <= midX) continue;
    if (!radio.checked) continue;
    const near = cleanText(
      radio.parentElement?.innerText ||
        radio.nextSibling?.textContent ||
        radio.labels?.[0]?.innerText ||
        ""
    );
    if (/female/i.test(near)) profile.sex = "Female";
    else if (/male/i.test(near)) profile.sex = "Male";
  }

  // Text fallback when inputs are empty but visible text holds profile notes
  if (!profile.name && !profile.description && !profile.otherInformations) {
    Object.assign(profile, parseChatToolProfileFromSideText(side));
  }

  return profile;
}

function parseChatToolProfileFromSideText(side) {
  const raw = cleanText(document.body?.innerText || "");
  const customerIdx = raw.search(/\bCustomer\b/);
  const moderatorIdx = raw.search(/\bModerator\b/);
  const sendIdx = raw.search(/Send a message/i);

  let chunk = "";
  if (side === "customer" && customerIdx >= 0) {
    const end = sendIdx > customerIdx ? sendIdx : moderatorIdx > customerIdx ? moderatorIdx : raw.length;
    chunk = raw.slice(customerIdx, end);
  } else if (side === "moderator" && moderatorIdx >= 0) {
    chunk = raw.slice(moderatorIdx);
  }

  const profile = {
    name: "",
    age: "",
    city: "",
    sex: "",
    otherInformations: "",
    description: "",
    extras: [],
  };

  if (!chunk) return profile;

  const nameMatch = chunk.match(/\bName\s*\n+\s*([^\n*]{2,60})/i);
  const ageMatch = chunk.match(/\bAge\s*\n+\s*(\d{1,3})\b/i);
  const cityMatch = chunk.match(/\bCity\s*\n+\s*([^\n*]{2,60})/i);
  if (nameMatch && !isChatToolPlaceholder(nameMatch[1])) profile.name = cleanText(nameMatch[1]);
  if (ageMatch) profile.age = ageMatch[1];
  if (cityMatch && !isChatToolPlaceholder(cityMatch[1])) profile.city = cleanText(cityMatch[1]);
  if (/\bFemale\b/i.test(chunk) && !/\bMale\b[\s\S]{0,20}\bFemale\b/i.test(chunk)) {
    // Prefer checked context; text dump often lists both labels
  }
  if (/\bSex\b[\s\S]{0,80}\bFemale\b/i.test(chunk) && side === "moderator") {
    // leave unset unless we know; screenshots show radios
  }

  const descHint =
    chunk.match(
      /\* Profile updated by the customer[^*\n]*\n+([\s\S]{20,800}?)(?=\n(?:Name|Age|Chat Preference|Sex|City|Job|SHOW ALL|Moderator|Customer rating)\b)/i
    ) ||
    chunk.match(
      /\bDescription\s*\n+([\s\S]{20,800}?)(?=\n(?:Name|Age|Chat Preference|Sex|City|Job|SHOW ALL|Moderator)\b)/i
    );
  if (descHint?.[1] && !isChatToolPlaceholder(descHint[1])) {
    profile.description = cleanText(descHint[1]);
  }

  return profile;
}

function formatChatToolProfile(roleLabel, profile) {
  const bits = [];
  if (profile.name) bits.push(`Name: ${profile.name}`);
  if (profile.age) bits.push(`Age: ${profile.age}`);
  if (profile.sex) bits.push(`Sex: ${profile.sex}`);
  if (profile.city) bits.push(`City: ${profile.city}`);
  if (profile.otherInformations) bits.push(`Other Informations: ${profile.otherInformations}`);
  if (profile.description) bits.push(`Description: ${profile.description}`);
  for (const extra of profile.extras || []) {
    if (extra && !bits.some((b) => b.includes(extra))) bits.push(extra);
  }
  if (!bits.length) return "";
  return `${roleLabel}\n${bits.join("\n")}`;
}

function extractChatToolServiceKeyword() {
  const text = cleanText(document.body?.innerText || "");
  const match = text.match(/DEFAULT Keyword for service\s+([^\n]+)/i);
  return match ? cleanText(match[1]) : "";
}

function extractChatToolMessagesFromDom() {
  const messages = [];
  const icons = [
    ...document.querySelectorAll(
      ".material-icons, .material-symbols-outlined, .material-icons-outlined, i, span, div"
    ),
  ].filter((el) => {
    if (el.children.length > 2) return false;
    const t = cleanText(el.textContent || "");
    return t === "face" || t === "perm_identity" || t === "extension";
  });

  const seen = new Set();

  for (const icon of icons) {
    const role =
      cleanText(icon.textContent) === "face" ? "Customer" : "Moderator";
    const container =
      icon.closest("[class*='message'], [class*='Message'], li, article, .row, .col") ||
      icon.parentElement?.parentElement ||
      icon.parentElement;
    if (!container) continue;

    const blockText = cleanText(container.innerText || "");
    if (blockText.length < 8) continue;

    const idMatch = blockText.match(/#(\d{8,})/);
    const id = idMatch ? idMatch[1] : "";
    const key = id || blockText.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);

    const text = cleanChatToolMessageBody(blockText);
    if (!text || text.length < 1) continue;
    if (isChatToolChromeLine(text)) continue;

    messages.push({ role, text, id });
  }

  return messages;
}

function parseChatToolMessagesFromText(raw) {
  const text = String(raw || "");
  const markerRe = /(?:^|\n)\s*(face|perm_identity|extension)\s*\n/gi;
  const parts = [];
  let match;
  const indices = [];

  while ((match = markerRe.exec(text)) !== null) {
    indices.push({ index: match.index + match[0].indexOf(match[1]), icon: match[1].toLowerCase() });
  }

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].index;
    const end = i + 1 < indices.length ? indices[i + 1].index : text.length;
    const chunk = text.slice(start, end);
    const icon = indices[i].icon;
    const role = icon === "face" ? "Customer" : "Moderator";
    const body = cleanChatToolMessageBody(chunk);
    if (!body || isChatToolChromeLine(body)) continue;
    // Skip pure reaction stubs if empty of prose — keep [Kiss] etc. as short messages
    parts.push({ role, text: body });
  }

  // Stop before Moderator profile dump if it leaked into last chunk
  return parts.filter((p) => !/^Other Informations/i.test(p.text));
}

function cleanChatToolMessageBody(chunk) {
  let text = cleanText(chunk);
  text = text
    .replace(/^(face|perm_identity|extension)\s*/i, "")
    .replace(/\bREPORT\b/gi, " ")
    .replace(/\bby another agent\b/gi, " ")
    .replace(/\bby en-[\w-]+\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\b/gi, " ")
    .replace(/#\d{8,}/g, " ")
    .replace(/^Automated text:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Drop trailing profile chrome if a message block ran into the Moderator column
  text = text.replace(/\s*Moderator\s+Other Informations[\s\S]*$/i, "").trim();
  text = text.replace(/\s*Customer\s+Other Informations[\s\S]*$/i, "").trim();
  text = text.replace(/\s*SHOW ALL FIELDS[\s\S]*$/i, "").trim();

  return text;
}

function isChatToolChromeLine(text) {
  const t = cleanText(text);
  if (!t) return true;
  if (t.length > 500) return false;
  return /^(ChatTool|CHAT|STATS|SETTINGS|LOGOUT|QUEUE|PANIC ROOM|SEND MESSAGE|MEDIA CENTER|Customer rating|Please enter at least|SLOW CONNECTION|Mehr anzeigen|SHOW ALL FIELDS|Other Informations|Description|Name|Age|Sex|City|Job)$/i.test(
    t
  );
}

function isChatToolPlaceholder(value) {
  const t = cleanText(value);
  if (!t) return true;
  return (
    /^\*?\s*Profile updated by the customer/i.test(t) ||
    /^Please enter/i.test(t) ||
    /^(Name|Age|City|Job|Description|Other Informations)$/i.test(t)
  );
}

function looksLikeOtherInformations(value, label) {
  if (/other\s*informations?/i.test(label || "")) return true;
  // Structured note lines often appear here
  return /^(Kids|Alcohol|Education|Interested in|Body|Smoker|Height)\s*:/im.test(value);
}

function looksLikeDescription(value, label) {
  if (/^description$/i.test(label || "")) return true;
  return value.length > 40 && !/^Name\s*:/i.test(value);
}

function findNearbyFieldLabel(input, fieldLabels) {
  if (input.labels && input.labels[0]) {
    const fromLabel = cleanText(input.labels[0].innerText);
    if (fromLabel) return fromLabel;
  }

  const labelledBy = input.getAttribute("aria-labelledby");
  if (labelledBy) {
    const el = document.getElementById(labelledBy);
    const t = cleanText(el?.innerText || "");
    if (t) return t;
  }

  const prev = input.previousElementSibling;
  if (prev) {
    const t = cleanText(prev.innerText || prev.textContent || "");
    if (t && t.length < 40) return t;
  }

  const parent = input.parentElement;
  if (parent) {
    const parentText = cleanText(parent.innerText || "").split("\n")[0];
    for (const label of fieldLabels) {
      if (new RegExp(`^${label}$`, "i").test(parentText) || parentText === label) {
        return label;
      }
    }
    // Table-like: label cell then input cell
    const row = input.closest("tr, .form-group, .row, [class*='field']");
    if (row) {
      const rowText = cleanText(row.innerText || "");
      for (const label of fieldLabels) {
        if (rowText.toLowerCase().startsWith(label.toLowerCase())) return label;
      }
    }
  }

  return "";
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
    senderProfile: "",
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
    senderProfile: "",
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

function extractKeywords(raw, options = {}) {
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
    // ChatTool chrome / icon noise
    "chattool","stats","settings","logout","queue","panic","room","send","media","center",
    "customer","moderator","rating","report","face","perm","identity","extension","cloud",
    "download","session","start","elapsed","time","slow","connection","detected","default",
    "keyword","service","informations","description","name","age","city","job","show",
    "fields","chars","entered","automated","text","another","agent","mehr","anzeigen",
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

  const phraseHits = [];
  for (const line of String(raw || "").split(/\n+/)) {
    const cleaned = cleanText(line);
    if (cleaned.length < 8 || cleaned.length > 80) continue;
    if (/^(me|them|customer|moderator):/i.test(cleaned)) continue;
    if (options.chatTool && isChatToolChromeLine(cleaned)) continue;
    const words = cleaned.split(/\s+/);
    if (words.length >= 2 && words.length <= 6) {
      phraseHits.push(
        cleaned.replace(/^(Me|Them|Customer|Moderator):\s*/i, "").trim()
      );
    }
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([word]) => word);

  const phrases = phraseHits
    .filter((p, i, arr) => arr.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i)
    .slice(0, 3);

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
    const text = cleanText(
      el?.innerText || el?.textContent || el?.getAttribute?.("title") || ""
    );
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
