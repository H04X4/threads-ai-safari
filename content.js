(() => {
  const API = (typeof browser !== "undefined" ? browser : chrome);

  const TIME_RE = /(\d+\s*(дн|ч|мин|нед|г)|назад|ago|^\d{2}\.\d{2}\.\d{4}$|^just now|^сейчас)/i;
  const MAX_POST_LEN = 500;
  const MAX_REPLY_LEN = 500;
  const MAX_LINKS = 5;
  const MAX_MEDIA = 10;
  const NOISE = new Set([
    "Прикреплено", "Подтверждено", "Отредактировано", "Перевести",
    "Pinned", "Verified", "Edited", "Translate", "Ещё", "More", "Pin icon"
  ]);
  const LANG = {
    comment: ["Комментировать", "Comment"],
    like: ["Поставить \"Нравится\"", "Like"],
    repost: ["Сделать репост", "Repost"],
    share: ["Поделиться", "Share"]
  };

  const seen = new Set();

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function qa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function labelOf(el) {
    return (el.getAttribute && (el.getAttribute("aria-label") || "")) || "";
  }

  function matchLabel(el, key) {
    const l = labelOf(el);
    return LANG[key].some((k) => l.startsWith(k));
  }

  function parseCount(str) {
    const m = String(str || "").match(/[\d\s.,\u00a0]+/);
    if (!m) return 0;
    return parseInt(m[0].replace(/[\s.,\u00a0]/g, ""), 10) || 0;
  }

  function parseTimeLabel(text) {
    const s = String(text || "").trim().replace(/\u00a0/g, " ");
    if (!s) return null;
    const now = Date.now();
    if (/^(сейчас|только что|just now)$/i.test(s)) return { raw: s, ms: now };
    const m = s.match(/(\d+(?:[.,]\d+)?)\s*([а-яa-z]+)/i);
    if (m) {
      const n = parseFloat(m[1].replace(",", "."));
      const u = m[2].toLowerCase();
      let mult = 0;
      if (u.startsWith("мин") || u === "м" || u.startsWith("min") || u === "m") mult = 60000;
      else if (u.startsWith("ч") || u.startsWith("h")) mult = 3600000;
      else if (u.startsWith("дн") || u.startsWith("д") || u.startsWith("d")) mult = 86400000;
      else if (u.startsWith("нед") || u === "н" || u.startsWith("w")) mult = 7 * 86400000;
      else if (u.startsWith("г") || u.startsWith("y")) mult = 365 * 86400000;
      if (isFinite(n) && mult) return { raw: s, ms: now - n * mult };
      return { raw: s, ms: null };
    }
    const dm = s.match(/^(\d{2})[./](\d{2})(?:[./](\d{4}))?$/);
    if (dm) {
      const year = dm[3] ? +dm[3] : new Date().getFullYear();
      const t = new Date(year, +dm[2] - 1, +dm[1]);
      if (!isNaN(t.getTime())) return { raw: s, ms: t.getTime() };
    }
    return { raw: s, ms: null };
  }

  function postTime(root) {
    const a = qa("a", root).find(isTimeLink);
    if (!a) return null;
    const iso = a.getAttribute && a.getAttribute("datetime");
    if (iso) {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return { raw: (a.innerText || "").trim(), ms: d.getTime() };
    }
    return parseTimeLabel(a.innerText);
  }

  function isPostLink(a) {
    const href = a.getAttribute("href") || "";
    return href.includes("/post/") && !/\/media$/.test(href);
  }

  function isTimeLink(a) {
    return isPostLink(a) && TIME_RE.test((a.innerText || "").trim());
  }

  function collectText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent || "";
      const t = text.trim();
      if (!t) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest('[role="button"], button, script, style')) continue;
      if (NOISE.has(t)) continue;
      const a = parent.closest("a");
      if (a) {
        const href = a.getAttribute("href") || "";
        if (href.includes("/search?")) continue;
        if (href.startsWith("/@") && !isPostLink(a)) continue;
        if (isTimeLink(a)) continue;
      }
      parts.push(text);
    }
    return parts
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/\s+([.,!?…:;])/g, "$1")
      .trim();
  }

  function findPostContainer(a) {
    let el = a;
    for (let i = 0; i < 15 && el && el !== document.body; i++) {
      const parent = el.parentElement;
      if (!parent || parent === document.body) return el;
      const count = qa("a", parent).filter(isPostLink).length;
      if (count !== 1) return el;
      el = parent;
    }
    return el;
  }

  function extractActions(root) {
    const actions = {};
    for (const b of qa('[role="button"], button', root)) {
      const l = labelOf(b);
      for (const [key, labels] of Object.entries(LANG)) {
        if (labels.some((k) => l.startsWith(k)) && !(key in actions)) {
          actions[key] = parseCount(l);
        }
      }
    }
    if (!Object.keys(actions).length) {
      const nums = qa('[role="button"], button', root)
        .map((b) => (b.innerText || "").trim().replace(/\u00a0/g, " "))
        .filter((t) => /^\d[\d\s]*$/.test(t));
      const order = ["like", "comment", "repost", "share"];
      nums.slice(0, 4).forEach((t, i) => {
        actions[order[i]] = parseCount(t);
      });
    }
    return actions;
  }

  function collectPosts() {
    const out = [];
    const links = qa('a[href*="/post/"]').filter(isPostLink);
    const roots = new Set();
    for (const a of links) {
      const root = findPostContainer(a);
      if (root) roots.add(root);
    }
    for (const root of roots) {
      const a = qa("a", root).find(isPostLink);
      if (!a) continue;
      const url = new URL(a.getAttribute("href"), location.origin).href;
      const authorLinks = qa('a[href^="/@"]', root).filter((x) => {
        const href = x.getAttribute("href") || "";
        return !isPostLink(x) && (x.innerText || "").trim();
      });
      const author = (authorLinks[0] ? authorLinks[0].innerText.trim() : "") || (url.split("/@")[1] || "").split("/")[0] || "";
      const text = collectText(root);
      const actions = extractActions(root);
      const time = postTime(root);
      out.push({
        author,
        text: text || null,
        url,
        likes: actions.like || 0,
        comments: actions.comment || 0,
        reposts: actions.repost || 0,
        posted_raw: time ? time.raw : null,
        posted_ms: time ? time.ms : null
      });
    }
    const unique = new Map();
    for (const p of out) unique.set(p.url, p);
    return Array.from(unique.values());
  }

  function newSinceLast(list) {
    const fresh = list.filter((p) => !seen.has(p.url));
    for (const p of fresh) seen.add(p.url);
    return fresh;
  }

  async function waitForPosts(timeout = 12000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const posts = collectPosts();
      if (posts.length) return posts;
      await wait(700);
    }
    return [];
  }

  async function scrollFeed(direction, amount) {
    const steps = amount === "big" ? 4 : amount === "small" ? 1 : 2;
    for (let i = 0; i < steps; i++) {
      window.scrollBy({
        top: direction === "up" ? -window.innerHeight * 0.85 : window.innerHeight * 0.85,
        behavior: "smooth"
      });
      await wait(900);
    }
    await wait(600);
    const list = collectPosts();
    return newSinceLast(list);
  }

  async function goTo(url) {
    const target = url.startsWith("http") ? url : location.origin + url;
    if (location.href !== target) {
      location.href = target;
      await wait(2500);
    }
    const posts = await waitForPosts();
    return { url: target, posts };
  }

  function findCreateButton() {
    const labels = ["Создать", "New thread", "Compose", "Создать новую ветку"];
    for (const el of qa('[role="button"], button')) {
      const l = labelOf(el);
      if (labels.some((k) => l === k || l.startsWith(k + " "))) return el;
    }
    for (const img of qa('img[alt], svg[aria-label]')) {
      const l = img.alt || labelOf(img);
      if (labels.some((k) => l === k || l.startsWith(k + " "))) {
        return img.closest('[role="button"], button') || img;
      }
    }
    return null;
  }

  function findTextbox(root) {
    const boxes = qa('[contenteditable="true"]', root).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== "hidden";
    });
    return boxes.sort((a, b) => (a.getBoundingClientRect().height < b.getBoundingClientRect().height ? -1 : 1)).pop() || null;
  }

  function findDialog() {
    return document.querySelector('[role="dialog"]') || document.body;
  }

  function insertText(el, text) {
    const norm = (s) => String(s || "").replace(/\u00a0/g, " ").trim();
    if (norm(el.textContent) === norm(text)) return true;
    const paste = () => {
      el.focus();
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (e) {}
    };
    const inputEv = () => {
      el.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      const ev = new InputEvent("insertText", { bubbles: true, cancelable: true, inputType: "insertText", data: text });
      el.dispatchEvent(ev);
    };
    const exec = () => {
      el.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      document.execCommand("insertText", false, text);
    };
    paste();
    if (norm(el.textContent) !== norm(text)) {
      inputEv();
      if (norm(el.textContent) !== norm(text)) {
        exec();
        if (norm(el.textContent) !== norm(text)) {
          el.innerHTML = "";
          el.focus();
          const sel = window.getSelection();
          sel.selectAllChildren(el);
          document.execCommand("insertText", false, text);
          el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
        }
      }
    }
    return norm(el.textContent) === norm(text);
  }

  function findSubmitButton(container, kind) {
    const texts =
      kind === "post"
        ? ["Опубликовать", "Post", "Опубликовать ветку"]
        : ["Отправить", "Send", "Ответить", "Reply"];
    for (const b of qa('[role="button"], button', container)) {
      const l = labelOf(b);
      const t = (b.innerText || "").trim();
      if (texts.some((k) => l === k || l.startsWith(k + " ") || t === k)) {
        const rect = b.getBoundingClientRect();
        if (rect.width > 0) return b;
      }
    }
    return null;
  }

  async function goHome() {
    if (location.pathname === "/" || location.pathname === "") return true;
    const homeLink = qa('a[href="/"], a[href="https://www.threads.com/"], a[href="https://threads.com/"]')
      .find((a) => a.getBoundingClientRect().width > 0);
    if (homeLink) homeLink.click();
    else {
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    for (let i = 0; i < 10; i++) {
      await wait(700);
      if (location.pathname === "/" || location.pathname === "") return true;
    }
    return location.pathname === "/" || location.pathname === "";
  }

  async function draftPost(text) {
    const body = String(text || "").trim();
    if (!body) return { ok: false, error: "Нет текста поста" };
    if (body.length > MAX_POST_LEN) {
      return { ok: false, error: "Текст поста " + body.length + " символов — лимит Threads 500. Сократи и попробуй снова." };
    }
    const links = (body.match(/https?:\/\/\S+/g) || []).length;
    if (links > MAX_LINKS) {
      return { ok: false, error: "Слишком много ссылок: " + links + " (максимум " + MAX_LINKS + " на пост). Убери лишние." };
    }
    await goHome();
    let dialog = document.querySelector('[role="dialog"]');
    let box = dialog ? findTextbox(dialog) : null;
    if (!box) {
      let btn = findCreateButton();
      for (let i = 0; i < 6 && !btn; i++) {
        await wait(800);
        btn = findCreateButton();
      }
      if (!btn) return { ok: false, error: "Не нашёл кнопку «Создать». Вы залогинены в Threads?" };
      btn.click();
      await wait(1600);
      dialog = findDialog();
      box = findTextbox(dialog);
    }
    if (!box) return { ok: false, error: "Не нашёл поле ввода поста" };
    if ((box.textContent || "").replace(/\u00a0/g, " ").trim() === body) {
      return { ok: true, preview: body, needsConfirm: true, kind: "post" };
    }
    insertText(box, body);
    await wait(400);
    return { ok: true, preview: body, needsConfirm: true, kind: "post" };
  }

  async function publishDraft() {
    const keys = ["Опубликовать", "Post", "Публиковать", "Опубликовать ветку"];
    const findPostBtn = () => {
      const cands = [];
      for (const b of qa('[role="button"], button')) {
        const rect = b.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const l = labelOf(b).toLowerCase();
        const t = (b.innerText || "").replace(/\u00a0/g, " ").trim().toLowerCase();
        if (keys.some((k) => l === k || l.startsWith(k + " ") || t === k || t.endsWith(k))) cands.push(b);
      }
      cands.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
      return cands[0] || null;
    };
    const composerOpen = () => !!qa('[role="dialog"]').find((d) => findTextbox(d));
    let submit = findPostBtn();
    if (submit && !submit.disabled) {
      submit.click();
      await wait(1800);
    }
    if (composerOpen()) {
      const box = findTextbox(document);
      if (box && !box.disabled && (box.textContent || "").replace(/\u00a0/g, " ").trim()) {
        const text = (box.textContent || "").replace(/\u00a0/g, " ").trim();
        box.innerHTML = "";
        box.focus();
        const sel = window.getSelection();
        sel.selectAllChildren(box);
        box.dispatchEvent(new InputEvent("insertText", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
        await wait(500);
      }
      submit = findPostBtn();
      if (submit && !submit.disabled) {
        submit.click();
        await wait(2200);
      }
    }
    if (composerOpen()) {
      return { ok: false, error: "Не удалось опубликовать: композер остался открытым. Попробуйте нажать «Опубликовать» вручную." };
    }
    return { ok: true, published: true };
  }

  async function cancelDraft() {
    const dialog = findDialog();
    const btns = qa('[role="button"], button', dialog);
    const close = btns.find((b) => {
      const l = labelOf(b);
      const t = (b.innerText || "").trim();
      return l === "Отмена" || l === "Cancel" || l === "Закрыть" || l === "Close" || t === "Отмена";
    });
    if (close) close.click();
    await wait(800);
    return { ok: true };
  }

  async function replyToThread(text) {
    const body = String(text || "").trim();
    if (!body) return { ok: false, error: "Нет текста ответа" };
    if (body.length > MAX_REPLY_LEN) {
      return { ok: false, error: "Текст ответа " + body.length + " символов — лимит Threads 500. Сократи и попробуй снова." };
    }
    let box = findTextbox(document);
    if (!box) {
      const post = qa('[role="article"], article').filter((a) => a.getBoundingClientRect().height > 50)[0] || null;
      if (post) {
        const replyBtn = qa('[role="button"], button', post).find((b) => {
          const l = labelOf(b);
          const alt = b.getAttribute("aria-label") || "";
          return l === "Ответить" || l === "Reply" || alt === "Ответить" || alt === "Reply";
        });
        if (replyBtn) {
          replyBtn.click();
          await wait(1000);
          box = findTextbox(document);
        }
      }
    }
    if (!box) return { ok: false, error: "Не нашёл поле для ответа. Откройте пост и повторите." };
    if ((box.textContent || "").replace(/\u00a0/g, " ").trim() === body) {
      return { ok: true, preview: body, needsConfirm: true, kind: "reply" };
    }
    insertText(box, body);
    await wait(400);
    return { ok: true, preview: body, needsConfirm: true, kind: "reply" };
  }

  async function sendReply() {
    const box = findTextbox(document);
    if (!box) return { ok: false, error: "Не нашёл поле для ответа" };
    box.focus();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    box.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    await wait(2500);
    return { ok: true, sent: true };
  }

  function findCommentItem(authorLink) {
    let cur = authorLink;
    for (let i = 0; i < 12 && cur && cur !== document.body; i++) {
      const visible = qa('[role="button"], button', cur).filter((b) => b.getBoundingClientRect().width > 0).length;
      const hasCounters = /[\d\u00a0.,\s]{2,}/.test((cur.innerText || "").replace(authorLink.innerText || "", ""));
      if (visible >= 4 && hasCounters) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function collectComments() {
    const out = [];
    const seenItems = new Set();
    for (const a of qa('a[href*="/@"]')) {
      const name = (a.innerText || "").trim();
      if (!name || isTimeLink(a)) continue;
      if (/просмотров|views|Ветка|Thread/i.test(name)) continue;
      const el = findCommentItem(a);
      if (!el || seenItems.has(el)) continue;
      seenItems.add(el);
      let text = collectText(el);
      if (!text) continue;
      text = text.replace(/^(Оригинальный автор поставил "Нравится"|Original author liked)\s*/i, "").trim();
      if (!text) continue;
      const actions = extractActions(el);
      const postLink = qa("a", el).find(isPostLink);
      out.push({
        el,
        author: name,
        text,
        likes: actions.like || 0,
        comments: actions.comment || 0,
        url: postLink ? new URL(postLink.getAttribute("href"), location.origin).href : location.href
      });
    }
    return out;
  }

  async function replyToComment(args = {}) {
    const list = collectComments();
    let entry = null;
    if (args.author) entry = list.find((e) => e.author === args.author);
    if (!entry && args.index !== undefined) entry = list[args.index];
    if (!entry) {
      return {
        ok: false,
        error: "Комментарий не найден. Сначала вызови get_comments и укажи index (или author) того, кому отвечаем."
      };
    }
    const text = (args.text || "").trim();
    if (!text) return { ok: false, error: "Нет текста ответа" };
    if (text.length > MAX_REPLY_LEN) {
      return { ok: false, error: "Текст ответа " + text.length + " символов — лимит Threads 500. Сократи и попробуй снова." };
    }
    const before = new Set(qa('[contenteditable="true"]'));
    const textNode = (() => {
      const walker = document.createTreeWalker(entry.el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || "").trim();
        if (!t) continue;
        const parent = n.parentElement;
        if (!parent || parent.closest('[role="button"], button, a, [contenteditable="true"]')) continue;
        return parent;
      }
      return null;
    })();
    if (textNode) {
      textNode.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    } else {
      entry.el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
    let box = null;
    for (let i = 0; i < 12; i++) {
      await wait(500);
      const all = qa('[contenteditable="true"]');
      box = all.find((b) => !before.has(b) && b.getBoundingClientRect().height > 5) ||
        all.find((b) => entry.el.contains(b)) ||
        all[all.length - 1];
      if (box && box.getBoundingClientRect().height > 5) break;
    }
    if (!box) {
      return { ok: false, error: "Не удалось открыть поле ответа под комментарием. Возможно, нужно войти в Threads. Обновите страницу и попробуйте ещё раз." };
    }
    if ((box.textContent || "").replace(/\u00a0/g, " ").trim() !== text) {
      insertText(box, text);
    }
    await wait(400);
    return { ok: true, preview: text, needsConfirm: true, kind: "comment" };
  }

  async function inspectPage() {
    const path = location.pathname;
    let page = "лента (главная)";
    if (path.startsWith("/search")) page = "поиск";
    else if (path.includes("/post/")) page = "открытый пост";
    else if (/^\/@[^/]+$/.test(path)) page = "профиль";
    const outline = [];
    for (const el of qa('[role="article"], [role="dialog"], [role="region"], main, section')) {
      const label = labelOf(el) || (el.getAttribute("aria-label") || "");
      outline.push((el.tagName + (label ? "[" + label.slice(0, 40) + "]" : "")).toLowerCase());
      if (outline.length >= 12) break;
    }
    return {
      ok: true,
      url: location.href,
      title: document.title || "",
      page,
      logged_out: (document.body.innerText || "").includes("Попробуйте Threads"),
      counts: {
        post_links: qa('a[href*="/post/"]').filter(isPostLink).length,
        author_links: qa('a[href^="/@"]').length,
        buttons: qa('[role="button"], button').length,
        contenteditable: qa('[contenteditable="true"]').length,
        dialogs: qa('[role="dialog"]').length
      },
      roles: outline
    };
  }

  const tools = {
    async get_page_info() {
      const info = await inspectPage();
      const posts = collectPosts();
      newSinceLast(posts);
      return { ok: true, url: info.url, page: info.page, title: info.title, visible_posts: posts.length, can_create_post: !!findCreateButton(), logged_out: info.logged_out };
    },
    async inspect_page() {
      return inspectPage();
    },
    async get_feed() {
      const posts = collectPosts();
      newSinceLast(posts);
      return { ok: true, url: location.href, posts };
    },
    async scroll_feed(args = {}) {
      const fresh = await scrollFeed(args.direction || "down", args.amount || "medium");
      return { ok: true, posts: fresh };
    },
    async search_threads(args = {}) {
      const q = (args.query || "").trim();
      if (!q) return { ok: false, error: "Пустой запрос" };
      const url = "https://www.threads.com/search?q=" + encodeURIComponent(q);
      const res = await goTo(url);
      seen.clear();
      newSinceLast(res.posts);
      return { ok: true, posts: res.posts, url };
    },
    async open_thread(args = {}) {
      const url = args.url || "";
      if (!url) return { ok: false, error: "Нет URL поста" };
      const res = await goTo(url);
      return { ok: true, url, posts: res.posts };
    },
    async get_comments() {
      const list = collectComments().map(({ el, ...rest }) => rest);
      return { ok: true, url: location.href, comments: list };
    },
    async open_own_profile() {
      if (/^\/@[\w.-]+$/i.test(location.pathname)) return { ok: true, url: location.href };
      const all = qa('a[href*="/@"]');
      let link = all.find((a) => /профиль|profile/i.test(a.textContent || ""));
      if (!link) {
        const btn = qa('[role="button"], button').find((b) => /^\s*(профиль|profile)\s*$/i.test(b.textContent || ""));
        if (btn) {
          btn.click();
          return { ok: true, url: location.href, navigating: true };
        }
      }
      if (!link) {
        const byHandle = all.filter((a) => /^\/@[\w.-]+$/i.test(new URL(a.href, location.origin).pathname));
        link = byHandle.find((a) => !a.closest('[role="article"], article, main')) || byHandle[0] || null;
      }
      if (!link) return { ok: false, error: "Не нашёл свой профиль — проверьте, что вы вошли в Threads, и обновите страницу (Cmd+R)" };
      const target = new URL(link.href || link.getAttribute("href") || "", location.origin).href;
      if (new URL(location.href).pathname !== new URL(target).pathname) {
        const url = target;
        setTimeout(() => { location.href = url; }, 50);
        return { ok: true, url, navigating: true };
      }
      return { ok: true, url: location.href };
    },
    async reply_to_comment(args = {}) {
      return replyToComment(args);
    },
    async draft_post(args = {}) {
      return draftPost(args.text || "");
    },
    async publish_draft() {
      return publishDraft();
    },
    async cancel_draft() {
      return cancelDraft();
    },
    async reply_to_thread(args = {}) {
      return replyToThread(args.text || "");
    },
    async send_reply() {
      return sendReply();
    }
  };

  API.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "tool") return false;
    const tool = tools[msg.tool];
    if (!tool) {
      sendResponse({ ok: false, error: "Неизвестный инструмент: " + msg.tool });
      return false;
    }
    tool(msg.args || {})
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });
})();
