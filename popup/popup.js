const API = (typeof browser !== "undefined" ? browser : chrome);
const MAX_STEPS = 16;
const MAX_HISTORY = 40;
const MAX_CONVOS = 12;
const CONTENT_MATCH = /^https:\/\/(www\.)?(threads\.com|threads\.net)\//;

const WEB_TOOLS = ["search_web", "fetch_page"];
const t = (k) => window.ThreadsI18n.t(k);

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_page_info",
      description: "Узнать, на какой странице Threads сейчас находится пользователь: URL, тип страницы (лента, профиль, пост, поиск) и что на ней видно.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_feed",
      description: "Вернуть посты, которые сейчас видимы на странице (лента, профиль, поиск). Возвращает автора, текст, ссылку, лайки, комментарии и время создания (posted_raw, например «5ч» — 5 часов назад).",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll_feed",
      description: "Прокрутить страницу, чтобы увидеть больше постов. Возвращает только новые посты.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["down", "up"], description: "Куда листать" },
          amount: { type: "string", enum: ["small", "medium", "big"], description: "Насколько сильно листать" }
        },
        required: ["direction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_threads",
      description: "Найти посты по запросу: открывает поиск на Threads и возвращает результаты.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Поисковый запрос" } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_thread",
      description: "Открыть конкретный пост по URL (например https://www.threads.com/@user/post/xxx) и вернуть его содержимое.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Полный URL поста" } },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_comments",
      description: "Вернуть комментарии открытого поста: авторы, тексты, лайки. Первый элемент — сам пост.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "reply_to_comment",
      description: "Подготовить ответ на конкретный комментарий (по index из get_comments или по author). Открывает поле ответа под комментарием и вводит текст. НЕ отправляет — отправку подтверждает пользователь.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Номер комментария из get_comments (0 — сам пост)" },
          author: { type: "string", description: "Или ник автора комментария" },
          text: { type: "string", description: "Текст ответа" }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "inspect_page",
      description: "Технический осмотр страницы: URL, тип страницы, количество кнопок/ссылок/полей, структура. Используй, если инструменты работают странно или нужных элементов не видно.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "draft_post",
      description: "Подготовить новый пост: открывает редактор и вводит текст. НЕ публикует — публикацию подтверждает пользователь.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "Текст поста" } },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reply_to_thread",
      description: "Подготовить ответ на открытый пост: вводит текст ответа в поле комментария. НЕ отправляет — отправку подтверждает пользователь.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "Текст ответа" } },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancel_draft",
      description: "Отменить текущий черновик поста и закрыть редактор без публикации.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Поиск в интернете (DuckDuckGo). Используй для проверки новостей на достоверность: например, введите заголовок новости из поста, чтобы найти первоисточники и опровержения.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Поисковый запрос" } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description: "Прочитать текст статьи по URL (после search_web). Возвращает текст страницы без разметки (первые ~12 тысяч символов).",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Полный URL (https://…)" } },
        required: ["url"]
      }
    }
  }
];

const SYSTEM = `Ты — AI-ассистент внутри браузера, работающий на странице Threads (threads.com) от имени пользователя.

Твои возможности (через инструменты):
- get_page_info — узнать, на какой странице сейчас пользователь (лента, профиль, пост, поиск)
- get_feed — прочитать посты, видимые на странице
- scroll_feed — листать ленту
- search_threads — искать посты по запросу
- open_thread — открыть конкретный пост по URL
- get_comments — читать комментарии открытого поста (первый элемент — сам пост)
- reply_to_comment — подготовить ответ на конкретный комментарий (по index или author)
- draft_post — подготовить новый пост (НЕ публикует сам)
- reply_to_thread — подготовить ответ на пост (НЕ отправляет сам)
- cancel_draft — закрыть черновик
- inspect_page — технический осмотр страницы, если что-то работает неожиданно
- search_web — поиск в интернете (DuckDuckGo): проверка новостей, поиск первоисточников
- fetch_page — прочитать текст статьи по URL

Правила:
1. Если пользователь спрашивает «где я?», «на какой странице?» или просит осмотреться — сначала используй get_page_info.
2. Если пользователь просит что-то найти или посмотреть — сначала используй get_feed / scroll_feed / search_threads, потом отвечай по факту содержимого.
3. Если пользователь просит ответить на комментарии — сначала get_comments, затем reply_to_comment для каждого нужного (укажи index или author). По одному комментарию за раз.
4. Публикацию всегда начинай с draft_post (или reply_to_thread / reply_to_comment). После этого остановись и дождись, пока пользователь подтвердит публикацию в интерфейсе. Никогда не проси пользователя публиковать вручную — он подтвердит прямо в расширении.
5. Если инструмент вернул ошибку или странный результат — вызови inspect_page, чтобы понять структуру страницы, и действуй по факту.
6. Пиши в той же манере и на том же языке, что и пользователь. Для постов — живо, естественно, без канцелярита, без кавычек вокруг хэштегов. Эмодзи и смайлики по умолчанию НЕ используй — только если пользователь явно попросил или его стиль-гайд это подтверждает.
7. Когда результат инструмента не содержит постов (пустая лента) — скажи об этом честно.
8. Не придумывай статистику. Отвечай только на основе того, что вернули инструменты.
9. Если в ленте встречается новостной пост (политика, катастрофы, события) — проверь его через search_web: найди первоисточник, сравни формулировки. Если новость фейковая или искажённая — скажи об этом прямо, сославшись на найденные источники.
10. Если пользователь пишет не по теме Threads (код, математика) — кратко ответь, но вежливо предложи вернуться к Threads.
11. Лимиты Threads: пост, ответ и комментарий — максимум 500 символов (включая пробелы и эмодзи), до 5 ссылок на пост. Всегда укладывайся в лимиты: перед draft_post / reply_to_thread / reply_to_comment считай длину текста.
12. Если draft_post или другой инструмент вернул ошибку про лимит — сократи текст и попробуй снова, не спрашивая пользователя.
13. У каждого поста из инструментов есть время создания: posted_raw (например «сейчас», «5ч», «2дн») и posted_ms (точная дата, если удалось вычислить). Когда пользователь просит «свежие», «недавние», «за последние N часов» — фильтруй посты по этому полю и указывай время каждого отобранного поста. Если времени нет — честно скажи об этом.`;

const $ = (id) => document.getElementById(id);

const FICTION_SYSTEM = `Режим «Выдумка» — включён. Ты — рассказчик выдуманных историй для Threads.

Пользователь просит придумать историю. Это художественный вымысел: пиши смело и творчески, на любую тему — личные переживания, неожиданные повороты, тёплые финалы. Не выдавай выдумку за реальные факты из жизни пользователя.

Формат истории (важно соблюдать):
1. Одна история — это ветка из 2–6 постов (частей). Число частей выбирай сама: 2 для короткой истории, больше для насыщенной.
2. Каждая часть — не более 250 символов. Дели по смыслу; в конце каждой части оставляй интригу или незавершённую мысль, чтобы захотелось читать дальше.
3. В конце каждой части на отдельной строке пиши маркер части: «1/3», «2/3», «3/3».
4. Первая часть — цепляющий хук: конкретная деталь, загадка, диалог, неожиданный факт. Пример: «Мне было 14, когда дедушка дал мне старый запечатанный конверт. Он сказал только одну фразу: „Не открывай его, пока тебе не исполнится 18“…»
5. Стиль — как в примере: повествование от первого лица, простые живые фразы, тёплые бытовые детали, эмоции. Без канцелярита, без сухих формулировок.
6. Последняя часть — эмоциональный финал или вывод, и в самом конце вопрос читателям, приглашающий обсудить в комментариях. Пример: «Как думаете… Что бы вы хотели прочитать в письме, которое вам оставили на будущее? 👇»
7. Никогда не публикуй историю в Threads и не предлагай публикацию: у тебя нет для этого инструментов в этом режиме. Пользователь сам скопирует текст кнопкой и опубликует его, как захочет. Просто напиши готовую историю.
8. Написанную историю показывай целиком в чате одним сообщением (все части подряд, с маркерами).
9. Никогда не задавай пользователю уточняющих вопросов в чате (ни про жанр, ни про тему, ни про детали) и не уточняй, что ему нужно. Жанр пользователь выбирает кнопками в интерфейсе; если он выбрал «Случайная» или прислал только тему/просьбу — жанр, сюжет и детали придумай сама и сразу пиши историю. Вопросы можно задавать только читателям — в финале самой истории.
10. Истории должны читаться как реальные жизненные посты, приближенные к жизни. Обязательно конкретика: у героя есть имя (для русской истории — русское имя, например Вера, Денис, Саша) и возраст; всегда назван город или место действия (Москва, Челябинск, дача под Саратовом, маленький посёлок); упомянуты профессия или род занятий героя и время действия (утро, зима, вечер пятницы). Используй живые бытовые детали: кухня, дорога в метро, телефонный звонок, очередь в магазине, запах кофе. Избегай абстракций вроде «один человек», «где-то», «какой-то город» — у каждой детали должно быть конкретное наполнение, чтобы история звучала правдоподобно.`;

