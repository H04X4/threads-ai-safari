const API = (typeof browser !== "undefined" ? browser : chrome);

const THREADS_RE = /^https:\/\/(www\.)?(threads\.com|threads\.net)\//;
const AUTO_SAFE_TOOLS = new Set(["get_page_info", "get_feed", "scroll_feed", "search_threads", "open_thread", "get_comments", "inspect_page", "search_web", "fetch_page"]);
const DEFAULT_AUTO_TASK = "Прочитай ленту (get_feed + scroll_feed), выбери 2–3 самых интересных поста и составь краткое резюме: о чём они и кто автор. Ничего не публикуй и не отвечай.";
const AUTO_SYSTEM = "Ты — автономный ассистент Threads, работаешь по расписанию без пользователя. Используй только инструменты чтения: get_page_info, get_feed, scroll_feed, search_threads, open_thread, get_comments, inspect_page, search_web, fetch_page. Категорически нельзя публиковать посты, отвечать и ставить лайки. Если в ленте встретится новостной пост — проверь его через search_web (найди первоисточник), при необходимости открой статью через fetch_page и отметь, если новость фейковая. Если страница не открыта или что-то пошло не так — верни отчёт об ошибке. В конце верни краткий отчёт на русском: что сделал, что нашёл, без воды. Не используй эмодзи и смайлики. Лимиты Threads: пост, ответ и комментарий — максимум 500 символов.";

let cachedSettings = null;
let autoRunning = false;
let autoStartedAt = 0;
let autoProgress = null;
let activeChatCtrl = null;
let scheduleRunning = false;

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 90000);
  try {
    return await fetch(url, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const TREND_TASK = "Собери отчёт «Топ-5 тем дня»: прокрути ленту Threads несколько раз, отметь посты с высокой вовлечённостью (лайки/комментарии), при необходимости проверь темы через search_web. Для каждой из 5 тем: название, 1–2 примера постов (автор, лайки, время), почему тема заходит, и 1 идею поста для автора в его нише. Ничего не публикуй.";
const TREND_SYSTEM = "Ты — аналитик трендов Threads. Работаешь автономно, без пользователя. Используй только инструменты чтения: get_page_info, get_feed, scroll_feed, search_threads, open_thread, get_comments, inspect_page, search_web, fetch_page. Категорически нельзя публиковать, отвечать и ставить лайки. Ориентируйся на вовлечённость и время постов (posted_raw). Отчёт — на русском, компактный, без воды и без эмодзи.";

const bgPaceLog = [];

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  const s = await API.storage.local.get("settings");
  cachedSettings = s.settings || null;
  return cachedSettings;
}

API.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) cachedSettings = null;
});

function normalizeBase(base) {
  let b = (base || "").trim().replace(/\/+$/, "");
  if (!b) b = "https://opencode.ai/zen/v1";
  if (!/^https?:\/\//.test(b)) b = "https://" + b;
  if (!/\/v\d+$/.test(b)) b = b + "/v1";
  return b;
}

API.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "chat") {
    handleChat(msg, sendResponse);
    return true;
  }
  if (msg && msg.type === "stopChat") {
    if (activeChatCtrl) activeChatCtrl.abort();
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "check") {
    handleCheck(msg, sendResponse);
    return true;
  }
  if (msg && msg.type === "runAuto") {
    runAutoTask({}).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "runTrend") {
    runAutoTask({ isTrend: true }).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "publishNow") {
    publishNow(msg.id).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "autoStatus") {
    API.storage.local.get("autoReport").then((s) => sendResponse({ ok: true, report: s.autoReport || null, progress: autoProgress }));
    return true;
  }
  if (msg && msg.type === "webTool") {
    const handler = msg.tool === "search_web" ? webSearch : msg.tool === "fetch_page" ? webFetch : null;
    if (handler) {
      handler(msg.args || {})
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e).slice(0, 500) }));
      return true;
    }
  }
  if (msg && msg.type === "ensureTab") {
    ensureThreadsTab()
      .then((tab) => sendResponse(tab ? { ok: true, tab: { id: tab.id, url: tab.url || "" } } : { ok: false, error: "Не удалось открыть Threads" }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e).slice(0, 500) }));
    return true;
  }
  return false;
});

