# Threads AI — ассистент DeepSeek

Расширение для Safari (Web Extension, Manifest V3): AI-ассистент на Threads, который читает ленту, ищет, отвечает и публикует посты от вашего имени через любой OpenAI-совместимый API (по умолчанию — OpenCode Zen, работает и с DeepSeek).

<details>
<summary>🇷🇺 Документация (русский)</summary>

## Возможности

- **Чат с ИИ на Threads** — ассистент видит текущую страницу (ленту, тред, профиль), умеет листать ленту, искать посты, читать комментарии и делать веб-поиск (DuckDuckGo) + открывать страницы для проверки фактов.
- **Публикация и ответы** — черновик, публикация поста, ответ в тред и комментарий — только после вашего подтверждения (`needsConfirm`).
- **Автозапуск по расписанию** — расширение само открывает Threads и выполняет задачу (по умолчанию: прочитать ленту и сделать резюме). Только инструменты чтения — ничего не публикует.
- **Тренды дня** — ИИ листает ленту, проверяет темы через веб-поиск и собирает «топ-5 тем дня» с примерами и идеей поста (хранится последние 7 отчётов).
- **Идеи постов** — генерация 5–20 идей под вашу ленту с настройкой «хайповости» и темы.
- **Очередь публикаций** — идеи превращаются в готовые посты (≤500 символов, без эмодзи) и публикуются по расписанию с уведомлением. Длинные тексты разбиваются в тред (части через ответы).
- **Мой профиль** — ИИ изучает ваши последние посты и запоминает стиль (тон, длина, эмодзи, хэштеги), который можно править вручную.
- **Аналитика** — разбор последних 5 постов: что заходит, а что нет.
- **Характер** — ползунки: живость, эмодзи, юмор, длина, формальность (0–100).
- **Режим «Выдумка»** — ИИ пишет выдуманные истории-ветки из 2–4 частей.
- **Защита от бана** — случайные паузы (1–3 базовые) перед действиями и лимит действий в час; при превышении — блокировка до следующего часа.
- **i18n** — интерфейс на русском и английском.
- **История чатов** — до 12 диалогов по 40 сообщений.

## Установка

Расширение — чистый Web Extension (нет Xcode-проекта), поэтому установка зависит от браузера:

### Safari (через Xcode)

1. Скачайте репозиторий.
2. В Xcode: `File → New → Project → Safari Web Extension App`.
3. Замените сгенерированную папку расширения на содержимое этого репозитория (`manifest.json`, `background.js`, `content.js`, `popup/`, `icons/`).
4. Запустите приложение, включите расширение: `Safari → Настройки → Расширения → Threads AI`.

### Firefox (dev)

1. В Firefox: `about:debugging → This Firefox → Load Temporary Add-on`.
2. Выберите `manifest.json`.

## Настройка

1. Откройте popup → ⚙️ Настройки.
2. Вставьте API-ключ (OpenCode Zen, DeepSeek или любой OpenAI-совместимый).
3. `Base URL` по умолчанию — `https://opencode.ai/zen/v1` (для DeepSeek — `https://api.deepseek.com`).
4. Укажите модель, нажмите «Проверить подключение» — должен появиться список моделей.
5. Готово — можно общаться в чате или включать автозадачи/очередь.

## Инструменты ИИ (tool calling)

**Чтение:** `get_page_info`, `get_feed`, `scroll_feed`, `search_threads`, `open_thread`, `get_comments`, `inspect_page`, `search_web`, `fetch_page`.

**Действия (только с вашим подтверждением):** `draft_post`, `publish_draft`, `reply_to_thread`, `send_reply`, `reply_to_comment`, `cancel_draft`.

Лимиты Threads соблюдаются автоматически: пост, ответ и комментарий — максимум 500 символов, до 5 ссылок и 10 медиафайлов.

## Структура

```
background.js      — сервисный слой: API-запросы, цикл инструментов, автозадачи,
                     очередь публикаций, alarms, защита от бана
content.js         — скрипт на странице Threads: парсинг DOM, реализация всех инструментов
popup/             — интерфейс (HTML + CSS + JS + i18n RU/EN)
icons/             — иконки 16/48/128
gen_icons.py       — генератор иконок (чистый Python, без зависимостей)
manifest.json      — MV3: permissions, host_permissions, content_scripts
```

## Безопасность

