// 通用 UI 零件：toast、浮层面板、快速新建菜单、HUD 提示。
import { NODE_TYPES } from "../core/types.js";

export function escapeHtml(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    if (c === '"') return "&quot;";
    return "&#39;";
  });
}

export function formatInt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function glyphBox(key, cls = "pnode-glyph") {
  const t = NODE_TYPES[key];
  if (!t) return "";
  return '<span class="' + cls + '" style="background:' + t.hue + '">' + escapeHtml(t.en || t.glyph) + "</span>";
}

let toastHost = null;
export function toast(message, kind = "") {
  if (!toastHost) toastHost = document.getElementById("toasts");
  if (!toastHost) return;
  const node = document.createElement("div");
  node.className = "toast" + (kind ? " " + kind : "");
  node.textContent = message;
  toastHost.appendChild(node);
  window.setTimeout(() => {
    node.style.transition = "opacity .2s";
    node.style.opacity = "0";
    window.setTimeout(() => node.remove(), 220);
  }, kind === "error" ? 2600 : 1700);
}

let hintHost = null;
export function hudHint(text) {
  if (!hintHost) hintHost = document.getElementById("hud-hint");
  if (!hintHost) return;
  if (!text) {
    hintHost.style.display = "none";
    return;
  }
  hintHost.style.display = "";
  hintHost.textContent = text;
}

// ---------- 浮层 ----------

export function openSheet(opts) {
  const host = document.getElementById("overlays");
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const head = document.createElement("div");
  head.className = "sheet-head";
  head.innerHTML =
    "<div><h2>" + escapeHtml(opts.title || "") + "</h2>" +
    (opts.subtitle ? "<p>" + escapeHtml(opts.subtitle) + "</p>" : "") + "</div>" +
    '<span class="spacer"></span>';
  const closeBtn = document.createElement("button");
  closeBtn.className = "tbtn";
  closeBtn.textContent = "✕";
  closeBtn.title = "关闭";
  head.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "sheet-body";

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  if (opts.width) sheet.style.width = opts.width;
  sheet.appendChild(head);
  if (opts.bodyHtml !== undefined) body.innerHTML = opts.bodyHtml;
  if (opts.bodyNode) body.appendChild(opts.bodyNode);
  sheet.appendChild(body);
  overlay.appendChild(sheet);
  host.appendChild(overlay);

  const handle = {
    overlay,
    body,
    sheet,
    close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
    },
  };
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      handle.close();
    }
  }
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay && opts.dismissible !== false) handle.close();
  });
  closeBtn.addEventListener("click", () => handle.close());
  document.addEventListener("keydown", onKey, true);
  return handle;
}

export function confirmDialog(title, bodyHtml, confirmLabel = "确定") {
  return new Promise((resolve) => {
    let done = false;
    const sheet = openSheet({ title, bodyHtml, width: "min(460px, 100%)" });
    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.marginTop = "14px";
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = "取消";
    const ok = document.createElement("button");
    ok.className = "btn danger";
    ok.textContent = confirmLabel;
    actions.appendChild(cancel);
    actions.appendChild(ok);
    sheet.body.appendChild(actions);
    const finish = (v) => {
      if (done) return;
      done = true;
      sheet.close();
      resolve(v);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
  });
}

// ---------- 快速新建菜单 ----------

let quickEl = null;
let quickCancel = null;

// silent = true 时只关闭界面，不回调取消（用于打开下一个菜单前清场）。
export function closeQuickMenu(silent = false) {
  if (!quickEl) return;
  const had = !quickEl.hidden;
  quickEl.hidden = true;
  quickEl.innerHTML = "";
  document.removeEventListener("pointerdown", onOutside, true);
  const cb = quickCancel;
  quickCancel = null;
  if (had && !silent && cb) cb();
}

function onOutside(e) {
  if (quickEl && !quickEl.contains(e.target)) closeQuickMenu();
}

export function isQuickMenuOpen() {
  return !!(quickEl && !quickEl.hidden);
}

export function openQuickMenu(items, at, onPick, onCancel) {
  if (!quickEl) quickEl = document.getElementById("quick-menu");
  if (!quickEl) return;
  closeQuickMenu(true);
  const title = document.createElement("div");
  title.className = "qm-title";
  title.textContent = items.length > 0 ? "新建节点并连线" : "没有可用类型";
  quickEl.appendChild(title);
  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "qm-item";
    btn.innerHTML = glyphBox(item.key) + "<span>" + escapeHtml(item.name) + "</span>" +
      '<span class="spacer"></span><span class="pnode-weight">W' + item.weight + "</span>";
    btn.addEventListener("click", () => {
      closeQuickMenu(true);
      quickCancel = null;
      onPick(item.key);
    });
    quickEl.appendChild(btn);
  }
  quickEl.hidden = false;
  const rect = quickEl.getBoundingClientRect();
  let x = at.x;
  let y = at.y;
  if (x + rect.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - rect.width - 8);
  if (y + rect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - rect.height - 8);
  quickEl.style.left = x + "px";
  quickEl.style.top = y + "px";
  quickCancel = onCancel || null;
  document.addEventListener("pointerdown", onOutside, true);
}
// ---------- 悬浮面板（可拖动、可关闭、不遮挡交互） ----------

