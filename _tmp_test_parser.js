function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  text = text.replace(/\s*Moderator\s+Other Informations[\s\S]*$/i, "").trim();
  return text;
}

function parseChatToolMessagesFromText(raw) {
  const text = String(raw || "");
  const markerRe = /(?:^|\n)\s*(face|perm_identity|extension)\s*\n/gi;
  const parts = [];
  let match;
  const indices = [];
  while ((match = markerRe.exec(text)) !== null) {
    indices.push({
      index: match.index + match[0].indexOf(match[1]),
      icon: match[1].toLowerCase(),
    });
  }
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].index;
    const end = i + 1 < indices.length ? indices[i + 1].index : text.length;
    const chunk = text.slice(start, end);
    const role = indices[i].icon === "face" ? "Customer" : "Moderator";
    const body = cleanChatToolMessageBody(chunk);
    if (!body) continue;
    parts.push({ role, text: body });
  }
  return parts.filter((p) => !/^Other Informations/i.test(p.text));
}

const sample = `Customer rating:
72
face

 11/7/2026, 2:20:11 PM
#24660258574

Yes

perm_identity

 11/7/2026, 2:17:31 PM by en-32431
REPORT   #24660248399

Sure, but before I go for real this time. Do you like surprises? Gifting is my thing.

face

 11/7/2026, 2:15:38 PM
#24660240514

Later

perm_identity

 11/7/2026, 2:14:31 PM by en-32431
REPORT   #24660235849

Sure, I would want to give you my undivided attention.

Moderator
Other Informations

* Profile updated

Description
Name
Age`;

const msgs = parseChatToolMessagesFromText(sample);
const recent = [...msgs].reverse().slice(-10);
console.log(recent.map((m) => m.role + ": " + m.text).join("\n\n"));