- Ключ API хранится в `chrome.storage.local` и никуда не отправляется, кроме выбранного вами Base URL.
- Публикация и ответы — **только** через диалог подтверждения на странице; авто-режим не имеет права на действия.
- Веб-инструменты `search_web` / `fetch_page` запрашивают страницы с отдельного `https://html.duckduckgo.com/*` и работают через прокси-табу, а не из фона напрямую.
- `https://*/*` в host_permissions нужен, чтобы открывать статьи для проверки фактов (фейк-новости).

</details>

<details>
<summary>🇬🇧 Documentation (English)</summary>

## Features

- **AI chat on Threads** — the assistant sees the current page (feed, thread, profile), can scroll the feed, search posts, read comments, and do web search (DuckDuckGo) + fetch pages for fact-checking.
- **Publishing & replies** — draft, publish post, reply in thread, comment — only after your confirmation (`needsConfirm`).
- **Scheduled auto-tasks** — the extension opens Threads and runs a task on schedule (default: read the feed and summarize). Read-only tools only — never publishes.
- **Daily trends** — AI scrolls the feed, cross-checks topics via web search, and builds a "top-5 topics" report with examples and a post idea (last 7 reports kept).
- **Post ideas** — generate 5–20 ideas tuned to your feed, with a "hype" slider and topic filter.
- **Publishing queue** — ideas become ready posts (≤500 chars, no emoji) published on schedule with notifications. Long texts are split into threads (parts posted as replies).
- **My profile** — AI studies your recent posts and learns your style (tone, length, emoji, hashtags); the style guide is editable by hand.
- **Analytics** — breakdown of your last 5 posts: what works and what doesn't.
- **Character sliders** — liveliness, emoji, humor, length, formality (0–100).
- **Fiction mode** — AI writes fictional 2–4 part thread stories.
- **Ban protection** — random pauses (1–3x base) before actions plus a per-hour action limit; once exceeded, actions are blocked until the next hour.
- **i18n** — UI in Russian and English.
- **Chat history** — up to 12 conversations of 40 messages.

## Installation

This is a plain Web Extension (no Xcode project), so installation depends on the browser:

### Safari (via Xcode)

1. Download the repository.
2. In Xcode: `File → New → Project → Safari Web Extension App`.
3. Replace the generated extension folder with the contents of this repo (`manifest.json`, `background.js`, `content.js`, `popup/`, `icons/`).
4. Run the app, then enable it: `Safari → Settings → Extensions → Threads AI`.

### Firefox (dev)

1. In Firefox: `about:debugging → This Firefox → Load Temporary Add-on`.
2. Pick `manifest.json`.

## Setup

1. Open the popup → ⚙️ Settings.
2. Paste an API key (OpenCode Zen, DeepSeek, or any OpenAI-compatible provider).
3. `Base URL` defaults to `https://opencode.ai/zen/v1` (for DeepSeek — `https://api.deepseek.com`).
4. Set the model, hit "Check connection" — a model list should appear.
5. Done — chat, or enable auto-tasks / the publishing queue.

## AI tools (tool calling)

**Read-only:** `get_page_info`, `get_feed`, `scroll_feed`, `search_threads`, `open_thread`, `get_comments`, `inspect_page`, `search_web`, `fetch_page`.

**Actions (confirmation required):** `draft_post`, `publish_draft`, `reply_to_thread`, `send_reply`, `reply_to_comment`, `cancel_draft`.

Threads limits are enforced automatically: post, reply and comment are capped at 500 characters, max 5 links and 10 media items.

## Structure

```
background.js      — service layer: API calls, tool loop, auto-tasks,
                     publish queue, alarms, ban protection
content.js         — Threads page script: DOM parsing, tool implementations
popup/             — UI (HTML + CSS + JS + RU/EN i18n)
icons/             — 16/48/128 icons
gen_icons.py       — icon generator (pure Python, no dependencies)
manifest.json      — MV3: permissions, host_permissions, content_scripts
```

## Security

- The API key is stored in `chrome.storage.local` and is only sent to the Base URL you choose.
- Publishing and replies happen **only** via the on-page confirmation dialog; auto-mode has no write tools.
- Web tools `search_web` / `fetch_page` use a separate `https://html.duckduckgo.com/*` permission and run through a proxied tab, not directly from the background page.
- `https://*/*` in host_permissions exists so the assistant can open articles for fact-checking (fake news).

</details>

## License

MIT
