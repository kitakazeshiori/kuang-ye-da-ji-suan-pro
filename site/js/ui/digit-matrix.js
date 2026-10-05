// 高精度数值组件：把定点实数显示成「数位矩阵」，支持按位编辑。
//
// 版式：
//   上部分若干行 = 整数位（每一行最右格是个位方向，行末为 10^0）
//   中间一条分割线
//   下部分若干行 = 小数位（10^-1 … 10^-72，完整显示）
//
// 交互（Hex Editor 风格）：
//   * 单击 / 拖动选择格子，Shift+单击扩展选区；
//   * 直接输入数字 = 覆盖当前格并右移一格；
//   * Backspace / Delete / 剪切 = 删除后把后面的数字整体左移（不是补 0）；
//   * 粘贴 = 在光标处插入（后面右移），文本里的 "." 会把光标移到小数首位；
//   * Ctrl+A 全选，Ctrl+C/X/V 复制/剪切/粘贴，方向键移动光标。
//
// 数值解析与位运算全部走 core/digits.js，保证与评测器 72 位定点语义一致。
import { parseDecimal } from "../core/bigreal.js";
import {
  applyDelete,
  applyInsert,
  isDim,
  isZero as digitsIsZero,
  placeOf,
  selectionText as digitsSelectionText,
  splitDigits,
  toRawText,
  toText,
} from "../core/digits.js";

export const COLS = 12;
export const INT_ROWS = 2;
export const FRAC_ROWS = 6;
export const FRAC_TOTAL = FRAC_ROWS * COLS; // 72 位小数
const MAX_INT_ROWS = 8;

export class DigitMatrix {
  constructor(opts = {}) {
    this.cols = opts.cols || COLS;
    this.intRows = Math.max(1, Math.min(MAX_INT_ROWS, opts.intRows || INT_ROWS));
    this.minIntRows = Math.max(1, Math.min(MAX_INT_ROWS, opts.minIntRows || this.intRows));
    this.fracRows = opts.fracRows || FRAC_ROWS;
    this.adaptive = opts.adaptive !== false;
    this.readonly = !!opts.readonly;
    this.onChange = opts.onChange || null;
    this.onCopyToast = opts.onCopyToast || null;
    this.label = opts.label || "";
    this.sign = false;
    this.caret = 0;
    this.anchor = null;
    this.digits = new Array(this.intTotal + this.fracTotal).fill("0");
    this.cells = [];
    this.el = document.createElement("div");
    this.el.className = "dm" + (this.readonly ? " readonly" : "");
    if (!this.readonly) this.el.tabIndex = 0;
    this._build();
    this._bind();
    this._paint();
  }

  get intTotal() {
    return this.intRows * this.cols;
  }

  get fracTotal() {
    return this.fracRows * this.cols;
  }

  get total() {
    return this.intTotal + this.fracTotal;
  }

  // ---------- 构建 ----------

  _build() {
    this.el.innerHTML = "";
    const head = document.createElement("div");
    head.className = "dm-head";
    this.titleEl = document.createElement("span");
    this.titleEl.className = "dm-title";
    this.titleEl.textContent = this.label;
    head.appendChild(this.titleEl);
    head.appendChild(Object.assign(document.createElement("span"), { className: "dm-spacer" }));
    if (!this.readonly) {
      this.signBtn = document.createElement("button");
      this.signBtn.className = "dm-btn dm-sign";
      this.signBtn.type = "button";
      this.signBtn.title = "切换正负号";
      this.signBtn.tabIndex = -1;
      this.signBtn.addEventListener("click", () => {
        this.sign = !this.sign && this.digits.some((d) => d !== "0");
        this._paint();
        this._emit();
      });
      head.appendChild(this.signBtn);
    }
    this.copyBtn = document.createElement("button");
    this.copyBtn.className = "dm-btn";
    this.copyBtn.type = "button";
    this.copyBtn.title = "复制数值";
    this.copyBtn.tabIndex = -1;
    this.copyBtn.textContent = "⧉";
    this.copyBtn.addEventListener("click", () => this.copyAll());
    head.appendChild(this.copyBtn);
    this.el.appendChild(head);

    this.gridEl = document.createElement("div");
    this.gridEl.className = "dm-grid";
    this.el.appendChild(this.gridEl);
    this._buildRows();
  }

  _buildRows() {
    this.gridEl.innerHTML = "";
    this.cells = [];
    const mkRow = (row) => {
      const r = document.createElement("div");
      r.className = "dm-row";
      for (let c = 0; c < this.cols; c++) {
        const i = row * this.cols + c;
        const cell = document.createElement("span");
        cell.className = "dm-cell";
        cell.dataset.i = String(i);
        const d = document.createElement("b");
        d.className = "dm-digit";
        cell.appendChild(d);
        r.appendChild(cell);
        this.cells[i] = { el: cell, digit: d, index: i };
      }
      return r;
    };
    for (let r = 0; r < this.intRows; r++) this.gridEl.appendChild(mkRow(r));
    const sep = document.createElement("div");
    sep.className = "dm-sep";
    sep.title = "小数点";
    this.gridEl.appendChild(sep);
    for (let r = 0; r < this.fracRows; r++) this.gridEl.appendChild(mkRow(this.intRows + r));
    this._paint();
  }