const state = {
  settings: null,
  history: [],
  convos: [],
  activeId: null,
  pending: null,
  pendingConfirm: null,
  busy: false,
  started: false,
  fiction: false,
  storyActive: false
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const DEFAULT_TRAITS = { tone: 50, emoji: 0, humor: 40, length: 50, formal: 30 };

const TRAIT_DEFS = [
  { key: "tone", label: { ru: "Живость тона", en: "Tone energy" }, l: { ru: "Сдержанный", en: "Calm" }, r: { ru: "Живой", en: "Lively" } },
  { key: "emoji", label: { ru: "Эмодзи", en: "Emoji" }, l: { ru: "Без эмодзи", en: "None" }, r: { ru: "Много", en: "Many" } },
  { key: "humor", label: { ru: "Юмор", en: "Humor" }, l: { ru: "Серьёзный", en: "Serious" }, r: { ru: "Шутливый", en: "Playful" } },
  { key: "length", label: { ru: "Длина текстов", en: "Length" }, l: { ru: "Коротко", en: "Short" }, r: { ru: "Развёрнуто", en: "Long" } },
  { key: "formal", label: { ru: "Формальность", en: "Formality" }, l: { ru: "Просто", en: "Casual" }, r: { ru: "Официально", en: "Formal" } }
];

function traitsPrompt() {
  const T = { ...DEFAULT_TRAITS, ...(state.settings.traits || {}) };
  return [
    "Личные настройки стиля пользователя (шкала 0–100):",
    "— тон живости: " + T.tone + " (меньше 40 — сдержанно, больше 60 — живо)",
    "— эмодзи: " + T.emoji + " (меньше 40 — почти без эмодзи и смайликов)",
    "— юмор: " + T.humor + " (меньше 40 — серьёзно, больше 60 — с юмором)",
    "— длина текстов: " + T.length + " (меньше 40 — коротко, больше 60 — развёрнуто)",
    "— формальность: " + T.formal + " (меньше 40 — просто и неформально, больше 60 — официально)",
    "Соблюдай эти настройки при написании постов, ответов и комментариев."
  ].join("\n");
}

function renderTraits() {
  const wrap = $("traits");
  if (!wrap) return;
  wrap.innerHTML = "";
  const T = { ...DEFAULT_TRAITS, ...(state.settings.traits || {}) };
  const L = state.settings.language === "en" ? "en" : "ru";
  for (const def of TRAIT_DEFS) {
    const row = document.createElement("div");
    row.className = "trait";
    const head = document.createElement("div");
    head.className = "trait-head";
    const label = document.createElement("span");
    label.textContent = def.label[L] || def.label.ru;
    const val = document.createElement("span");
    val.className = "trait-val";
    val.textContent = T[def.key];
    head.append(label, val);
    const input = document.createElement("input");
    input.type = "range";
    input.min = 0;
    input.max = 100;
    input.step = 5;
    input.value = T[def.key];
    const ends = document.createElement("div");
    ends.className = "trait-ends";
    const l = document.createElement("span");
    l.textContent = def.l[L] || def.l.ru;
    const r = document.createElement("span");
    r.textContent = def.r[L] || def.r.ru;
    ends.append(l, r);
    input.addEventListener("input", () => {
      val.textContent = input.value;
      state.settings.traits = { ...(state.settings.traits || {}), [def.key]: +input.value };
      saveTraits();
    });
    row.append(head, input, ends);
    wrap.appendChild(row);
  }
}

function saveTraits() {
  clearTimeout(saveTraits._t);
  saveTraits._t = setTimeout(async () => {
    await API.storage.local.set({ settings: state.settings });
  }, 400);
}

const DEFAULT_AUTO = {
  enabled: false,
  intervalMin: 120,
  task: "Прочитай ленту (get_feed + scroll_feed), выбери 2–3 самых интересных поста и составь краткое резюме: о чём они и кто автор. Ничего не публикуй и не отвечай."
};

const DEFAULT_PACING = { enabled: false, delaySec: 30, perHour: 25 };

const ACTION_TOOLS = new Set(["draft_post", "reply_to_thread", "reply_to_comment", "cancel_draft", "publish_draft", "send_reply"]);
const pacingLog = [];

const STUDY_SYSTEM = `Ты анализируешь стиль письма пользователя Threads по его собственным постам (тексты ниже).
Верни компактный «стиль-гайд» на русском языке: тональность, типичная длина, использование эмодзи, хэштеги, темы, особенности (капс, пунктуация, сокращения, юмор).
Формат: 5–7 коротких пунктов через перевод строки, без воды, только факты из постов.`;

const DEFAULT_IDEAS_GEN = { count: 10, hype: 70, topic: "" };

function ideasSystem() {
  const g = { ...DEFAULT_IDEAS_GEN, ...(state.settings.ideasGen || {}) };
  const count = Math.max(5, Math.min(20, parseInt(g.count, 10) || 10));
  const hype = Math.max(0, Math.min(100, parseInt(g.hype, 10) || 70));
  const topic = String(g.topic || "").trim();
  const hypeLine = hype < 40
    ? "Идеи — спокойные, полезные, экспертные; без кликбейта."
    : hype < 70
      ? "Идеи — живые и трендовые: опирайся на виральные форматы из ленты, добавляй угол «почему это важно сейчас»."
      : "Идеи — максимально вирусные: цепляющие хуки, провокационные вопросы, мемные форматы, личные истории. Факты должны быть правдивыми, без вранья и кликбейт-наглости.";
  return [
    "Ты — креативный копирайтер для Threads. По постам из ленты определи текущие тренды и форматы, которые заходят, и придумай " + count + " идей постов для автора.",
    hypeLine,
    topic ? "Особый фокус автора: посты про «" + topic + "». Большую часть идей сделай на эту тему, но 2–3 — из общих трендов ленты." : "",
    "Используй эти 5 проверенных формул вирусных заголовков (бери структуру, НЕ копируй дословно, подставляй реальные боли аудитории):",
    "Формула 1 — «Я сделал X — получил Y»: конкретное действие + измеримый или неожиданный результат. Пример: «Я 30 дней отвечал на тревожные мысли иначе — вот что произошло с моим состоянием».",
    "Формула 2 — «Никто не говорит о...»: ощущение скрытого знания, то, что обычно остаётся за кадром. Пример: «Никто не говорит, что постоянная усталость часто начинается не с работы, а с внутреннего напряжения».",
    "Формула 3 — «5 признаков, что...»: человек автоматически начинает проверять себя. Пример: «5 признаков, что вы живете в тревоге, но считаете это своим характером».",
    "Формула 4 — «Перестаньте делать [действие]. Именно это мешает вам [результат]»: идёт против привычного поведения. Пример: «Перестаньте ждать идеального момента — мозг будет искать новую причину отложить».",
    "Формула 5 — «Если вы замечаете это у себя...»: попадание в боль, человек узнаёт себя уже в первой строке. Пример: «Если вы постоянно устаёте после общения с людьми — причина может быть не в людях».",
    "Распредели идеи примерно равномерно по этим 5 формулам. Формула — это хук/заголовок идеи, содержание должно быть реальным, честным и полезным для аудитории.",
    "Каждая идея — это тема + цепляющий хук или угол подачи: одна идея = 1–2 предложения (до 300 символов), из которых легко развернуть полноценный пост.",
    "Формат ответа — строго: номер «1.» «2.» … и т.д., каждая идея с новой строки, без преамбул, подзаголовков и пустых строк.",
    "Без эмодзи и смайликов."
  ].filter(Boolean).join("\n");
}

const SCHEDULE_SYSTEM = `Ты — копирайтер Threads. Преврати идею ниже в готовый пост: максимум 500 символов (считай!), без эмодзи и смайликов, живо и естественно, без канцелярита и кавычек вокруг хэштегов. Соблюдай стиль и характер автора из системных сообщений.
Верни строго только текст поста — без преамбул, кавычек и комментариев.`;

init();

async function init() {
  const stored = await API.storage.local.get(["settings", "history", "convos", "activeId"]);
  state.settings = stored.settings || {};
  if (!state.settings.baseUrl) state.settings.baseUrl = "https://opencode.ai/zen/v1";
  if (!state.settings.model) state.settings.model = "deepseek-v4-flash-free";
  if (state.settings.confirm === undefined) state.settings.confirm = true;
  state.settings.auto = { ...DEFAULT_AUTO, ...(state.settings.auto || {}) };
  state.settings.traits = { ...DEFAULT_TRAITS, ...(state.settings.traits || {}) };
  state.settings.pacing = { ...DEFAULT_PACING, ...(state.settings.pacing || {}) };
  state.settings.ideasGen = { ...DEFAULT_IDEAS_GEN, ...(state.settings.ideasGen || {}) };
  if (!state.settings.scheduleInterval) state.settings.scheduleInterval = 120;
  if (!Array.isArray(state.settings.schedule)) state.settings.schedule = [];
  if (!Array.isArray(state.settings.trendReports)) state.settings.trendReports = [];
  if (state.settings.language !== "en") state.settings.language = "ru";
  state.convos = Array.isArray(stored.convos) ? stored.convos : [];
  state.fiction = !!state.settings.fictionMode;
  updateFictionUI();

  const saved = repairToolPairs(sanitizeHistory(Array.isArray(stored.history) ? stored.history : []));
  if (saved.length) {
    state.history = saved;
    state.started = true;
    state.activeId = stored.activeId || genId();
    upsertConvo();
    renderHistory();
  } else {
    state.activeId = genId();
    if (state.settings.apiKey) showEmpty();
    else showSetup();
  }

  window.ThreadsI18n.setLang(state.settings.language);
  renderTraits();
  const chip = $("modelChip");
  chip.hidden = true;
  fillSettingsFields();
  renderScheduleList();
  renderTrendReports();
  if (state.settings.styleGuide) showStyle(state.settings.styleGuide);
  refreshAutoReport();
  await API.storage.local.set({ settings: state.settings });
}

function showView(which) {
  const chat = which === "chat";
  $("viewChat").hidden = !chat;
  $("viewSettings").hidden = which !== "settings";
  $("viewHistory").hidden = which !== "history";
  $("viewProfile").hidden = which !== "profile";
  $("viewIdeas").hidden = which !== "ideas";
  $("backBtn").hidden = chat;
  $("gear").hidden = !chat;
  $("profileBtn").hidden = !chat;
  $("historyBtn").hidden = !chat;
  $("ideasBtn").hidden = !chat;
  if (chat && !$("chat").children.length) {
    if (state.settings.apiKey) showEmpty();
    else showSetup();
  }
}

function convoTitle(messages) {
  const first = messages.find((m) => m.role === "user" && m.content);
  if (first) {
    let text = String(first.content).trim();
    const gm = text.match(/Жанр: «([^»]+)»/);
    if (gm) text = gm[1] + " история";
    else if (/^(Придумай|Напиши) историю/.test(text)) text = "История";
    return text.slice(0, 50);
  }
  return t("sNewChatTitle") + " " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function upsertConvo() {
  const idx = state.convos.findIndex((c) => c.id === state.activeId);
  const trimmed = state.history.slice(-25).map((m) => {
    const out = {
      role: m.role,
      content: typeof m.content === "string" ? m.content.slice(0, 1500) : m.content
    };
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.tool_calls) out.tool_calls = m.tool_calls.slice(0, 8);
    return out;
  });
  const entry = {
    id: state.activeId,
    title: convoTitle(state.history),
    ts: Date.now(),
    fiction: !!state.fiction,
    messages: trimmed
  };
  if (idx >= 0) state.convos[idx] = entry;
  else state.convos.unshift(entry);
  state.convos = state.convos.slice(0, MAX_CONVOS);
}

function fillSettingsFields() {
  $("apiKey").value = state.settings.apiKey || "";
  $("baseUrl").value = state.settings.baseUrl || "";
  $("model").value = state.settings.model || "";
  $("lang").value = state.settings.language;
  $("autoEnabled").checked = !!state.settings.auto.enabled;
  $("autoInterval").value = state.settings.auto.intervalMin || DEFAULT_AUTO.intervalMin;
  $("autoTask").value = state.settings.auto.task || DEFAULT_AUTO.task;
  $("pacingEnabled").checked = !!state.settings.pacing.enabled;
  $("pacingDelay").value = state.settings.pacing.delaySec || DEFAULT_PACING.delaySec;
  $("pacingPerHour").value = state.settings.pacing.perHour || DEFAULT_PACING.perHour;
  $("scheduleInterval").value = state.settings.scheduleInterval || 120;
  $("ideasCount").value = state.settings.ideasGen.count || DEFAULT_IDEAS_GEN.count;
  $("ideasHype").value = state.settings.ideasGen.hype || DEFAULT_IDEAS_GEN.hype;
  $("ideasHypeVal").textContent = $("ideasHype").value;
  $("ideasTopic").value = state.settings.ideasGen.topic || "";
}

async function saveSettings() {
  const min = Math.max(15, Math.min(1440, parseInt($("autoInterval").value, 10) || DEFAULT_AUTO.intervalMin));
  state.settings = {
    ...state.settings,
    baseUrl: $("baseUrl").value.trim(),
    model: $("model").value.trim(),
    apiKey: $("apiKey").value.trim(),
    language: $("lang").value,
    auto: {
      enabled: $("autoEnabled").checked,
      intervalMin: min,
      task: $("autoTask").value.trim() || DEFAULT_AUTO.task
    },
    pacing: {
      enabled: $("pacingEnabled").checked,
      delaySec: Math.max(5, Math.min(300, parseInt($("pacingDelay").value, 10) || DEFAULT_PACING.delaySec)),
      perHour: Math.max(5, Math.min(200, parseInt($("pacingPerHour").value, 10) || DEFAULT_PACING.perHour))
    },
    scheduleInterval: Math.max(5, Math.min(10080, parseInt($("scheduleInterval").value, 10) || 120)),
    ideasGen: {
      count: Math.max(5, Math.min(20, parseInt($("ideasCount").value, 10) || DEFAULT_IDEAS_GEN.count)),
      hype: Math.max(0, Math.min(100, parseInt($("ideasHype").value, 10) || DEFAULT_IDEAS_GEN.hype)),
      topic: $("ideasTopic").value.trim().slice(0, 80)
    }
  };
  await API.storage.local.set({ settings: state.settings });
  const chip = $("modelChip");
  chip.hidden = true;
}

async function persistHistory() {
  const hist = repairToolPairs(state.history.slice(-MAX_HISTORY).map((m) => {
    const out = {
      role: m.role,
      content: typeof m.content === "string" ? m.content.slice(0, 4000) : ""
    };
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    return out;
  }));
  state.history = hist;
  if (hist.length) upsertConvo();
  else state.convos = state.convos.filter((c) => c.id !== state.activeId);
  try {
    await API.storage.local.set({ history: hist, convos: state.convos, activeId: state.activeId });
  } catch (e) {
    try {
      state.convos = state.convos.slice(0, 4);
      await API.storage.local.set({ history: hist, convos: state.convos, activeId: state.activeId });
    } catch (e2) {
      try {
        state.convos = [];
        await API.storage.local.set({ history: hist.slice(-15), convos: [], activeId: state.activeId });
      } catch (e3) {
        console.warn("persistHistory: storage quota exceeded");
      }
    }
  }
}

function repairToolPairs(arr) {
  const out = [];
  const callIds = new Set();
  for (const m of arr) {
    if (!m) continue;
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        if (tc && tc.id) callIds.add(tc.id);
      }
      out.push(m);
    } else if (m.role === "tool") {
      if (m.tool_call_id && callIds.has(m.tool_call_id)) out.push(m);
    } else {
      out.push(m);
    }
  }
  return out;
}