let floatZ = 70;

export function openFloatPanel(opts = {}) {
  const host = document.getElementById("overlays") || document.body;
  const vw = window.innerWidth || 1024;
  const wpx = Math.min(opts.width || 560, Math.max(240, vw - 24));
  const el = document.createElement("div");
  el.className = "float-panel";
  el.style.width = wpx + "px";
  el.style.left = (opts.left !== undefined ? Math.max(0, opts.left) : Math.max(12, vw - wpx - 24)) + "px";
  el.style.top = (opts.top || 64) + "px";
  el.style.zIndex = String(++floatZ);

  const head = document.createElement("div");
  head.className = "fp-head";
  const title = document.createElement("b");
  title.textContent = opts.title || "";
  head.appendChild(title);
  if (opts.subtitle) {
    const sub = document.createElement("span");
    sub.className = "fp-sub";
    sub.textContent = opts.subtitle;
    head.appendChild(sub);
  }
  head.appendChild(Object.assign(document.createElement("span"), { className: "spacer" }));
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tbtn fp-close";
  closeBtn.textContent = "✕";
  closeBtn.title = "关闭";
  head.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "fp-body";
  if (opts.bodyHtml !== undefined) body.innerHTML = opts.bodyHtml;
  if (opts.bodyNode) body.appendChild(opts.bodyNode);

  el.appendChild(head);
  el.appendChild(body);
  host.appendChild(el);

  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(-r.width + 90, Math.min(vw - 60, e.clientX - drag.dx));
    const ny = Math.max(0, Math.min((window.innerHeight || 800) - 38, e.clientY - drag.dy));
    el.style.left = nx + "px";
    el.style.top = ny + "px";
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove("dragging");
  };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);

  const handle = {
    el,
    body,
    titleEl: title,
    setTitle(t) {
      title.textContent = t;
      return handle;
    },
    raise() {
      el.style.zIndex = String(++floatZ);
      return handle;
    },
    close() {
      el.remove();
      document.removeEventListener("keydown", onKey, true);
      if (opts.onClose) opts.onClose();
    },
  };
  function onKey(e) {
    if (e.key === "Escape" && opts.closeOnEscape !== false) {
      e.stopPropagation();
      handle.close();
    }
  }
  el.addEventListener("pointerdown", () => handle.raise());
  closeBtn.addEventListener("click", () => handle.close());
  document.addEventListener("keydown", onKey, true);
  return handle;
}

// 等 KaTeX 就绪后把元素里的 \( \) 与 $$ $$ 排版出来。
export function renderMath(el) {
  const run = () => {
    if (typeof window.renderMathInElement !== "function") return false;
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      throwOnError: false,
    });
    return true;
  };
  if (run()) return;
  let tries = 0;
  const timer = window.setInterval(() => {
    if (run() || ++tries > 60) window.clearInterval(timer);
  }, 100);
}
