# CWS Chat Reply Assistant

Chrome extension that drafts message replies with **Google Gemini** or **OpenAI** from:

1. Conversation history (scanned from the page)
2. Recipient profile (auto-fetched)
3. Chat keywords (auto-fetched)
4. Your sender profile (set once in Settings / popup)

Works in normal Chrome and antidetect browsers such as MoreLogin (cloud APIs only).

## Load

1. Open `chrome://extensions` (or the equivalent extensions page)
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. After updates, click **Reload**

## Settings

1. Extension icon → **Settings**
2. Choose provider: **Gemini** or **OpenAI**
3. Paste that provider’s API key
4. Pick a model from the list (or paste an exact id)
5. Optionally set a default sender profile
6. **Test connection** → **Save**

Keys:
- Gemini: [Google AI Studio](https://aistudio.google.com/apikey)
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

Suggested Gemini models in the dropdown include `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`, and `gemini-3-flash-preview`.

## Use

1. Open a chat tab
2. **Scan page** → fills recipient, keywords, conversation (logged)
3. **Generate reply** → Gemini (logged, including failures)
4. Mark **Good** / **Bad**
5. **Copy response**
6. Open **Logs** to review or **Export JSON**

## Environment notes

`.env` / `.env.example` are for local notes only. Chrome does not read them at runtime — use the Settings UI.

| Variable | Purpose |
| --- | --- |
| `PROVIDER` | `gemini` or `openai` |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | Gemini model id |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | OpenAI model id |
| `DEFAULT_SENDER_PROFILE` | Optional default “you” profile |
| `DEFAULT_TONE` | Optional default tone |

## Project layout

```
manifest.json
background/service-worker.js   # Gemini / OpenAI generate + failure classification
content/content.js             # Page / LinkedIn / WhatsApp extractors
popup/                         # Scan / Generate / Copy / Rate
options/                       # API key + model
logs/                          # Usage log viewer + export
shared/                        # Logging + failure helpers
icons/
```