function sanitizeHistory(h) {
  const out = [];
  for (const m of h) {
    if (m && m.role === "tool" && !m.tool_call_id) continue;
    if (m && m.role === "assistant" && m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const ids = new Set((m.tool_calls || []).map((tc) => tc && tc.id));
      if (ids.size) {
        const hasResults = h.some((x) => x && x.role === "tool" && ids.has(x.tool_call_id));
        if (!hasResults) {
          out.push({ role: "assistant", content: m.content || "" });
          continue;
        }
      }
    }
    out.push(m);
  }
  return out;
}

function renderHistory() {
  const chat = $("chat");
  chat.innerHTML = "";
  let lastAiIdx = null;
  state.history.forEach((m, i) => {
    if (m.role === "user" && m.content) addMsg("user", m.content);
    else if (m.role === "assistant" && m.content && (!m.tool_calls || !m.tool_calls.length)) {
      const storyParts = splitStoryParts(m.content);
      if (storyParts.length > 1) {
        for (const p of storyParts) addMsg("ai", p);
      } else {
        addMsg("ai", m.content);
      }
      lastAiIdx = i;
    }
  });
  if (lastAiIdx !== null && !state.busy && !state.history[lastAiIdx].interrupted) addContinueRow(lastAiIdx);
  if (!chat.children.length) {
    if (state.settings.apiKey) showEmpty();
    else showSetup();
  }
}

function addContinueRow(idx) {
  const chat = $("chat");
  const div = document.createElement("button");
  div.className = "continue-btn";
  div.textContent = t("sContinue");
  div.addEventListener("click", () => continueResponse(idx));
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function continueResponse(idx) {
  if (state.busy || !state.settings.apiKey) return;
  const msg = state.history[idx];
  if (!msg || msg.role !== "assistant") return;
  state.busy = true;
  state.stopped = false;
  $("send").disabled = true;
  $("send").hidden = true;
  $("stop").hidden = false;
  const typing = addTyping();
  try {
    const system = [SYSTEM,
      state.settings.styleGuide ? "Стиль автора (как пользователь пишет посты и комментарии — соблюдай его):\n" + state.settings.styleGuide : null,
      traitsPrompt()
    ].filter(Boolean).join("\n\n");
    const resp = await API.runtime.sendMessage({
      type: "chat",
      messages: [
        { role: "system", content: system },
        ...state.history.slice(0, idx + 1),
        { role: "system", content: "Продолжай текст с того места, где остановился. Не повторяй то, что уже написано, верни только продолжение." }
      ],
      tools: [],
      settings: state.settings
    });
    typing.remove();
    if (state.stopped || !resp || !resp.ok) {
      if (state.stopped || (resp && resp.stopped)) return;
      addMsg("ai", "⚠️ " + (resp ? resp.error : "Сеть недоступна"));
      return;
    }
    if (resp.content && resp.content.trim()) {
      msg.content = (msg.content || "") + (msg.content ? "\n\n" : "") + resp.content.trim();
      await persistHistory();
      renderHistory();
    }
  } catch (e) {
    typing.remove();
    if (!state.stopped) addMsg("ai", "⚠️ Ошибка: " + (e && e.message ? e.message : e));
  } finally {
    state.busy = false;
    $("send").disabled = false;
    $("send").hidden = false;
    $("stop").hidden = true;
  }
}

function currentTab() {
  return API.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !CONTENT_MATCH.test(tab.url)) return null;
    return tab;
  });
}

async function sendToTab(tab, msg) {
  try {
    const res = await API.tabs.sendMessage(tab.id, msg);
    if (res === undefined) return { ok: false, error: t("errNotConnected") };
    return res;
  } catch (e) {
    return { ok: false, error: t("errNotConnected") };
  }
}

