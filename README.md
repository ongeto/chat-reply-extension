# CWS Chat Reply Assistant

Chrome extension MVP that drafts message replies with **Google Gemini** from:

1. Conversation history (scanned from the page)
2. Recipient profile (auto-fetched)
3. Chat keywords (auto-fetched)
4. Your sender profile (set once in Settings / popup)

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `chat-reply-extension`
5. If it was already loaded, click **Reload**

## Environment

Copy `.env.example` to `.env` and fill in placeholders:

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | Model id (e.g. `gemini-2.0-flash`) |
| `DEFAULT_SENDER_PROFILE` | Optional default “you” profile |
| `DEFAULT_TONE` | Optional default reply tone |

`.env` is gitignored. For the unpacked Chrome extension, paste the same key and model into the Settings UI (Chrome cannot read `.env` at runtime).

## Settings

1. Click the extension icon → **Settings**
2. Paste your **Gemini API key**
3. Enter the **model** id (e.g. `gemini-2.0-flash`)
4. Optionally set a default sender profile
5. Save

Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

## Use

1. Open a chat tab (LinkedIn messaging, WhatsApp Web, or select text on any page)
2. Click the extension icon
3. **Scan page** — fills recipient, keywords, and conversation
4. **Generate reply** — calls Gemini with that context
5. **Copy response** — copies the draft

Sender profile is yours; recipient + keywords refresh every scan.

## Project layout

```
manifest.json
background/service-worker.js   # Gemini generateContent call
content/content.js             # Page / LinkedIn / WhatsApp extractors
popup/                         # Scan / Generate / Copy UI
options/                       # API key + model
icons/
```