  // ---------- 解析 / 输出 ----------

  setDigits(ip, fp, sign, opts = {}) {
    const int = String(ip === undefined || ip === null ? "" : ip).replace(/[^0-9]/g, "");
    const frac = String(fp === undefined || fp === null ? "" : fp).replace(/[^0-9]/g, "");
    const src = int.slice(-this.intTotal).padStart(this.intTotal, "0");
    const fr = (frac + "0".repeat(this.fracTotal)).slice(0, this.fracTotal);
    this.digits = (src + fr).split("");
    this.sign = !!sign && !digitsIsZero(this.digits);
    this._paint();
    if (!opts.silent) this._emit();
  }

  // 从十进制 / 科学计数法文本载入（语义与 Real::decimal 一致）
  setText(text, opts = {}) {
    const s = String(text === undefined || text === null ? "" : text).trim();
    let canon;
    try {
      canon = parseDecimal(s === "" ? "0" : s).toString();
    } catch (err) {
      canon = "0";
    }
    const body = canon.startsWith("-") ? canon.slice(1) : canon;
    const dot = body.indexOf(".");
    if (this.adaptive) this._fitIntRows(dot < 0 ? body.length : dot);
    const { digits, neg } = splitDigits(canon, this.intTotal, this.fracTotal);
    this.setDigits(digits.slice(0, this.intTotal).join(""), digits.slice(this.intTotal).join(""), neg, opts);
  }

  setFromReal(real, opts = {}) {
    this.setText(real.toString(), opts);
  }

  // 完整定点文本（整数位补前导 0，小数固定 72 位）
  getRawText() {
    return toRawText(this.digits, this.intTotal, this.sign);
  }

  // 去掉多余 0 的紧凑文本，用于导出与存储
  getText() {
    return toText(this.digits, this.intTotal, this.sign);
  }

  isZero() {
    return digitsIsZero(this.digits);
  }

  // ---------- 行数自适应 ----------

  _fitIntRows(len) {
    const need = Math.max(this.minIntRows, Math.min(MAX_INT_ROWS, Math.ceil(Math.max(1, len) / this.cols)));
    if (need !== this.intRows) this._setIntRows(need);
  }

  _setIntRows(n) {
    if (n === this.intRows) return;
    const oldIp = this.digits.slice(0, this.intTotal).join("");
    const oldFp = this.digits.slice(this.intTotal).join("");
    this.intRows = n;
    const ip = oldIp.slice(-this.intTotal).padStart(this.intTotal, "0");
    const fp = (oldFp + "0".repeat(this.fracTotal)).slice(0, this.fracTotal);
    this.digits = (ip + fp).split("");
    this._buildRows();
  }

  // ---------- 渲染 ----------

  _paint() {
    const sel = this.selRange();
    for (let i = 0; i < this.total; i++) {
      const c = this.cells[i];
      if (!c) continue;
      c.digit.textContent = this.digits[i];
      c.el.title = "10^" + placeOf(i, this.intTotal);
      c.el.classList.toggle("dim", isDim(this.digits, i, this.intTotal));
      c.el.classList.toggle("sel", !!sel && i >= sel[0] && i < sel[1]);
      c.el.classList.toggle("caret", !this.readonly && i === this.caret && !sel);
    }
    if (this.signBtn) {
      this.signBtn.textContent = this.sign ? "−" : "+";
      this.signBtn.classList.toggle("neg", this.sign);
    }
    if (this.titleEl) this.titleEl.textContent = this.label;
  }

  selRange() {
    if (this.anchor === null || this.anchor === this.caret) return null;
    return this.anchor < this.caret ? [this.anchor, this.caret] : [this.caret, this.anchor];
  }

  selectionText() {
    const sel = this.selRange();
    const a = sel ? sel[0] : 0;
    const b = sel ? sel[1] : this.total;
    return digitsSelectionText(this.digits, this.intTotal, a, b, this.sign);
  }

  // ---------- 交互 ----------

  _indexFromEvent(e) {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const cell = t && t.closest ? t.closest(".dm-cell") : null;
    if (!cell || !this.el.contains(cell)) return null;
    const i = Number(cell.dataset.i);
    return Number.isInteger(i) ? i : null;
  }