async function waitForTabLoad(tabId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 25000)) {
    try {
      const t = await API.tabs.get(tabId);
      if (t && t.status === "complete") return true;
    } catch (e) {
      return false;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function ensureThreadsTab() {
  const found = (await API.tabs.query({ url: "https://www.threads.com/*" }))
    .concat(await API.tabs.query({ url: "https://www.threads.net/*" }));
  let tab = found[0];
  if (tab) return tab;
  tab = await API.tabs.create({ url: "https://www.threads.com/", active: false });
  await waitForTabLoad(tab.id, 25000);
  return tab;
}

const WEB_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function webSearch(args) {
  const query = String((args && args.query) || "").trim();
  if (!query) return { ok: false, error: "Пустой запрос" };

  const parseResults = (html) => {
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && results.length < 8) {
      const clean = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").trim();
      let u = m[1].replace(/&amp;/g, "&");
      if (u.startsWith("//duckduckgo.com/l/?uddg=")) {
        try { u = decodeURIComponent(u.slice("//duckduckgo.com/l/?uddg=".length)); } catch (e) {}
      }
      results.push({ title: clean(m[2]), url: u, snippet: clean(m[3]) });
    }
    return results;
  };

  let results = [];
  for (const endpoint of ["https://html.duckduckgo.com/html/?q=", "https://lite.duckduckgo.com/lite/?q="]) {
    try {
      const res = await fetchWithTimeout(endpoint + encodeURIComponent(query), {
        headers: { "User-Agent": WEB_UA, "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8" }
      }, 30000);
      if (!res.ok) continue;
      results = parseResults(await res.text());
      if (results.length) break;
    } catch (e) {}
  }
  if (!results.length) return { ok: true, results: [], note: "Поиск ничего не нашёл (движок мог заблокировать запрос). Попробуй переформулировать запрос или открой статью напрямую через fetch_page." };
  return { ok: true, results };
}

async function webFetch(args) {
  const url = String((args && args.url) || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "URL должен начинаться с http(s)://" };
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": WEB_UA } }, 60000);
  if (!res.ok) return { ok: false, error: "HTTP " + res.status };
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ").trim();
  return { ok: true, url, text: text.slice(0, 12000) };
}

async function chatOnce(settings, messages, tools) {
  const base = normalizeBase(settings.baseUrl);
  const body = {
    model: (settings.model || "deepseek-v4-flash-free").trim(),
    messages,
    tool_choice: "auto",
    stream: false,
    max_tokens: 2048
  };
  if (tools && tools.length) body.tools = tools;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(base + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + settings.apiKey.trim()
        },
        body: JSON.stringify(body)
      }, 120000);
    } catch (e) {
      if (attempt === 3) return { ok: false, error: "Ошибка запроса: " + String((e && e.message) || e).slice(0, 500) };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data && data.error && (data.error.message || JSON.stringify(data.error))) || "HTTP " + res.status;
      if (res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      return { ok: false, error: String(err).slice(0, 500) };
    }
    const message = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const toolCalls = message.tool_calls && message.tool_calls.length ? message.tool_calls : undefined;
    return { ok: true, content: message.content || "", toolCalls, usage: data.usage || null };
  }
  return { ok: false, error: "Сервер не ответил" };
}