async function sendToTabWithRetry(tab, msg) {
  let r = await sendToTab(tab, msg);
  if (!r.ok && r.error === t("errNotConnected")) {
    const injected = await injectContentScript(tab.id);
    if (injected) {
      await new Promise((res) => setTimeout(res, 800));
      r = await sendToTab(tab, msg);
      if (r.ok) return r;
    }
    try { await API.tabs.reload(tab.id); } catch (e) {}
    await new Promise((res) => setTimeout(res, 2000));
    r = await sendToTab(tab, msg);
  }
  return r;
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

function showEmpty() {
  const chat = $("chat");
  chat.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty";
  const logo = document.createElement("div");
  logo.className = "logo";
  logo.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h10M4 17h6"/></svg>';
  const b = document.createElement("b");
  b.textContent = t("emptyTitle");
  const steps = document.createElement("div");
  steps.className = "steps";
  steps.textContent = t("emptySteps");
  div.append(logo, b, steps);
  chat.appendChild(div);
}

function showSetup() {
  const chat = $("chat");
  chat.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty";
  const logo = document.createElement("div");
  logo.className = "logo";
  logo.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';
  const b = document.createElement("b");
  b.textContent = t("setupTitle");
  const steps = document.createElement("div");
  steps.className = "steps";
  steps.textContent = t("setupSteps");
  const btn = document.createElement("button");
  btn.className = "mini-btn primary";
  btn.id = "setupBtn";
  btn.textContent = t("setupBtn");
  btn.addEventListener("click", openSettings);
  div.append(logo, b, steps, btn);
  chat.appendChild(div);
}

function openSettings() {
  showView("settings");
}

$("gear").addEventListener("click", openSettings);
$("backBtn").addEventListener("click", () => showView("chat"));

let apiKeyVisible = false;
$("keyToggle").addEventListener("click", () => {
  apiKeyVisible = !apiKeyVisible;
  $("apiKey").type = apiKeyVisible ? "text" : "password";
  $("keyToggle").textContent = apiKeyVisible ? t("hide") : t("show");
});

$("checkBtn").addEventListener("click", async () => {
  const hint = $("checkHint");
  hint.textContent = t("sChecking");
  hint.className = "hint";
  await saveSettings();
  const resp = await API.runtime.sendMessage({ type: "check", settings: state.settings });
  const model = state.settings.model || "deepseek-v4-flash-free";
  if (resp.ok) {
    const hasModel = resp.models && resp.models.includes(model);
    hint.textContent = hasModel ? t("sCheckOk").replace("{m}", model) : t("sCheckOkNoModel").replace("{m}", model);
    hint.className = "hint ok";
    if (state.settings.apiKey) {
      if (state.history.length) renderHistory();
      else showEmpty();
    }
  } else {
    hint.textContent = (resp && resp.error) || "error";
    hint.className = "hint err";
  }
});

$("lang").addEventListener("change", async () => {
  await saveSettings();
  window.ThreadsI18n.setLang($("lang").value);
  renderTraits();
  if (!$("viewChat").hidden && !$("chat").children.length) {
    if (state.settings.apiKey) showEmpty();
    else showSetup();
  }
});

["baseUrl", "model", "apiKey"].forEach((id) => {
  $(id).addEventListener("input", () => {
    saveSettings().then(() => {
      const chip = $("modelChip");
      chip.hidden = true;
      if (id === "apiKey") {
        state.history = [];
        state.started = false;
        API.storage.local.remove("history");
      }
    });
  });
});

["autoEnabled", "autoInterval", "autoTask"].forEach((id) => {
  $(id).addEventListener(id === "autoTask" ? "input" : "change", () => saveSettings());
});

["pacingEnabled", "pacingDelay", "pacingPerHour", "scheduleInterval"].forEach((id) => {
  $(id).addEventListener(id === "pacingEnabled" ? "change" : "input", () => saveSettings());
});

$("ideasHype").addEventListener("input", () => {
  $("ideasHypeVal").textContent = $("ideasHype").value;
  saveSettings();
});
["ideasCount", "ideasTopic"].forEach((id) => {
  $(id).addEventListener("input", () => saveSettings());
});

function watchProgress(statusId, prefix) {
  if (watchProgress._iv) clearInterval(watchProgress._iv);
  watchProgress._iv = setInterval(async () => {
    try {
      const resp = await API.runtime.sendMessage({ type: "autoStatus" });
      const p = resp && resp.progress;
      const el = $(statusId);
      if (p && p.running) {
        if (!el) return;
        if (p.phase === "tab") el.textContent = prefix + t("sProgTab");
        else if (p.phase === "tool") el.textContent = prefix + t("sProgStep").replace("{s}", String(p.step)).replace("{tool}", p.tool || "…");
        else if (p.phase === "report") el.textContent = prefix + t("sProgReport");
        el.className = "hint";
      } else if (watchProgress._iv) {
        clearInterval(watchProgress._iv);
        watchProgress._iv = null;
      }
    } catch (e) {}
  }, 1200);
}

function stopWatching() {
  if (watchProgress._iv) {
    clearInterval(watchProgress._iv);
    watchProgress._iv = null;
  }
}

$("autoRunBtn").addEventListener("click", async () => {
  const btn = $("autoRunBtn");
  const hint = $("autoStatus");
  btn.disabled = true;
  hint.textContent = t("sRunning");
  hint.className = "hint";
  await saveSettings();
  watchProgress("autoStatus", "");
  const resp = await API.runtime.sendMessage({ type: "runAuto" });
  stopWatching();
  if (resp && resp.ok) {
    hint.textContent = t("sDone");
    hint.className = "hint ok";
  } else {
    hint.textContent = (resp && resp.error) || t("sRunFail");
    hint.className = "hint err";
  }
  btn.disabled = false;
  refreshAutoReport();
});

async function refreshAutoReport() {
  const el = $("autoReport");
  try {
    const resp = await API.runtime.sendMessage({ type: "autoStatus" });
    const rep = resp && resp.ok ? resp.report : null;
    if (rep && rep.time) {
      const d = new Date(rep.time);
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      el.textContent = t("sLastRun").replace("{time}", time).replace("{err}", rep.ok ? "" : t("sErrSuffix")) + "\n" + rep.report;
      el.className = "auto-report" + (rep.ok ? " ok" : "");
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  } catch (e) {
    el.hidden = true;
  }
}

$("clearStyle").addEventListener("click", async () => {
  delete state.settings.styleGuide;
  await API.storage.local.set({ settings: state.settings });
  $("styleEdit").value = "";
  $("clearStyle").hidden = true;
  const s = $("studyStatus");
  s.textContent = t("sCleared");
  s.className = "hint ok";
});

$("saveStyle").addEventListener("click", async () => {
  const val = $("styleEdit").value.trim();
  if (val) state.settings.styleGuide = val;
  else delete state.settings.styleGuide;
  await API.storage.local.set({ settings: state.settings });
  $("clearStyle").hidden = !val;
  const h = $("saveHint");
  h.textContent = t("sSaved");
  h.className = "hint ok";
  setTimeout(() => { h.textContent = ""; }, 2500);
});

$("styleEdit").addEventListener("input", () => {
  $("saveHint").textContent = "";
  $("clearStyle").hidden = false;
});

$("studyBtn").addEventListener("click", studyStyle);

function showStyle(guide) {
  $("styleEdit").value = guide;
  $("styleEdit").className = "";
  $("clearStyle").hidden = false;
}

async function toolOnTab(target, tool, args) {
  try {
    return await API.tabs.sendMessage(target.id, { type: "tool", tool, args: args || {} });
  } catch (e) {
    return { ok: false, error: "" };
  }
}

async function waitContentScript(target, attempts, delay) {
  for (let i = 0; i < attempts; i++) {
    const nav = await toolOnTab(target, "open_own_profile", {});
    if (nav && nav.ok) return nav;
    await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

async function findThreadsTab() {
  const active = await currentTab();
  if (active && active.id) {
    try {
      const tab = await API.tabs.get(active.id);
      if (tab && tab.url && /(^|\.)threads\.(com|net)(\/|$)/.test(tab.url)) return active;
    } catch (e) {}
  }
  const found = (await API.tabs.query({ url: "https://www.threads.com/*" }))
    .concat(await API.tabs.query({ url: "https://www.threads.net/*" }));
  if (found[0] && found[0].id) return found[0];
  try {
    const t = await API.tabs.create({ url: "https://www.threads.com/" });
    await new Promise((r) => setTimeout(r, 5000));
    return t;
  } catch (e) {
    return null;
  }
}

async function waitContent(target, attempts, delay) {
  for (let i = 0; i < attempts; i++) {
    const r = await toolOnTab(target, "get_page_info", {});
    if (r && r.ok) return true;
    await new Promise((res) => setTimeout(res, delay));
  }
  return false;
}

async function studyStyle() {
  const btn = $("studyBtn");
  const status = $("studyStatus");
  btn.disabled = true;
  status.textContent = t("sStudying");
  status.className = "hint";
  try {
    const target = await findThreadsTab();
    if (!target || !target.id) throw new Error(t("sNeedTab"));

    let nav = await toolOnTab(target, "open_own_profile", {});
    if (!nav || !nav.ok) {
      status.textContent = t("sStudying") + t("sRefreshing");
      try { await API.tabs.reload(target.id); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1500));
      nav = await waitContentScript(target, 14, 1500);
    }
    if (!nav || !nav.ok) {
      const msg = (nav && nav.error) ||
        "Не удалось открыть профиль. В Safari: Настройки (⌘,) → Расширения → «Threads AI» → «Разрешить доступ»: выберите «Для всех сайтов», затем обновите вкладку Threads (Cmd+R) и попробуйте ещё раз.";
      throw new Error(msg);
    }
    await new Promise((r) => setTimeout(r, 2500));

    for (let i = 0; i < 4; i++) {
      await toolOnTab(target, "scroll_feed", { direction: "down", amount: "big" });
      await new Promise((r) => setTimeout(r, 1200));
    }

    const feed = await toolOnTab(target, "get_feed", {});
    const posts = (feed && feed.posts ? feed.posts : []).filter((p) => p.author && p.text);
    if (!posts.length) throw new Error(t("sNoPosts"));

    const prompt = "Мои посты:\n" + posts.slice(0, 30).map((p) => `[${p.author}] ${p.text.slice(0, 600)}`).join("\n---\n");
    const resp = await API.runtime.sendMessage({
      type: "chat",
      messages: [{ role: "system", content: STUDY_SYSTEM }, { role: "user", content: prompt }],
      tools: [],
      settings: state.settings
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || "chat");

    state.settings.styleGuide = resp.content || "";
    await API.storage.local.set({ settings: state.settings });
    showStyle(state.settings.styleGuide);
    status.textContent = t("sStudyDone");
    status.className = "hint ok";
  } catch (e) {
    status.textContent = t("sStudyFail") + ": " + (e && e.message ? e.message : e);
    status.className = "hint err";
  } finally {
    btn.disabled = false;
  }
}

const ANALYTICS_SYSTEM = `Ты — аналитик контента Threads. Ниже JSON с последними постами автора. Важно: ветки уже объединены — каждый элемент это ОДИН пост (первая часть ветки); поле parts = число частей ветки (если 1 — обычный пост); лайки/комментарии/репосты уже просуммированы по всем частям ветки. Остальные поля: текст, время публикации (posted_raw — «сейчас», «5ч», «2дн»; posted_ms — точная дата, если удалось вычислить).
Проанализируй по фактам данных:
1) вовлечённость каждого поста (лайки/комментарии/репосты) — какой пост зашёл лучше всех и почему (текст, тема, формат, длина ветки);
2) время публикации — есть ли закономерность, когда посты набирают больше (если данных нет — честно скажи);
3) темы и форматы, которые работают лучше всего;
4) 3–4 конкретные рекомендации для следующих постов.
Отчёт — компактный, без воды, на языке постов. Не выдумывай цифры, которых нет в данных.`;

async function fetchMyPosts() {
  let tab = await currentTab();
  if (!tab) {
    try {
      const resp = await API.runtime.sendMessage({ type: "ensureTab" });
      if (resp && resp.ok && resp.tab) tab = resp.tab;
    } catch (e) {}
  }
  if (!tab) return { ok: false, error: t("errNoTab") };
  const r = await sendToTabWithRetry(tab, { type: "tool", tool: "open_own_profile", args: {} });
  if (!(r && r.ok)) return { ok: false, error: (r && r.error) || "не удалось открыть профиль" };
  if (r.navigating) await new Promise((res) => setTimeout(res, 3000));
  else await new Promise((res) => setTimeout(res, 1500));
  await sendToTabWithRetry(tab, { type: "tool", tool: "scroll_feed", args: { direction: "up", amount: "big" } });
  await new Promise((res) => setTimeout(res, 1200));
  const res = await sendToTabWithRetry(tab, { type: "tool", tool: "get_feed", args: {} });
  const posts = (res && res.posts) || [];
  const m = (r.url || "").match(/\/@([\w.-]+)/);
  const handle = m ? m[1] : null;
  const own = handle ? posts.filter((p) => (p.url || "").includes("/@" + handle + "/")) : posts;
  const groups = new Map();
  for (const p of own) {
    const idm = (p.url || "").match(/\/post\/([^/?#]+)/);
    const key = (idm ? idm[1].slice(0, 4) : p.url) || p.url;
    if (groups.has(key)) {
      const g = groups.get(key);
      g.parts = (g.parts || 1) + 1;
      g.likes = (g.likes || 0) + (p.likes || 0);
      g.comments = (g.comments || 0) + (p.comments || 0);
      g.reposts = (g.reposts || 0) + (p.reposts || 0);
    } else {
      groups.set(key, { ...p, parts: 1 });
    }
  }
  const list = Array.from(groups.values()).slice(0, 5);
  state.analytics = { posts: list, ts: Date.now(), handle, url: r.url };
  renderAnalyticsPosts();
  return { ok: true, posts: list };
}

function renderAnalyticsPosts() {
  const list = $("analyticsList");
  if (!list) return;
  list.innerHTML = "";
  const posts = (state.analytics && state.analytics.posts) || [];
  if (!posts.length) return;
  const head = document.createElement("div");
  head.className = "analytics-head";
  head.textContent = posts.length + " · " + new Date(state.analytics.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  list.appendChild(head);
  for (const p of posts) {
    const row = document.createElement("div");
    row.className = "analytics-row";
    const meta = document.createElement("div");
    meta.className = "analytics-meta";
    meta.textContent = "♥ " + (p.likes || 0) + " · 💬 " + (p.comments || 0) + " · ♺ " + (p.reposts || 0) + (p.posted_raw ? " · " + p.posted_raw : "") + (p.parts > 1 ? " · ветка " + p.parts : "");
    const txt = document.createElement("div");
    txt.className = "analytics-text";
    txt.textContent = (p.text || "").slice(0, 120);
    row.append(meta, txt);
    list.appendChild(row);
  }
}

async function runAnalytics() {
  const status = $("analyticsStatus");
  if (state.busy) return;
  status.textContent = t("sAnWorking");
  status.className = "hint";
  const data = await fetchMyPosts();
  if (!data.ok || !data.posts.length) {
    status.textContent = data.ok ? t("sAnEmpty") : data.error || t("sRunFail");
    status.className = "hint err";
    return;
  }
  const typing = addTyping();
  try {
    const resp = await API.runtime.sendMessage({
      type: "chat",
      messages: [
        { role: "system", content: ANALYTICS_SYSTEM },
        { role: "user", content: JSON.stringify(data.posts) }
      ],
      tools: [],
      settings: state.settings
    });
    if (resp && resp.ok && resp.content) {
      status.textContent = t("sDone");
      status.className = "hint ok";
      renderAnalyticsPosts();
      addMsg("ai", resp.content);
      showView("chat");
    } else {
      status.textContent = (resp && resp.error) || t("sRunFail");
      status.className = "hint err";
    }
  } catch (e) {
    status.textContent = t("sRunFail");
    status.className = "hint err";
  } finally {
    typing.remove();
  }
}

$("analyticsBtn").addEventListener("click", runAnalytics);
$("analyticsRefresh").addEventListener("click", async () => {
  const status = $("analyticsStatus");
  status.textContent = t("sAnWorking");
  status.className = "hint";
  const data = await fetchMyPosts();
  if (!data.ok) {
    status.textContent = data.error || t("sRunFail");
    status.className = "hint err";
    return;
  }
  status.textContent = data.posts.length ? t("sDone") : t("sAnEmpty");
  status.className = data.posts.length ? "hint ok" : "hint err";
});

const FICTION_GENRES = [
  { key: "warm", e: "❤️", ru: "Тёплая", en: "Warm" },
  { key: "scary", e: "👻", ru: "Страшилка", en: "Creepy" },
  { key: "funny", e: "😂", ru: "Смешная", en: "Funny" },
  { key: "inspire", e: "🚀", ru: "Вдохновляющая", en: "Inspiring" },
  { key: "mystic", e: "🔮", ru: "Мистика", en: "Mystic" },
  { key: "adventure", e: "🌍", ru: "Приключение", en: "Adventure" },
  { key: "love", e: "💔", ru: "О любви", en: "Romance" },
  { key: "random", e: "🎲", ru: "Случайная", en: "Random" }
];

const STORY_QUESTIONS_SYSTEM = `Ты — редактор историй для Threads. Пользователь выбрал жанр истории. Перед написанием составь ровно 4 коротких вопроса, которые сделают историю живой:
1. Герои: сколько человек участвует (1, 2, 3 и больше).
2. Место действия (город, деревня, море, работа и т.п.).
3. Настроение и финал (тёплый, с поворотом, грустный, открытый).
4. Дополнительная деталь-изюминка (время, эпоха, предмет, особенность героя).

Для каждого вопроса дай 3–4 коротких варианта ответа (один вариант — «Неважно»).
Верни ТОЛЬКО JSON без пояснений, кавычек вокруг кода и текста до/после:
{"questions":[{"q":"вопрос","options":["вариант 1","вариант 2","вариант 3"]},{"q":"вопрос","options":["вариант 1","вариант 2","вариант 3"]},{"q":"вопрос","options":["вариант 1","вариант 2","вариант 3"]},{"q":"вопрос","options":["вариант 1","вариант 2","вариант 3"]}]}
Вопросы и варианты — на языке пользователя, коротко.`;

function parseStoryQuestions(content) {
  const text = String(content || "");
  let json = text.trim();
  const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) json = fence[1].trim();
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  if (start >= 0 && end > start) json = json.slice(start, end + 1);
  try {
    const obj = JSON.parse(json);
    const qs = (obj.questions || [])
      .filter((x) => x && x.q && Array.isArray(x.options) && x.options.length)
      .slice(0, 4)
      .map((x) => ({ q: String(x.q), options: x.options.map((o) => String(o).trim()).filter(Boolean) }));
    return qs.length ? qs : null;
  } catch (e) {
    return null;
  }
}

async function fetchStoryQuestions(genre) {
  if (!state.settings.apiKey) return null;
  const typing = addTyping();
  try {
    const resp = await API.runtime.sendMessage({
      type: "chat",
      messages: [
        { role: "system", content: STORY_QUESTIONS_SYSTEM },
        { role: "user", content: "Жанр истории: " + genre }
      ],
      tools: [],
      settings: state.settings
    });
    if (resp && resp.ok) return parseStoryQuestions(resp.content);
    return null;
  } catch (e) {
    return null;
  } finally {
    typing.remove();
  }
}

function renderStoryQuestions(genreLabel, questions) {
  const chat = $("chat");
  const card = document.createElement("div");
  card.className = "story-q-card";
  const head = document.createElement("div");
  head.className = "story-q-head";
  const title = document.createElement("div");
  title.className = "story-q-title";
  title.textContent = "✦ " + genreLabel;
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "mini-btn story-q-skip";
  skip.textContent = t("sStorySkip");
  head.append(title, skip);
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "story-q-body";
  card.appendChild(body);
  const answers = [];

  const finish = () => {
    card.remove();
    state.storyActive = false;
    const note = answers.filter(Boolean).length
      ? " Уточнения: " + answers.join("; ") + ". Всё остальное придумай сам."
      : "";
    sendPrompt("Напиши историю. Жанр: «" + genreLabel + "»." + note);
  };
  const show = (i) => {
    body.innerHTML = "";
    const q = questions[i];
    const prog = document.createElement("div");
    prog.className = "story-q-prog";
    prog.textContent = t("sStoryQ").replace("{i}", String(i + 1)).replace("{n}", String(questions.length));
    const qtext = document.createElement("div");
    qtext.className = "story-q-q";
    qtext.textContent = q.q;
    body.append(prog, qtext);
    const opts = document.createElement("div");
    opts.className = "story-q-opts";
    for (const opt of q.options) {
      const ob = document.createElement("button");
      ob.type = "button";
      ob.className = "genre-chip";
      ob.textContent = opt;
      ob.addEventListener("click", () => {
        answers.push(opt);
        if (i + 1 < questions.length) show(i + 1);
        else finish();
      });
      opts.appendChild(ob);
    }
    body.appendChild(opts);
  };
  skip.addEventListener("click", () => {
    card.remove();
    state.storyActive = false;
    sendPrompt("Напиши историю. Жанр: «" + genreLabel + "».");
  });
  chat.appendChild(card);
  chat.scrollTop = chat.scrollHeight;
  show(0);
}

function renderFictionPicker() {
  const wrap = $("fictionPicker");
  if (!wrap) return;
  wrap.innerHTML = "";
  const L = state.settings.language === "en" ? "en" : "ru";
  const title = document.createElement("div");
  title.className = "fiction-title";
  title.textContent = L === "en" ? "What kind of story?" : "Какую историю придумать?";
  wrap.appendChild(title);
  const row = document.createElement("div");
  row.className = "fiction-genres";
  for (const g of FICTION_GENRES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "genre-chip";
    b.textContent = g.e + " " + g[L];
    b.addEventListener("click", async () => {
      if (state.busy || state.storyActive) return;
      const inp = $("input");
      if (inp) inp.value = "";
      const genre = g.key === "random" ? "История" : g[L];
      state.storyActive = true;
      const questions = await fetchStoryQuestions(g.key === "random" ? "любой" : g[L]);
      if (questions && questions.length) {
        renderStoryQuestions(g[L], questions);
      } else {
        state.storyActive = false;
        const ask = g.key === "random"
          ? "Придумай историю — жанр и тему выбери сам."
          : "Придумай историю. Жанр: «" + g[L] + "».";
        sendPrompt(ask);
      }
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}

function updateFictionUI() {
  $("fictionBtn").classList.toggle("on", state.fiction);
  const picker = $("fictionPicker");
  picker.hidden = !state.fiction;
  if (state.fiction) renderFictionPicker();
}

$("fictionBtn").addEventListener("click", async () => {
  state.fiction = !state.fiction;
  state.settings.fictionMode = state.fiction;
  await API.storage.local.set({ settings: state.settings });
  updateFictionUI();
});

$("newChat").addEventListener("click", async () => {
  if (state.history.length) await persistHistory();
  state.history = [];
  state.started = false;
  state.pending = null;
  state.activeId = genId();
  await API.storage.local.remove("history");
  await API.storage.local.set({ activeId: state.activeId });
  if (state.settings.apiKey) showEmpty();
  else showSetup();
  showView("chat");
});

$("historyBtn").addEventListener("click", () => {
  renderHistoryList();
  showView("history");
});

$("profileBtn").addEventListener("click", () => showView("profile"));
$("ideasBtn").addEventListener("click", () => {
  renderIdeasList();
  showView("ideas");
});

$("ideasGen").addEventListener("click", genIdeas);
$("ideasSchedule").addEventListener("click", scheduleIdeas);

function renderScheduleList() {
  const list = $("scheduleList");
  list.innerHTML = "";
  const queue = Array.isArray(state.settings.schedule) ? state.settings.schedule : [];
  if (!queue.length) {
    const div = document.createElement("div");
    div.className = "history-empty";
    div.textContent = t("sScheduleEmpty");
    list.appendChild(div);
    return;
  }
  const fmt = (t) => new Date(t).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  queue.forEach((item, i) => {
    const card = document.createElement("div");
    card.className = "idea-card schedule-card";
    const head = document.createElement("div");
    head.className = "schedule-head";
    const time = document.createElement("div");
    time.className = "schedule-time";
    const state2 = item.posted ? t("sSchedulePosted") : item.error ? t("sScheduleErr") : t("sScheduleWait");
    time.textContent = fmt(item.at) + " · " + state2;
    const del = document.createElement("button");
    del.className = "h-del";
    del.textContent = "×";
    del.title = t("sScheduleDel");
    del.addEventListener("click", async () => {
      state.settings.schedule = queue.filter((_, j) => j !== i);
      await API.storage.local.set({ settings: state.settings });
      renderScheduleList();
    });
    head.append(time, del);
    const text = document.createElement("div");
    text.className = "idea-text";
    text.textContent = item.text;
    const nowBtn = document.createElement("button");
    nowBtn.className = "schedule-now";
    nowBtn.textContent = item.posted ? t("sSchedulePosted") : t("sScheduleNow");
    nowBtn.disabled = !!item.posted;
    nowBtn.title = t("sScheduleNow");
    nowBtn.addEventListener("click", async () => {
      nowBtn.disabled = true;
      nowBtn.textContent = t("publishing");
      const status = $("scheduleStatus");
      status.textContent = t("publishing");
      status.className = "hint";
      try {
        const resp = await API.runtime.sendMessage({ type: "publishNow", id: item.id });
        if (resp && resp.ok) {
          status.textContent = t("sDone");
          status.className = "hint ok";
        } else {
          status.textContent = (resp && resp.error) || t("sRunFail");
          status.className = "hint err";
        }
      } catch (e) {
        status.textContent = t("sRunFail");
        status.className = "hint err";
      }
      const stored = await API.storage.local.get("settings");
      if (stored.settings) {
        state.settings.schedule = Array.isArray(stored.settings.schedule) ? stored.settings.schedule : [];
        renderScheduleList();
      }
    });
    card.append(head, text, nowBtn);
    list.appendChild(card);
  });
}

async function scheduleIdeas() {
  const btn = $("ideasSchedule");
  const status = $("scheduleStatus");
  const ideas = Array.isArray(state.settings.ideas) ? state.settings.ideas : [];
  if (!ideas.length) {
    status.textContent = t("sIdeasEmpty");
    status.className = "hint err";
    return;
  }
  btn.disabled = true;
  status.textContent = t("sScheduleWorking");
  status.className = "hint";
  let added = 0;
  try {
    const intervalMin = Math.max(5, Math.min(10080, parseInt($("scheduleInterval").value, 10) || 120));
    const queue = Array.isArray(state.settings.schedule) ? state.settings.schedule : [];
    const now = Date.now();
    for (let i = 0; i < ideas.length; i++) {
      const resp = await API.runtime.sendMessage({
        type: "chat",
        messages: [
          { role: "system", content: SCHEDULE_SYSTEM },
          { role: "system", content: traitsPrompt() },
          { role: "user", content: "Идея:\n" + ideas[i] }
        ],
        tools: [],
        settings: state.settings
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "chat");
      const post = String(resp.content || "").trim().slice(0, 500);
      if (post.length > 5) {
        queue.push({ id: genId(), text: post, at: now + i * intervalMin * 60000, posted: false, error: null });
        added++;
      }
    }
    state.settings.schedule = queue.slice(-25);
    await API.storage.local.set({ settings: state.settings });
    renderScheduleList();
    status.textContent = t("sScheduleDone").replace("{n}", String(added));
    status.className = "hint ok";
  } catch (e) {
    status.textContent = t("sScheduleFail") + ": " + (e && e.message ? e.message : e);
    status.className = "hint err";
  } finally {
    btn.disabled = false;
  }
}

async function renderTrendReports() {
  const el = $("trendReports");
  const list = Array.isArray(state.settings.trendReports) ? state.settings.trendReports : [];
  if (!list.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = "";
  for (const r of list) {
    const d = new Date(r.time);
    const head = document.createElement("div");
    head.className = "trend-head";
    head.textContent = d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + (r.ok ? "" : " · " + t("sErrSuffix"));
    const body = document.createElement("div");
    body.className = "trend-body";
    body.textContent = r.report;
    el.append(head, body);
  }
}

$("trendBtn").addEventListener("click", async () => {
  const btn = $("trendBtn");
  const status = $("trendStatus");
  btn.disabled = true;
  status.textContent = t("sTrendsRunning");
  status.className = "hint";
  try {
    watchProgress("trendStatus", t("sTrendsRunning") + " ");
    const resp = await API.runtime.sendMessage({ type: "runTrend" });
    stopWatching();
    if (resp && resp.ok) {
      status.textContent = t("sDone");
      status.className = "hint ok";
    } else {
      status.textContent = (resp && resp.error) || t("sRunFail");
      status.className = "hint err";
    }
  } catch (e) {
    stopWatching();
    status.textContent = t("sRunFail");
    status.className = "hint err";
  }
  btn.disabled = false;
  const stored = await API.storage.local.get("settings");
  if (stored.settings) {
    state.settings.trendReports = Array.isArray(stored.settings.trendReports) ? stored.settings.trendReports : [];
    renderTrendReports();
  }
});

function renderIdeasList() {
  const list = $("ideasList");
  list.innerHTML = "";
  const ideas = Array.isArray(state.settings.ideas) ? state.settings.ideas : [];
  if (!ideas.length) {
    const div = document.createElement("div");
    div.className = "history-empty";
    div.textContent = t("sIdeasEmpty");
    list.appendChild(div);
    return;
  }
  ideas.forEach((idea, i) => {
    const card = document.createElement("div");
    card.className = "idea-card";
    const text = document.createElement("div");
    text.className = "idea-text";
    text.textContent = idea;
    const actions = document.createElement("div");
    actions.className = "idea-actions";
    const use = document.createElement("button");
    use.className = "mini-btn";
    use.textContent = t("sIdeasUse");
    use.title = t("sIdeasUse");
    use.addEventListener("click", () => {
      const input = $("input");
      input.value = idea;
      autoGrow();
      showView("chat");
      input.focus();
    });
    const del = document.createElement("button");
    del.className = "h-del";
    del.textContent = "×";
    del.title = t("sIdeasDel");
    del.addEventListener("click", async () => {
      state.settings.ideas = ideas.filter((_, j) => j !== i);
      await API.storage.local.set({ settings: state.settings });
      renderIdeasList();
    });
    actions.append(use, del);
    card.append(text, actions);
    list.appendChild(card);
  });
}

async function genIdeas() {
  const btn = $("ideasGen");
  const status = $("ideasStatus");
  btn.disabled = true;
  status.textContent = t("sIdeasGenerating");
  status.className = "hint";
  try {
    const target = await findThreadsTab();
    if (!target || !target.id) throw new Error(t("sNeedTab"));

    let probe = await toolOnTab(target, "get_page_info", {});
    if (!probe || !probe.ok) {
      try { await API.tabs.reload(target.id); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1500));
      const ok = await waitContent(target, 10, 1500);
      if (!ok) throw new Error(t("errNotConnected"));
    }
    await new Promise((r) => setTimeout(r, 1000));

    for (let i = 0; i < 3; i++) {
      await toolOnTab(target, "scroll_feed", { direction: "down", amount: "big" });
      await new Promise((r) => setTimeout(r, 1200));
    }

    const feed = await toolOnTab(target, "get_feed", {});
    const posts = (feed && feed.posts ? feed.posts : []).filter((p) => p.author && p.text);
    const fallbackTopic = (state.settings.ideasGen && state.settings.ideasGen.topic && String(state.settings.ideasGen.topic).trim())
      ? "по теме «" + state.settings.ideasGen.topic.trim() + "»"
      : "про нейросети и AI-инструменты";
    const context = posts.length
      ? "Лента сейчас:\n" + posts.slice(0, 30).map((p) => `[${p.author}] (${p.posted_raw || "время неизвестно"}) ${p.text.slice(0, 300)} | ❤ ${p.likes || 0} 💬 ${p.comments || 0}`).join("\n")
      : "Лента пустая — придумай идеи в общих трендах Threads 2026 года для автора, который ведёт аккаунт " + fallbackTopic + ".";
    const resp = await API.runtime.sendMessage({
      type: "chat",
      messages: [
        { role: "system", content: ideasSystem() },
        { role: "system", content: traitsPrompt() },
        { role: "user", content: context }
      ],
      tools: [],
      settings: state.settings
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || "chat");

    const raw = String(resp.content || "").trim();
    if (!raw) throw new Error(t("sIdeasEmptyResp"));

    const seen = new Set();
    const ideas = raw
      .split("\n")
      .map((l) => l.replace(/^```[^\n]*/, "").replace(/```$/, "").trim())
      .map((l) => l.replace(/^[\s>*·•\u2013\u2014\-]+/, "").trim())
      .map((l) => l.replace(/^(?:№?\s*\d{1,2}[.)]|#+\s?|Идея\s*\d{1,2}\s*[:.)]|•)\s*/i, "").trim())
      .filter((l) => {
        if (l.length < 5 || /^(идеи|идея|список|вот|отчёт|формат)/i.test(l)) return false;
        const k = l.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 20);

    if (!ideas.length) {
      throw new Error(t("sIdeasBadFormat") + " «" + raw.slice(0, 200) + "…»");
    }
    state.settings.ideas = ideas;
    await API.storage.local.set({ settings: state.settings });
    renderIdeasList();
    status.textContent = t("sDone");
    status.className = "hint ok";
  } catch (e) {
    status.textContent = t("sIdeasFail") + ": " + (e && e.message ? e.message : e);
    status.className = "hint err";
  } finally {
    btn.disabled = false;
  }
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function renderHistoryList() {
  const list = $("historyList");
  list.innerHTML = "";
  if (!state.convos.length) {
    const div = document.createElement("div");
    div.className = "history-empty";
    div.textContent = t("sEmptyHistory");
    list.appendChild(div);
    return;
  }
  for (const c of state.convos) {
    const item = document.createElement("div");
    item.className = "history-item" + (c.id === state.activeId ? " active" : "");
    item.title = t("sOpen");

    const title = document.createElement("div");
    title.className = "h-title";
    title.textContent = (c.fiction ? "✦ " : "") + (c.title || "…");

    const time = document.createElement("div");
    time.className = "h-time";
    time.textContent = fmtTime(c.ts);

    const del = document.createElement("button");
    del.className = "h-del";
    del.textContent = "×";
    del.title = t("sDel");
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      state.convos = state.convos.filter((x) => x.id !== c.id);
      if (c.id === state.activeId) {
        state.history = [];
        state.started = false;
        state.pending = null;
        await API.storage.local.remove("history");
      }
      await API.storage.local.set({ convos: state.convos });
      renderHistoryList();
    });

    item.append(title, time, del);
    item.addEventListener("click", async () => {
      state.activeId = c.id;
      state.history = Array.isArray(c.messages) ? c.messages : [];
      state.started = state.history.length > 0;
      state.pending = null;
      state.fiction = !!c.fiction;
      state.settings.fictionMode = state.fiction;
      updateFictionUI();
      await API.storage.local.set({ activeId: state.activeId, history: state.history, settings: state.settings });
      renderHistory();
      showView("chat");
    });
    list.appendChild(item);
  }
}

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("input").value.trim();
  if (!text || state.busy || state.storyActive) return;
  $("input").value = "";
  autoGrow();
  await sendPrompt(text);
});

$("input").addEventListener("input", autoGrow);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

function autoGrow() {
  const el = $("input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 90) + "px";
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mdInline(s) {
  return s
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function mdToHtml(src) {
  const text = String(src || "");
  const codeBlocks = [];
  let out = text.replace(/```[^\n]*\n?([\s\S]*?)(```|$)/g, (m, code) => {
    const key = "\u0000" + codeBlocks.length + "\u0000";
    codeBlocks.push("<pre><code>" + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
    return key;
  });
  out = escapeHtml(out);
  const html = [];
  let inUl = false;
  let inOl = false;
  const closeLists = () => {
    if (inUl) { html.push("</ul>"); inUl = false; }
    if (inOl) { html.push("</ol>"); inOl = false; }
  };
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line) { closeLists(); html.push(""); continue; }
    const keyMatch = line.match(/^\u0000(\d+)\u0000$/);
    if (keyMatch) { closeLists(); html.push(codeBlocks[+keyMatch[1]]); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const lvl = Math.min(h[1].length, 4);
      html.push("<h" + lvl + ">" + mdInline(h[2]) + "</h" + lvl + ">");
      continue;
    }
    if (/^([-*])\s/.test(line)) {
      if (!inUl) { closeLists(); inUl = true; html.push("<ul>"); }
      html.push("<li>" + mdInline(line.replace(/^[-*]\s*/, "")) + "</li>");
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      if (!inOl) { closeLists(); inOl = true; html.push("<ol>"); }
      html.push("<li>" + mdInline(line.replace(/^\d+\.\s*/, "")) + "</li>");
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      closeLists();
      html.push("<blockquote>" + mdInline(line.replace(/^&gt;\s?/, "")) + "</blockquote>");
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeLists();
      html.push("<hr>");
      continue;
    }
    closeLists();
    html.push("<p>" + mdInline(line) + "</p>");
  }
  closeLists();
  return html.join("\n");
}

function splitStoryParts(text) {
  const lines = String(text || "").split("\n");
  const parts = [];
  let cur = [];
  const push = () => {
    const s = cur.join("\n").trim();
    if (s) parts.push(s);
    cur = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\u00a0/g, " ");
    const m = line.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      push();
      continue;
    }
    const tm = line.match(/(\d+)\s*\/\s*(\d+)\s*$/);
    if (tm && line.replace(/\d+\s*\/\s*\d+\s*$/, "").trim()) {
      cur.push(line.replace(/\d+\s*\/\s*\d+\s*$/, "").trim());
      push();
      continue;
    }
    cur.push(line);
  }
  push();
  return parts;
}

function addMsg(role, text) {
  const chat = $("chat");
  const empty = chat.querySelector(".empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "ai") div.innerHTML = mdToHtml(text);
  else div.textContent = text;
  chat.appendChild(div);
  if (role === "user" || role === "ai") chat.appendChild(addCopyRow(text));
  chat.scrollTop = chat.scrollHeight;
  return div;
}

const COPY_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function addCopyRow(text) {
  const row = document.createElement("div");
  row.className = "msg-actions";
  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.innerHTML = COPY_ICON;
  btn.title = t("sCopy");
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e2) {}
      ta.remove();
    }
    btn.innerHTML = CHECK_ICON;
    btn.classList.add("done");
    setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove("done"); }, 1200);
  });
  row.appendChild(btn);
  return row;
}

function addToolLine(text) {
  const chat = $("chat");
  const div = document.createElement("div");
  div.className = "tool-line";
  const pulse = document.createElement("span");
  pulse.className = "pulse";
  const span = document.createElement("span");
  span.textContent = text;
  div.append(pulse, span);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function addTyping() {
  const chat = $("chat");
  const div = document.createElement("div");
  div.className = "typing";
  for (let i = 0; i < 3; i++) div.appendChild(document.createElement("span"));
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function summary(post) {
  const txt = (post.text || "(без текста)").slice(0, 220);
  const t = post.posted_raw ? " | время: " + post.posted_raw : "";
  return `[${post.author || "?"}] ${txt} | ❤ ${post.likes || 0} 💬 ${post.comments || 0}${t} | ${post.url}`;
}

function formatToolResult(toolName, r) {
  if (!r) return "Ошибка: нет ответа";
  if (r.ok === false) return "Ошибка: " + (r.error || "неизвестно");
  if (r.results) {
    if (!r.results.length) return r.note || "Поиск ничего не нашёл.";
    const head = r.results.slice(0, 8).map((x) => `${x.title} — ${x.url}${x.snippet ? " | " + x.snippet : ""}`).join("\n");
    return "Результаты поиска:\n" + head + (r.results.length > 8 ? "\n…и ещё " + (r.results.length - 8) : "");
  }
  if (r.text) return "Текст статьи (" + (r.url || "?") + "):\n" + String(r.text).slice(0, 4000);
  if (r.posts) {
    if (!r.posts.length) return "Постов не найдено.";
    const head = r.posts.length > 8 ? r.posts.slice(0, 8).map(summary).join("\n") + `\n…и ещё ${r.posts.length - 8}` : r.posts.map(summary).join("\n");
    return "Страница: " + (r.url || location.href) + "\n" + head;
  }
  if (r.needsConfirm) {
    return {
      pending: true,
      kind: r.kind,
      preview: r.preview
    };
  }
  if (r.published) return "Пост опубликован.";
  if (r.sent) return "Ответ отправлен.";
  return "Готово.";
}

function showConfirm(kind, preview) {
  const chat = $("chat");
  const div = document.createElement("div");
  div.className = "confirm-card";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = kind === "reply" || kind === "comment" ? t("publishLabelReply") : t("publishLabelPost");

  const previewEl = document.createElement("div");
  previewEl.className = "preview";
  previewEl.textContent = preview;

  const actions = document.createElement("div");
  actions.className = "actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "mini-btn";
  cancelBtn.dataset.act = "cancel";
  cancelBtn.textContent = t("cancel");
  const okBtn = document.createElement("button");
  okBtn.className = "mini-btn primary";
  okBtn.dataset.act = "ok";
  okBtn.textContent = kind === "reply" || kind === "comment" ? t("send") : t("publish");
  actions.append(cancelBtn, okBtn);

  div.append(label, previewEl, actions);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;

  return new Promise((resolve) => {
    okBtn.addEventListener("click", async () => {
      actions.remove();
      previewEl.textContent = t("publishing");
      let res = { ok: false, cancelled: true };
      try {
        await paceAction();
        const tab = await currentTab();
        const tool = kind === "reply" || kind === "comment" ? "send_reply" : "publish_draft";
        res = tab ? await sendToTab(tab, { type: "tool", tool, args: {} }) : { ok: false, error: "нет вкладки" };
      } catch (e) {
        res = { ok: false, error: (e && e.message) || String(e) };
      }
      div.remove();
      resolve(res);
    });
    cancelBtn.addEventListener("click", async () => {
      div.remove();
      const tab = await currentTab();
      if (tab) await sendToTab(tab, { type: "tool", tool: "cancel_draft", args: {} });
      resolve({ ok: false, cancelled: true });
    });
  });
}

async function paceAction() {
  const p = state.settings.pacing;
  if (!p || !p.enabled) return;
  const now = Date.now();
  while (pacingLog.length && now - pacingLog[0] > 3600000) pacingLog.shift();
  if (pacingLog.length >= (p.perHour || 25)) {
    throw new Error("Достигнут лимит действий в час (" + (p.perHour || 25) + ") — защита от бана. Продолжи через час.");
  }
  const base = Math.max(5, Math.min(300, parseInt(p.delaySec, 10) || 30));
  await new Promise((res) => setTimeout(res, (base + Math.random() * base * 2) * 1000));
  pacingLog.push(Date.now());
}

async function execTool(name, args) {
  if (WEB_TOOLS.includes(name)) {
    try {
      const resp = await API.runtime.sendMessage({ type: "webTool", tool: name, args: args || {} });
      return resp || { ok: false, error: "нет ответа" };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }
  if (ACTION_TOOLS.has(name)) {
    try {
      await paceAction();
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }
  let tab = await currentTab();
  if (!tab) {
    try {
      const resp = await API.runtime.sendMessage({ type: "ensureTab" });
      if (resp && resp.ok && resp.tab) tab = resp.tab;
    } catch (e) {}
  }
  if (!tab) return { ok: false, error: t("errNoTab") };
  const r = await sendToTabWithRetry(tab, { type: "tool", tool: name, args: args || {} });
  if (name === "draft_post" || name === "reply_to_thread" || name === "reply_to_comment") {
    const r2 = formatToolResult(name, r);
    if (typeof r2 === "object" && r2.pending) {
      if (state.pendingConfirm && state.pendingConfirm.text === r2.preview && state.pendingConfirm.kind === r2.kind) {
        return { ok: false, error: "Черновик с этим текстом уже открыт и ждёт подтверждения — не вызывай инструмент повторно." };
      }
      state.pendingConfirm = { text: r2.preview, kind: r2.kind };
      return r2;
    }
    state.pendingConfirm = null;
  }
  return r;
}

async function sendPrompt(text) {
  if (!state.settings.apiKey) {
    openSettings();
    return;
  }
  if (!state.started) {
    state.history = [];
    state.started = true;
  }
  addMsg("user", text);
  state.history.push({ role: "user", content: text });
  state.busy = true;
  state.stopped = false;
  $("send").disabled = true;
  $("send").hidden = true;
  $("stop").hidden = false;

    const typing = addTyping();

  let lastAiText = "";
  try {
    const system = [SYSTEM,
      state.settings.styleGuide ? "Стиль автора (как пользователь пишет посты и комментарии — соблюдай его):\n" + state.settings.styleGuide : null,
      traitsPrompt(),
      state.fiction ? FICTION_SYSTEM : null
    ].filter(Boolean).join("\n\n");
    let final = null;
    for (let step = 0; step < MAX_STEPS && !state.stopped; step++) {
      const resp = await API.runtime.sendMessage({
        type: "chat",
        messages: [{ role: "system", content: system }, ...state.history],
        tools: state.fiction ? [] : TOOLS,
        settings: state.settings
      });
      if (state.stopped || !resp || !resp.ok) {
        if (state.stopped || (resp && resp.stopped)) break;
        typing.remove();
        addMsg("ai", "⚠️ " + (resp ? resp.error : "Сеть недоступна"));
        return;
      }
      const asst = { role: "assistant", content: resp.content || "" };
      if (resp.toolCalls && resp.toolCalls.length) asst.tool_calls = resp.toolCalls;
      state.history.push(asst);

      if (!resp.toolCalls || !resp.toolCalls.length) {
        final = resp.content;
        break;
      }

      for (const tc of resp.toolCalls) {
        if (!tc.function) continue;
        const name = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch (e) {}
        const queryPart = name === "search_threads" || name === "search_web" ? " «" + (args.query || "") + "»" : "";
        const line = addToolLine(name + queryPart);
        const result = await execTool(name, args);

        if (result && typeof result === "object" && result.pending) {
          line.remove();
          const conf = await showConfirm(result.kind, result.preview);
          state.pendingConfirm = null;
          const confirmMsg = conf && conf.ok === true
            ? "Пользователь подтвердил и завершил публикацию: " + (conf.published ? "пост опубликован" : "ответ отправлен")
            : "Пользователь отменил публикацию. Не публикуй повторно без новой просьбы.";
          state.history.push({ role: "tool", tool_call_id: tc.id, content: confirmMsg });
        } else {
          line.remove();
          const summaryText = formatToolResult(name, result);
          state.history.push({ role: "tool", tool_call_id: tc.id, content: typeof summaryText === "string" ? summaryText : JSON.stringify(result) });
        }
      }
      await persistHistory();
    }
    typing.remove();
    if (final && final.trim() && final.trim() !== lastAiText) {
      const storyParts = splitStoryParts(final.trim());
      if (storyParts.length > 1) {
        for (const p of storyParts) addMsg("ai", p);
      } else {
        addMsg("ai", final.trim());
      }
      lastAiText = final.trim();
    }
    await persistHistory();
  } catch (e) {
    typing.remove();
    if (!state.stopped) {
      addMsg("ai", "⚠️ Ошибка: " + (e && e.message ? e.message : e));
    }
  } finally {
    state.busy = false;
    $("send").disabled = false;
    $("send").hidden = false;
    $("stop").hidden = true;
    const lm = state.history[state.history.length - 1];
    if (state.stopped) {
      if (lm && lm.role === "assistant") lm.interrupted = true;
      persistHistory();
    } else if (lm && lm.role === "assistant" && lm.content && (!lm.tool_calls || !lm.tool_calls.length)) {
      addContinueRow(state.history.length - 1);
    }
  }
}

$("stop").addEventListener("click", () => {
  state.stopped = true;
  API.runtime.sendMessage({ type: "stopChat" }).catch(() => {});
});