  _bind() {
    const el = this.el;
    this._dragging = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button === 2) return;
      const i = this._indexFromEvent(e);
      if (i === null) return;
      e.preventDefault();
      if (!this.readonly) el.focus({ preventScroll: true });
      if (e.shiftKey && this.anchor !== null) {
        this.caret = i;
      } else {
        this.anchor = i;
        this.caret = i;
      }
      this._dragging = true;
      this._paint();
    });
    el.addEventListener("pointermove", (e) => {
      if (!this._dragging) return;
      const i = this._indexFromEvent(e);
      if (i === null || i === this.caret) return;
      this.caret = i;
      this._paint();
    });
    const endDrag = () => {
      this._dragging = false;
    };
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    window.addEventListener("pointerup", endDrag);

    el.addEventListener("keydown", (e) => this.onKeyDown(e));
    el.addEventListener("copy", (e) => this.onCopy(e, false));
    el.addEventListener("cut", (e) => this.onCopy(e, true));
    el.addEventListener("paste", (e) => this.onPaste(e));
    el.addEventListener("focus", () => this._paint());
    el.addEventListener("blur", () => this._paint());
    el.addEventListener("selectstart", (e) => e.preventDefault());
  }

  _commit(emit = true) {
    this.anchor = null;
    this.caret = Math.max(0, Math.min(this.caret, this.total - 1));
    this._paint();
    if (emit) this._emit();
  }

  _move(delta, extend) {
    const next = Math.max(0, Math.min(this.total - 1, this.caret + delta));
    if (extend) {
      if (this.anchor === null) this.anchor = this.caret;
    } else {
      this.anchor = null;
    }
    this.caret = next;
    this._paint();
  }

  _swallow(e, fn) {
    e.preventDefault();
    fn();
  }

  onKeyDown(e) {
    // 数位矩阵是输入控件：所有按键都在此消费，避免冒泡触发编辑器快捷键。
    e.stopPropagation();
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "a" || k === "A")) {
      this.anchor = 0;
      this.caret = this.total - 1;
      e.preventDefault();
      this._paint();
      return;
    }
    if (k === "ArrowLeft") return this._swallow(e, () => this._move(-1, e.shiftKey));
    if (k === "ArrowRight") return this._swallow(e, () => this._move(1, e.shiftKey));
    if (k === "ArrowUp") return this._swallow(e, () => this._move(-this.cols, e.shiftKey));
    if (k === "ArrowDown") return this._swallow(e, () => this._move(this.cols, e.shiftKey));
    if (k === "Home") return this._swallow(e, () => this._move(-this.caret, e.shiftKey));
    if (k === "End") return this._swallow(e, () => this._move(this.total - 1 - this.caret, e.shiftKey));
    if (this.readonly) return;
    if (k === "Backspace") {
      return this._swallow(e, () => {
        const sel = this.selRange();
        if (sel) this.deleteRange(sel[0], sel[1]);
        else if (this.caret > 0) this.deleteRange(this.caret - 1, this.caret);
      });
    }
    if (k === "Delete") {
      return this._swallow(e, () => {
        const sel = this.selRange();
        if (sel) this.deleteRange(sel[0], sel[1]);
        else this.deleteRange(this.caret, this.caret + 1);
      });
    }
    if (k.length === 1 && k >= "0" && k <= "9") {
      return this._swallow(e, () => {
        const sel = this.selRange();
        if (sel) this.deleteRange(sel[0], sel[1], { silent: true });
        // 覆盖模式：写入当前格并右移一格。
        this.digits[this.caret] = k;
        this.caret = Math.min(this.caret + 1, this.total - 1);
        this._commit();
      });
    }
    if (k === "-") {
      return this._swallow(e, () => {
        this.sign = !this.sign && !this.isZero();
        this._commit();
      });
    }
    if (k === "." || k === ",") {
      return this._swallow(e, () => {
        this.caret = Math.min(this.intTotal, this.total - 1);
        this.anchor = null;
        this._paint();
      });
    }
  }

  // 删除 [from, to) 并把后面整体左移，末尾补 0
  deleteRange(from, to, opts = {}) {
    this.caret = applyDelete(this.digits, from, to, this.total);
    this.anchor = null;
    if (!opts.silent) this._commit();
  }

  // 在光标处插入（后面右移，溢出的末尾丢弃）
  insertText(text) {
    const r = applyInsert(this.digits, this.caret, text, this.total, this.intTotal, this.sign);
    this.caret = r.caret;
    this.sign = r.neg;
    this._commit();
  }

  onCopy(e, cut) {
    const sel = this.selRange();
    const text = sel ? this.selectionText() : this.getText();
    if (e && e.clipboardData) {
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
    }
    if (cut && sel && !this.readonly) this.deleteRange(sel[0], sel[1]);
  }

  onPaste(e) {
    if (this.readonly) return;
    const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    e.preventDefault();
    const sel = this.selRange();
    if (sel) this.deleteRange(sel[0], sel[1], { silent: true });
    this.insertText(text);
  }

  copyAll() {
    const text = this.getText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      this._fallbackCopy(text);
    }
    if (this.onCopyToast) this.onCopyToast(text);
  }

  _fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch (err) {
      /* 忽略 */
    }
  }

  _emit() {
    if (this.onChange) this.onChange(this.getText());
  }

  setReadonly(ro) {
    this.readonly = !!ro;
    this.el.classList.toggle("readonly", this.readonly);
    if (this.readonly) this.el.removeAttribute("tabindex");
    else this.el.tabIndex = 0;
    this._paint();
  }

  setLabel(text) {
    this.label = text || "";
    if (this.titleEl) this.titleEl.textContent = this.label;
  }

  focus() {
    if (!this.readonly) this.el.focus({ preventScroll: true });
  }

  hasFocus() {
    return document.activeElement === this.el;
  }

  destroy() {
    this.el.remove();
  }
}