const TOOLS_AUTO = [
  { type: "function", function: { name: "get_page_info", description: "Узнать, какая страница открыта.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "inspect_page", description: "Технический осмотр страницы.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_feed", description: "Вернуть посты, видимые на странице (автор, текст, лайки, комментарии, время создания posted_raw).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "scroll_feed", description: "Прокрутить страницу.", parameters: { type: "object", properties: { direction: { type: "string", enum: ["down", "up"] }, amount: { type: "string", enum: ["small", "medium", "big"] } }, required: ["direction"] } } },
  { type: "function", function: { name: "search_threads", description: "Поиск постов по запросу.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "open_thread", description: "Открыть пост по URL.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "get_comments", description: "Комментарии открытого поста.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "search_web", description: "Поиск в интернете (DuckDuckGo) — проверка новостей, первоисточники.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "fetch_page", description: "Прочитать текст статьи по URL.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } }
];

async function handleChat(msg, sendResponse) {
  const ctrl = (activeChatCtrl = new AbortController());
  try {
    const settings = msg.settings || (await getSettings());
    if (!settings || !settings.apiKey) {
      sendResponse({ ok: false, error: "Нет API-ключа. Откройте настройки расширения." });
      return;
    }
    const base = normalizeBase(settings.baseUrl);
    const body = {
      model: (settings.model || "deepseek-v4-flash-free").trim(),
      messages: msg.messages,
      tool_choice: "auto",
      stream: false,
      max_tokens: 2048
    };
    if (msg.tools && msg.tools.length) body.tools = msg.tools;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res;
      try {
        res = await fetchWithTimeout(base + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + settings.apiKey.trim()
          },
          body: JSON.stringify(body),
          signal: ctrl.signal
        }, 120000);
      } catch (e) {
        if (ctrl.signal.aborted) {
          sendResponse({ ok: false, stopped: true, error: "Остановлено" });
          return;
        }
        if (attempt === 3) {
          sendResponse({ ok: false, error: "Ошибка запроса: " + String((e && e.message) || e).slice(0, 500) });
          return;
        }
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (data && data.error && (data.error.message || JSON.stringify(data.error))) || "HTTP " + res.status;
        if (res.status >= 500 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        sendResponse({ ok: false, error: String(err).slice(0, 500) });
        return;
      }
      const choice = data.choices && data.choices[0];
      const message = (choice && choice.message) || {};
      const toolCalls = message.tool_calls && message.tool_calls.length ? message.tool_calls : undefined;
      sendResponse({
        ok: true,
        content: message.content || "",
        toolCalls,
        usage: data.usage || null
      });
      return;
    }
  } catch (e) {
    if (ctrl.signal.aborted) {
      sendResponse({ ok: false, stopped: true, error: "Остановлено" });
      return;
    }
    sendResponse({ ok: false, error: "Ошибка запроса: " + e.message });
  } finally {
    if (activeChatCtrl === ctrl) activeChatCtrl = null;
  }
}

async function handleCheck(msg, sendResponse) {
  try {
    const settings = msg.settings;
    if (!settings || !settings.apiKey) {
      sendResponse({ ok: false, error: "Введите API-ключ" });
      return;
    }
    const base = normalizeBase(settings.baseUrl);
    const res = await fetchWithTimeout(base + "/models", {
      headers: { "Authorization": "Bearer " + settings.apiKey.trim() }
    }, 30000);
    if (!res.ok) {
      sendResponse({ ok: false, error: "HTTP " + res.status + " — ключ или адрес не подходят" });
      return;
    }
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id);
    sendResponse({ ok: true, models: ids });
  } catch (e) {
    sendResponse({ ok: false, error: "Ошибка: " + e.message });
  }
}

const DEFAULT_AUTO_TRAITS = { tone: 50, emoji: 0, humor: 40, length: 50, formal: 30 };

function autoTraitsPrompt(settings) {
  const T = { ...DEFAULT_AUTO_TRAITS, ...((settings && settings.traits) || {}) };
  return [
    "Личные настройки стиля пользователя (шкала 0–100):",
    "— тон живости: " + T.tone + " (меньше 40 — сдержанно, больше 60 — живо)",
    "— эмодзи: " + T.emoji + " (меньше 40 — почти без эмодзи и смайликов)",
    "— юмор: " + T.humor + " (меньше 40 — серьёзно, больше 60 — с юмором)",
    "— длина текстов: " + T.length + " (меньше 40 — коротко, больше 60 — развёрнуто)",
    "— формальность: " + T.formal + " (меньше 40 — просто и неформально, больше 60 — официально)"
  ].join("\n");
}

function autoConfig(settings) {
  const auto = (settings && settings.auto) || {};
  return {
    enabled: !!auto.enabled,
    intervalMin: Math.max(15, Math.min(1440, parseInt(auto.intervalMin, 10) || 120)),
    task: (auto.task && String(auto.task).trim()) || DEFAULT_AUTO_TASK
  };
}

async function injectContentScript(tabId) {
  try {
    if (API.scripting && API.scripting.executeScript) {
      await API.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return true;
    }
  } catch (e) {}
  try {
    if (API.tabs && API.tabs.executeScript) {
      await API.tabs.executeScript(tabId, { file: "content.js" });
      return true;
    }
  } catch (e) {}
  return false;
}

async function sendToTabWithRetry(tab, msg) {
  let r;
  try {
    r = await API.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    r = null;
  }
  if (!r || !r.ok) {
    const injected = await injectContentScript(tab.id);
    if (injected) {
      await new Promise((res) => setTimeout(res, 800));
      try {
        r = await API.tabs.sendMessage(tab.id, msg);
      } catch (e) {
        r = null;
      }
      if (r && r.ok) return r;
    }
  }
  return r;
}

async function runAutoTask(opts) {
  if (autoRunning) {
    if (Date.now() - autoStartedAt < 240000) return { ok: false, error: "Автозадача уже выполняется — подождите или повторите через пару минут" };
    autoRunning = false;
  }
  autoRunning = true;
  autoStartedAt = Date.now();
  autoProgress = { running: true, phase: "start", step: 0, tool: null };
  const isTrend = !!(opts && opts.isTrend);
  const started = Date.now();
  try {
    const settings = await getSettings();
    if (!settings || !settings.apiKey) return { ok: false, error: "Нет API-ключа. Откройте настройки расширения." };
    const cfg = autoConfig(settings);
    const tabs = await API.tabs.query({});
    let tab = tabs.find((t) => t.id != null && t.url && THREADS_RE.test(t.url));
    if (!tab) {
      tab = await ensureThreadsTab();
    }
    if (!tab) {
      await saveAutoReport(started, "Нет открытой вкладки Threads — пропускаю запуск.", false);
      return { ok: false, error: "нет вкладки Threads" };
    }
    await waitForTabLoad(tab.id, 25000);
    autoProgress = { running: true, phase: "tab", step: 0, tool: null };
    const styleBlock = settings.styleGuide ? "\n\nСтиль автора (если понадобится писать в его манере):\n" + settings.styleGuide : "";
    const system = isTrend
      ? TREND_SYSTEM + styleBlock + "\n\n" + autoTraitsPrompt(settings)
      : AUTO_SYSTEM + styleBlock + "\n\n" + autoTraitsPrompt(settings);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: isTrend ? TREND_TASK : cfg.task }
    ];
    let report = "";
    for (let step = 0; step < 10; step++) {
      const resp = await chatOnce(settings, messages, TOOLS_AUTO);
      if (!resp.ok) return { ok: false, error: resp.error };
      const asst = { role: "assistant", content: resp.content || "" };
      if (resp.toolCalls && resp.toolCalls.length) asst.tool_calls = resp.toolCalls;
      messages.push(asst);
      if (!resp.toolCalls || !resp.toolCalls.length) {
        report = resp.content || "";
        break;
      }
      for (const tc of resp.toolCalls) {
        const name = tc.function && tc.function.name;
        let args = {};
        try { args = JSON.parse((tc.function && tc.function.arguments) || "{}"); } catch (e) {}
        autoProgress = { running: true, phase: "tool", step: step + 1, tool: name };
        let result;
        if (!AUTO_SAFE_TOOLS.has(name)) {
          result = { ok: false, error: "Авто-режим не выполняет публикующие действия" };
        } else if (name === "search_web" || name === "fetch_page") {
          try {
            result = await (name === "search_web" ? webSearch(args) : webFetch(args));
          } catch (e) {
            result = { ok: false, error: String((e && e.message) || e).slice(0, 500) };
          }
        } else {
          const paceErr = await bgPace(settings);
          if (paceErr) {
            result = { ok: false, error: paceErr };
          } else {
            try {
              result = await sendToTabWithRetry(tab, { type: "tool", tool: name, args });
            } catch (e) {
              result = { ok: false, error: "Скрипт на странице недоступен: " + e.message };
            }
          }
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    autoProgress = { running: true, phase: "report", step: 0, tool: null };
    if (!report) {
      const lastAsst = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
      report = (lastAsst && lastAsst.content) || "";
    }
    if (isTrend) {
      await saveTrendReport(started, report || "Отчёт не составлен: ИИ не вернул текст. Попробуйте ещё раз.", true);
      return { ok: true, report: (report || "").slice(0, 3000) };
    }
    await saveAutoReport(started, report || "Задача выполнена без ответа.", true);
    return { ok: true, report: (report || "").slice(0, 3000) };
  } catch (e) {
    const err = String((e && e.message) || e).slice(0, 500);
    if (isTrend) await saveTrendReport(started, "Ошибка: " + err, false).catch(() => {});
    else await saveAutoReport(started, "Ошибка: " + err, false).catch(() => {});
    return { ok: false, error: err };
  } finally {
    autoRunning = false;
    autoProgress = null;
  }
}

async function saveAutoReport(time, text, ok) {
  await API.storage.local.set({ autoReport: { time, report: String(text).slice(0, 3000), ok } });
}

async function saveTrendReport(time, text, ok) {
  const s = await API.storage.local.get("settings");
  const settings = s.settings || {};
  const list = Array.isArray(settings.trendReports) ? settings.trendReports : [];
  list.unshift({ time, report: String(text).slice(0, 3000), ok });
  settings.trendReports = list.slice(0, 7);
  await API.storage.local.set({ settings });
}

async function bgPace(settings) {
  const p = (settings && settings.pacing) || {};
  if (!p.enabled) return null;
  const now = Date.now();
  while (bgPaceLog.length && now - bgPaceLog[0] > 3600000) bgPaceLog.shift();
  if (bgPaceLog.length >= (p.perHour || 25)) {
    return "Достигнут лимит действий в час (" + (p.perHour || 25) + ") — защита от бана";
  }
  const base = Math.max(5, Math.min(300, parseInt(p.delaySec, 10) || 30));
  await new Promise((r) => setTimeout(r, (base + Math.random() * base * 2) * 1000));
  bgPaceLog.push(Date.now());
  return null;
}

function ensureAlarm(settings) {
  const cfg = autoConfig(settings);
  if (!API.alarms) return;
  if (cfg.enabled) {
    API.alarms.create("threadsAuto", { periodInMinutes: cfg.intervalMin });
  } else {
    API.alarms.clear("threadsAuto");
  }
  API.alarms.create("scheduleTick", { periodInMinutes: 1 });
}

function splitThread(text, limit) {
  const body = String(text || "").trim();
  if (body.length <= limit) return [body];
  const chunks = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const piece of body.split(/(?<=[.!?…]+)\s+/)) {
    if (cur && cur.length + 1 + piece.length <= limit) {
      cur += " " + piece;
      continue;
    }
    push();
    if (piece.length <= limit) {
      cur = piece;
      continue;
    }
    for (const word of piece.split(/\s+/)) {
      let w = word;
      while (w.length > limit) {
        cur = w.slice(0, limit);
        push();
        w = w.slice(limit);
      }
      if (!cur) {
        cur = w;
        continue;
      }
      if (cur.length + 1 + w.length <= limit) cur += " " + w;
      else {
        push();
        cur = w;
      }
    }
  }
  push();
  return chunks.length ? chunks : [body];
}

async function publishPart(tab, item, partText) {
  const res = await sendToTabWithRetry(tab, { type: "tool", tool: "draft_post", args: { text: partText } });
  if (!(res && res.ok && res.needsConfirm)) {
    item.error = ((res && res.error) || "не удалось подготовить черновик");
    return false;
  }
  await new Promise((r) => setTimeout(r, 1500));
  const pub = await sendToTabWithRetry(tab, { type: "tool", tool: "publish_draft", args: {} });
  if (pub && pub.ok) return true;
  item.error = ((pub && pub.error) || "не удалось опубликовать");
  return false;
}

async function publishQueueItem(item) {
  if (item.publishing) return false;
  item.publishing = true;
  try {
    const tab = await ensureThreadsTab();
    if (!tab) {
      item.error = "нет вкладки Threads";
      return false;
    }
    const parts = splitThread(item.text, 500);
    if (!(await publishPart(tab, item, parts[0]))) return false;
    for (let i = 1; i < parts.length; i++) {
      const res = await sendToTabWithRetry(tab, { type: "tool", tool: "reply_to_thread", args: { text: parts[i] } });
      if (!(res && res.ok && res.needsConfirm)) {
        item.error = "часть " + (i + 1) + "/" + parts.length + ": " + ((res && res.error) || "не удалось открыть ответ");
        return false;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const sent = await sendToTabWithRetry(tab, { type: "tool", tool: "send_reply", args: {} });
      if (!(sent && sent.ok)) {
        item.error = "часть " + (i + 1) + "/" + parts.length + ": " + ((sent && sent.error) || "не удалось отправить");
        return false;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    item.posted = true;
    item.error = null;
    return true;
  } finally {
    item.publishing = false;
  }
}

async function publishNow(id) {
  try {
    const s = await API.storage.local.get("settings");
    const settings = s.settings || {};
    const queue = Array.isArray(settings.schedule) ? settings.schedule : [];
    const item = queue.find((x) => x && x.id === id);
    if (!item) return { ok: false, error: "пост не найден в очереди" };
    if (item.posted) return { ok: false, error: "пост уже опубликован" };
    if (item.publishing) return { ok: false, error: "пост уже публикуется" };
    const okNow = await publishQueueItem(item);
    await API.storage.local.set({ settings });
    return okNow ? { ok: true } : { ok: false, error: item.error || "не удалось опубликовать" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function checkSchedule() {
  if (scheduleRunning) return;
  scheduleRunning = true;
  try {
    const s = await API.storage.local.get("settings");
    const settings = s.settings || {};
    const queue = Array.isArray(settings.schedule) ? settings.schedule : [];
    const due = queue.filter((x) => x && !x.posted && !x.publishing && x.at <= Date.now());
    if (!due.length) return;
    const tab = await ensureThreadsTab();
    if (!tab) return;
    for (const item of due) {
      const paceErr = await bgPace(settings);
      if (paceErr) {
        item.error = paceErr;
        continue;
      }
      const okPub = await publishQueueItem(item);
      if (API.notifications) {
        const icon = API.runtime.getURL("icons/icon128.png");
        API.notifications.create("post_" + item.id, {
          type: "basic",
          iconUrl: icon,
          title: okPub ? "Пост опубликован" : "Пост не опубликован",
          message: (item.text || "").slice(0, 120) || "…"
        }).catch(() => {});
      }
    }
    await API.storage.local.set({ settings });
  } catch (e) {}
  finally { scheduleRunning = false; }
}

API.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    cachedSettings = null;
    changes.settings.newValue && ensureAlarm(changes.settings.newValue);
  }
});

if (API.alarms) {
  API.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === "threadsAuto") runAutoTask({});
    if (alarm && alarm.name === "scheduleTick") checkSchedule();
  });
}

getSettings().then(ensureAlarm).catch(() => {});

