// 应用装配：把图模型、渲染器、交互控制器和 DOM 界面接起来。
import { Graph } from "../core/graph.js";
import {
  FunctionLibrary,
  buildFunctionDef,
  expandGraph,
  expandCallInPlace,
  resultCandidates,
} from "../core/functions.js";
import { analyze, checkConstText } from "../core/validate.js";
import * as progress from "../core/progress.js";
import { GraphFormatError, fromProblemText, toProblemText } from "../core/serialize.js";
import { evaluateGraph, loadVectors, gradeAgainstVectorsAsync } from "../core/evaluate.js";
import { History } from "../core/history.js";
import { NODE_TYPES, TYPE_ORDER } from "../core/types.js";
import { LEVELS, SANDBOX, TASKS, getLevel } from "../core/levels.js";
import { Renderer } from "../render/renderer.js";
import { DigitMatrix } from "./digit-matrix.js";
import { Editor } from "../editor/editor.js";
import * as ui from "./widgets.js";
import { PROBLEM_TITLE, PROBLEM_LIMITS, problemForLevel } from "../core/problem.js";

const STORAGE_KEY = "cgw.state.v1";
// 画布上没有函数调用时的空映射，避免每次状态刷新都新建对象。
const EMPTY_FN_MAP = new Map();
const AUTOSAVE_MS = 700;
// 超过这个规模就不做实时求值，避免编辑大图时主线程被周期性占满。
const LIVE_EVAL_MAX_NODES = 4000;

export class App {
  constructor() {
    this.dom = {
      canvas: document.getElementById("board"),
      paletteList: document.getElementById("palette-list"),
      brandSub: document.getElementById("brand-sub"),
      statNodes: document.getElementById("stat-nodes"),
      statCost: document.getElementById("stat-cost"),
      statLevel: document.getElementById("stat-level"),
      statView: document.getElementById("stat-view"),
      statCheck: document.getElementById("stat-check"),
      check: document.getElementById("btn-check"),
      undo: document.getElementById("btn-undo"),
      redo: document.getElementById("btn-redo"),
      toolSelect: document.getElementById("tool-select"),
      toolPan: document.getElementById("tool-pan"),
      snap: document.getElementById("btn-snap"),
      zoomLabel: document.getElementById("zoom-label"),
      canvasWrap: document.getElementById("canvas-wrap"),
      valBody: document.getElementById("val-body"),
      valKind: document.getElementById("val-kind"),
      nodeMenu: document.getElementById("node-menu"),
      btnVal: document.getElementById("btn-val"),
      weightLeft: document.getElementById("weight-left"),
      btnProblem: document.getElementById("btn-problem"),
    };
    this.level = SANDBOX;
    this.progress = {}; // 每关的通关记录：{ passed, stars, score, bestW, at }
    this.savedGraphs = {}; // 每关各自的画布：{ levelKey: graphJSON }
    this.lib = new FunctionLibrary(); // 用户函数库（本地保存，所有关卡共用）
    this._expCache = null;
    this.lastCheck = null;
    this.cascade = 0;
    this.checkConst = checkConstText;
    this._statusAt = 0;
    this._saveTimer = 0;
    this._valKey = null;
    this._valTimer = 0;
    this._valPort = 0;
    this._valDm = null;
    this._values = null;
    this._valError = null;
    this._ioCollapsedSaved = undefined;
    this._nodeMenuOutside = null;
  }

  // ---------- 启动 ----------

  boot() {
    this.renderer = new Renderer(this.dom.canvas);
    this.graph = new Graph();
    this.history = new History();
    this.editor = new Editor({
      graph: this.graph,
      renderer: this.renderer,
      canvas: this.dom.canvas,
      level: this.level,
      commit: (label) => this.commit(label),
      onChange: () => this.onGraphChange(),
      onViewChange: () => this.onViewChange(),
      onToast: (m, k) => ui.toast(m, k),
      onSelectionChange: () => this.onSelectionChange(),
      onQuickMenu: (p) => this.openQuickMenu(p),
      onEditNode: (id) => this.editNode(id),
      onNodeMenu: (p) => this.openNodeMenu(p),
      fnDef: (name) => this.lib.get(name),
      onCursor: (c) => {
        this.dom.canvas.style.cursor = c;
      },
    });
    this.editor.onUndo = (dir) => this.undoRedo(dir);
    this.editor.onEscape = () => ui.closeQuickMenu();
    this.editor.attach();
    this.renderer.setGraph(this.graph);

    this.buildPalette();
    this.bindToolbar();

    const restored = this.restore();
    if (!restored) {
      this.graph = this.makeStarter();
      this.editor.setGraph(this.graph);
      this.renderer.setGraph(this.graph);
      this.history.reset(JSON.stringify(this.graph.toJSON()), "初始状态");
      this.renderer.invalidateAll();
    }

    this.initValuePanel();
    this.scheduleValues(true);

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(document.getElementById("canvas-wrap"));
    window.addEventListener("resize", () => this.onResize());
    this.onResize();
    this.editor.fit();
    this.onResize();

    document.getElementById("btn-help").addEventListener("click", () => this.showHelp());
    this.dom.btnProblem.addEventListener("click", () => this.openProblem());
    document.getElementById("btn-levels").addEventListener("click", () => this.showLevels());

    document.addEventListener("keydown", (e) => {
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        if (Editor.isTypingTarget(e.target)) return;
        this.showHelp();
      }
      if ((e.key === "u" || e.key === "U") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (Editor.isTypingTarget(e.target)) return;
        this.toggleValue();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        this.saveNow();
        ui.toast("已保存到本地", "ok");
      }
    });

    this.renderStatus();
    this.updateUndoButtons();
    this.updateHud();
    this.renderSelection();
    this._loop = () => {
      if (this.renderer._dirty) {
        this.renderer._dirty = false;
        this.renderer.draw();
      }
      this._raf = requestAnimationFrame(this._loop);
    };
    this._raf = requestAnimationFrame(this._loop);

    if (!restored) window.setTimeout(() => this.showLevels(true), 300);
  }

  makeStarter() {
    const g = new Graph();
    const i = g.createNode("I", -300, -30);
    const c = g.createNode("C", -300, 120, { value: "1" });
    const sum = g.createNode("add", -90, 40);
    const out = g.createNode("out", 140, 60, { arity: 1 });
    g.connect(i.id, sum.id, 0);
    g.connect(c.id, sum.id, 1);
    g.connect(sum.id, out.id, 0);
    return g;
  }

  // ---------- 尺寸 / 视口 ----------

  onResize() {
    this.renderer.resize();
    this.editor.refreshRect();
    this.renderer.requestDraw();
    this.renderStatus();
  }

  onViewChange() {
    this.renderer.requestDraw();
    this.editor.refreshRect();
    const pct = Math.round(this.renderer.view.scale * 100) + "%";
    this.dom.statView.textContent = pct;
    this.dom.zoomLabel.textContent = pct;
  }
  // ---------- 变更钩子 ----------

  commit(label) {
    this.history.push(JSON.stringify(this.graph.toJSON()), label);
    this.updateUndoButtons();
    this.lastCheck = null;
    this.markCheckStale();
    this.scheduleSave();
  }

  onGraphChange() {
    this.scheduleStatus();
    this.scheduleSave();
    this.markCheckStale();
    this.scheduleValues();
    this.updateHud();
  }

  onSelectionChange() {
    this.renderSelection();
    this.renderStatus();
  }

  scheduleStatus() {
    const now = Date.now();
    if (now - this._statusAt < 90) return;
    this._statusAt = now;
    this.renderStatus();
  }

  scheduleSave() {
    window.clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => this.saveNow(), AUTOSAVE_MS);
  }

  // 把当前画布写进它所属关卡的槽位。
  stashCurrent() {
    if (!this.savedGraphs) this.savedGraphs = {};
    this.savedGraphs[this.level.key] = this.graph.toJSON();
  }

  saveNow() {
    this.stashCurrent();
    const payload = {
      v: 2,
      level: this.level.key,
      graphs: this.savedGraphs,
      progress: this.progress,
      functions: this.lib.toJSON(),
      view: this.renderer.view,
      io: document.body.classList.contains("val-collapsed"),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      // 配额不足时退化为只保存当前关卡，保证正在编辑的图不丢。
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: 2,
            level: payload.level,
            graphs: { [payload.level]: this.savedGraphs[payload.level] },
            progress: this.progress,
            functions: this.lib.toJSON(),
            view: payload.view,
          })
        );
      } catch (err2) {
        // 仍然失败就静默放弃，不影响编辑。
      }
    }
  }

  restore() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return false;
    }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data) return false;
      if (data.graphs && typeof data.graphs === "object") {
        this.savedGraphs = data.graphs;
        this.progress = data.progress && typeof data.progress === "object" ? data.progress : {};
        this.lib = FunctionLibrary.fromJSON(data);
        this._expCache = null;
        this.buildPalette();
      } else if (data.graph) {
        // 旧版单图存档：迁移成「按关卡存放」。
        this.savedGraphs = { [data.level || "sandbox"]: data.graph };
        this.progress = {};
      } else {
        return false;
      }
      this.level = getLevel(data.level || "sandbox");
      this._ioCollapsedSaved = data.io;
      const saved = this.savedGraphs[this.level.key];
      this.graph = saved ? Graph.fromJSON(saved) : this.level.key === "sandbox" ? this.makeStarter() : new Graph();
      this.editor.setLevel(this.level);
      this.editor.setGraph(this.graph);
      this.renderer.setGraph(this.graph);
      this.history.reset(JSON.stringify(this.graph.toJSON()), "已恢复的进度");
      if (data.view && typeof data.view.scale === "number") {
        this.renderer.view.x = data.view.x || 0;
        this.renderer.view.y = data.view.y || 0;
        this.renderer.view.scale = Math.min(6, Math.max(0.02, data.view.scale || 1));
      } else {
        this.renderer.invalidateAll();
        this.editor.fit();
      }
      this.updateBrand();
      return true;
    } catch (err) {
      return false;
    }
  }

  // ---------- 撤销 / 重做 ----------

  undoRedo(dir) {
    const snap = dir === "undo" ? this.history.undo() : this.history.redo();
    if (!snap) return;
    this.graph = Graph.fromJSON(JSON.parse(snap));
    this.editor.setGraph(this.graph);
    this.renderer.setGraph(this.graph);
    this.renderer.invalidateAll();
    this.renderer.requestDraw();
    this.editor.syncSelection();
    this.renderStatus();
    this.scheduleValues(true);
    this.updateUndoButtons();
    this.lastCheck = null;
    this.markCheckStale();
    this.scheduleSave();
    ui.toast(dir === "undo" ? "已撤销" : "已重做");
  }

  updateUndoButtons() {
    this.dom.undo.disabled = !this.history.canUndo;
    this.dom.redo.disabled = !this.history.canRedo;
  }

  // ---------- 面板 / 状态 ----------

  buildPalette() {
    const list = this.dom.paletteList;
    list.innerHTML = "";
    for (const key of TYPE_ORDER) {
      const t = NODE_TYPES[key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pnode";
      btn.dataset.key = key;
      btn.title = t.name + "（W" + t.weight + "）：" + t.desc + "　拖到画布即可创建";
      btn.innerHTML =
        ui.glyphBox(key) +
        '<span class="pnode-meta"><b>' +
        ui.escapeHtml(t.name) +
        "</b></span>" +
        '<span class="pnode-weight">W' +
        t.weight +
        "</span>";
      list.appendChild(btn);
    }
    this._buildFnPalette(list);
    this._bindPaletteDrag();
  }

  // 工具箱下半部分：函数库。拖出来就是调用节点；「打包选中」把当前选区封装成函数。
  _buildFnPalette(list) {
    const head = document.createElement("div");
    head.className = "fn-head";
    const label = document.createElement("span");
    label.textContent = "函数";
    head.appendChild(label);
    const sp = document.createElement("span");
    sp.className = "spacer";
    head.appendChild(sp);
    const pack = document.createElement("button");
    pack.type = "button";
    pack.className = "fn-pack";
    pack.textContent = "＋ 打包选中";
    pack.title = "把画布上选中的节点封装成一个可复用的函数";
    pack.addEventListener("click", () => this.openPackDialog());
    head.appendChild(pack);
    list.appendChild(head);
    if (this.lib.size === 0) {
      const hint = document.createElement("div");
      hint.className = "fn-empty";
      hint.textContent = "框选一组节点后点「打包选中」，就能把它变成拖出来即可调用的函数。";
      list.appendChild(hint);
      return;
    }
    for (const def of this.lib.list()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pnode";
      btn.dataset.key = "fn:" + def.name;
      btn.title = "函数 " + def.name + "（" + def.params + " 个参数；展开后 W" + def.weight + "）";
      btn.innerHTML =
        ui.glyphBox("fn") +
        '<span class="pnode-meta"><b>' + ui.escapeHtml(def.name) + "</b><small>" + def.params + " 参</small></span>" +
        '<span class="pnode-weight">W' + def.weight + "</span>";
      list.appendChild(btn);
    }
  }

  // 工具箱：指针拖拽（桌面与触屏通用）。拖到画布松手即在落点创建，单击则放在视图中央。
  _bindPaletteDrag() {
    if (this._paletteBound) return;
    this._paletteBound = true;
    const list = this.dom.paletteList;
    list.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const btn = e.target && e.target.closest ? e.target.closest(".pnode") : null;
      if (!btn) return;
      const key = btn.dataset.key;
      const resolved = this._resolveKey(key);
      if (!resolved) return;
      const ghostGlyph = key.startsWith("fn:") ? "fn" : key;
      const start = { x: e.clientX, y: e.clientY };
      let ghost = null;
      let dragging = false;
      let cancelled = false;

      const onMove = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
          dragging = true;
          btn.classList.add("dragging");
          ghost = document.createElement("div");
          ghost.className = "drag-ghost";
          ghost.innerHTML = ui.glyphBox(ghostGlyph) + "<span>" + ui.escapeHtml(resolved.label) + "</span>";
          document.body.appendChild(ghost);
        }
        ghost.style.left = ev.clientX + "px";
        ghost.style.top = ev.clientY + "px";
        this.dom.canvasWrap.classList.toggle("drop-active", this._overCanvas(ev.clientX, ev.clientY));
        if (ev.cancelable) ev.preventDefault();
      };

      let finished = false;
      const finish = (ev, ok) => {
        if (finished) return;
        finished = true;
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        btn.classList.remove("dragging");
        if (ghost) ghost.remove();
        this.dom.canvasWrap.classList.remove("drop-active");
        if (cancelled) return;
        if (dragging) {
          if (ok && this._overCanvas(ev.clientX, ev.clientY)) this.addNodeAtScreen(key, ev.clientX, ev.clientY);
          return;
        }
        if (ok) this.addFromPalette(key);
      };
      const onUp = (ev) => finish(ev, true);
      const onCancel = () => {
        cancelled = true;
        finish(null, false);
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      if (e.cancelable) e.preventDefault();
    });
  }

  _overCanvas(x, y) {
    const r = this.dom.canvas.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  // 工具箱条目的 key 既可以是节点类型，也可以是 "fn:函数名"。
  _resolveKey(key) {
    if (typeof key === "string" && key.startsWith("fn:")) {
      const name = key.slice(3);
      const def = this.lib.get(name);
      if (!def) {
        ui.toast("函数「" + name + "」不存在", "error");
        return null;
      }
      return { type: "fn", opts: { fn: name, arity: def.params }, label: "函数 " + name };
    }
    const t = NODE_TYPES[key];
    if (!t) return null;
    return { type: key, opts: {}, label: t.name };
  }

  _canAdd(key) {
    const r = this._resolveKey(key);
    if (!r) return null;
    if (r.type === "out" && this.graph.outNodes().length > 0) {
      ui.toast("只能有一个输出节点", "error");
      return null;
    }
    return r;
  }

  addNodeAtScreen(key, clientX, clientY) {
    const r = this._canAdd(key);
    if (!r) return;
    const rect = this.dom.canvas.getBoundingClientRect();
    const wp = this.renderer.screenToWorld(clientX - rect.left, clientY - rect.top);
    const node = this.editor.addNodeAt(r.type, wp, { center: true, ...r.opts });
    if (node) ui.toast("已添加 " + r.label);
  }

  addFromPalette(key) {
    const r = this._canAdd(key);
    if (!r) return;
    const rr = this.renderer;
    const wp = rr.screenToWorld(rr.cssW / 2, rr.cssH / 2);
    this.cascade = (this.cascade + 1) % 5;
    const off = (this.cascade - 2) * 26;
    const node = this.editor.addNodeAt(r.type, { x: wp.x + off, y: wp.y + off }, { center: true, ...r.opts });
    if (node) ui.toast("已添加 " + r.label);
  }

  // 画布图 + 函数库展开后的平图。求值 / 校验 / 导出 / 算权重都用它。
  effective() {
    if (
      this._expCache &&
      this._expCache.version === this.graph.version &&
      this._expCache.libVersion === this.lib.version
    ) {
      return this._expCache.res;
    }
    // 画布上没有函数调用时直接返回原图：展开等于整体克隆，大图下没必要。
    let hasFn = false;
    for (const n of this.graph.nodes.values()) {
      if (n.type === "fn") {
        hasFn = true;
        break;
      }
    }
    const res = hasFn ? expandGraph(this.graph, this.lib) : { ok: true, graph: this.graph, fnMap: EMPTY_FN_MAP };
    this._expCache = { version: this.graph.version, libVersion: this.lib.version, res };
    return res;
  }

  bindToolbar() {
    this.dom.undo.addEventListener("click", () => this.undoRedo("undo"));
    this.dom.redo.addEventListener("click", () => this.undoRedo("redo"));
    this.dom.toolSelect.addEventListener("click", () => this.editor.setTool("select"));
    this.dom.toolPan.addEventListener("click", () => this.editor.setTool("pan"));
    this.dom.snap.addEventListener("click", () => this.editor.setSnap(!this.editor.snap));
    document.getElementById("btn-zoom-in").addEventListener("click", () => this.editor.setZoom(this.renderer.view.scale * 1.25));
    document.getElementById("btn-zoom-out").addEventListener("click", () => this.editor.setZoom(this.renderer.view.scale / 1.25));
    this.dom.zoomLabel.addEventListener("click", () => this.editor.setZoom(1));
    document.getElementById("btn-fit").addEventListener("click", () => this.editor.fit());
    // 导入入口已从工具栏移除：需要时在控制台执行 showImport()（见 main.js）。
    const importBtn = document.getElementById("btn-import");
    if (importBtn) importBtn.addEventListener("click", () => this.showImport());
    document.getElementById("btn-export").addEventListener("click", () => this.showExport());
    document.getElementById("btn-clear").addEventListener("click", () => this.clearCanvas());
    this.dom.check.addEventListener("click", () => this.runCheck());
    this.dom.statCheck.addEventListener("click", () => this.runCheck());
  }

  markCheckStale() {
    const chip = this.dom.statCheck;
    if (chip.classList.contains("stale")) return;
    chip.className = "chip stale";
    chip.textContent = "待检查";
  }

  renderStatus() {
    const g = this.graph;
    const eff = this.effective();
    const cost = eff.ok ? eff.graph.cost() : g.cost();
    const total = eff.ok ? eff.graph.size : g.size;
    this.dom.statNodes.textContent = "节点 " + ui.formatInt(g.size) + (total !== g.size ? " → " + ui.formatInt(total) : "");
    this.dom.statCost.textContent = "加权 " + ui.formatInt(cost);
    const base = this.level.base;
    this.dom.statLevel.textContent = this.level.name + (base ? " · 基准 " + ui.formatInt(base) : "");
    this.dom.statView.textContent = Math.round(this.renderer.view.scale * 100) + "%";
    const wleft = this.dom.weightLeft;
    if (wleft) {
      if (base) {
        const rem = base - cost;
        wleft.hidden = false;
        wleft.querySelector("b").textContent = ui.formatInt(rem);
        wleft.classList.toggle("neg", rem < 0);
      } else {
        wleft.hidden = true;
      }
    }
    this.dom.toolSelect.classList.toggle("active", this.editor.tool === "select");
    this.dom.toolPan.classList.toggle("active", this.editor.tool === "pan");
    this.dom.snap.classList.toggle("active", this.editor.snap);
    this.dom.snap.textContent = this.editor.snap ? "⌗ 吸附" : "⌗";
  }

  updateBrand() {
    const p = this.progressOf(this.level.key);
    this.dom.brandSub.textContent =
      this.level.name +
      (this.level.base ? " · 基准 B " + this.level.base : "") +
      (p ? " · " + this.starsText(p.stars) + " 最佳 W" + ui.formatInt(p.bestW) : "");
  }

  updateHud() {
    if (this.graph.size === 0) {
      ui.hudHint("点击左侧节点添加，或双击空白处快速新建；从端口拖出可连线。");
    } else {
      ui.hudHint(null);
    }
  }
  // ---------- 快速新建 ----------

  openQuickMenu(payload) {
    let items = TYPE_ORDER.map((k) => NODE_TYPES[k]);
    if (payload.side === "needs-input") items = items.filter((t) => t.arity > 0 || t.variableArity);
    else if (payload.side === "needs-output") items = items.filter((t) => t.hasOutput);
    const rect = this.dom.canvas.getBoundingClientRect();
    const list = items.map((t) => ({ key: t.key, name: t.name, weight: t.weight }));
    // 自定义函数排在最前面，往空白处拖线时可以直接建一个调用节点。
    const fns = this.lib.list().slice(0, 6).map((d) => ({
      key: "fn:" + d.name,
      glyphKey: "fn",
      name: "ƒ " + d.name,
      weight: d.weight,
    }));
    list.unshift(...fns);
    ui.openQuickMenu(
      list,
      { x: rect.left + payload.screen.x, y: rect.top + payload.screen.y },
      (key) => this.editor.applyQuickChoice(key),
      () => {
        this.editor.quick = null;
      }
    );
  }

  // 双击节点：I / OUT 改名，C 编辑常数，其余仅选中（数值面板会显示其只读数值）。
  editNode(id) {
    const node = this.graph.get(id);
    if (!node) return;
    const t = NODE_TYPES[node.type];
    if (t.hasName) return this.openRename(node);
    if (t.hasValue) return this.openConstEditor(node);
    if (t.isCall) return this.openFnInfo(node);
    this.editor.select([id]);
  }

  // ---------- 节点右侧菜单 ----------

  openNodeMenu(payload) {
    const node = payload && payload.node;
    const el = this.dom.nodeMenu;
    if (!node || !el) return;
    const rect = this.dom.canvas.getBoundingClientRect();
    el.innerHTML = "";
    const title = document.createElement("div");
    title.className = "node-menu-title";
    title.textContent = "#" + node.id + " " + NODE_TYPES[node.type].name;
    el.appendChild(title);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "qm-item danger";
    del.textContent = "delete";
    del.addEventListener("click", () => {
      this.closeNodeMenu();
      this.deleteNode(node.id);
    });
    el.appendChild(del);

    if (node.type === "fn") {
      const info = document.createElement("button");
      info.type = "button";
      info.className = "qm-item";
      info.textContent = "函数信息…";
      info.addEventListener("click", () => {
        this.closeNodeMenu();
        this.openFnInfo(node);
      });
      el.insertBefore(info, del);
      const inline = document.createElement("button");
      inline.type = "button";
      inline.className = "qm-item";
      inline.textContent = "展开为节点";
      inline.title = "把这次调用就地摊开成函数体，方便逐步调试";
      inline.addEventListener("click", () => {
        this.closeNodeMenu();
        this.expandCall(node.id);
      });
      el.insertBefore(inline, del);
    } else {
      const pack = document.createElement("button");
      pack.type = "button";
      pack.className = "qm-item";
      pack.textContent = "打包为函数…";
      pack.title = "把当前选中的节点封装成一个可复用的函数";
      pack.addEventListener("click", () => {
        this.closeNodeMenu();
        this.openPackDialog(node.id);
      });
      el.insertBefore(pack, del);
    }

    el.hidden = false;
    const box = el.getBoundingClientRect();
    let x = rect.left + payload.screen.x;
    let y = rect.top + payload.screen.y;
    if (x + box.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - box.width - 8);
    if (y + box.height > window.innerHeight - 8) y = Math.max(8, y - box.height - 12);
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";

    this._nodeMenuOutside = (e) => {
      if (el.contains(e.target)) return;
      this.closeNodeMenu();
    };
    // 等当前这次 pointerdown 派发完再挂外部点击监听，避免立刻自关。
    window.setTimeout(() => {
      if (this._nodeMenuOutside) document.addEventListener("pointerdown", this._nodeMenuOutside, true);
    }, 0);
  }

  closeNodeMenu() {
    const el = this.dom.nodeMenu;
    if (!el) return;
    el.hidden = true;
    el.innerHTML = "";
    if (this._nodeMenuOutside) {
      document.removeEventListener("pointerdown", this._nodeMenuOutside, true);
      this._nodeMenuOutside = null;
    }
  }

  deleteNode(id) {
    if (!this.graph.has(id)) return;
    this.editor.select([id]);
    this.editor.deleteSelection();
  }

  // ---------- 函数：打包 / 调用 / 展开 ----------

  // 把选中的节点封装成一个函数，并用一个调用节点替代它们。
  openPackDialog(onlyId) {
    const ids =
      onlyId !== undefined && this.editor.selection.has(onlyId)
        ? [...this.editor.selection]
        : onlyId !== undefined
        ? [onlyId]
        : [...this.editor.selection];
    if (ids.length === 0) {
      ui.toast("先框选要打包的节点", "error");
      return;
    }
    const wrap = document.createElement("div");
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = "函数名（1–24 个字符，不能有空白）";
    const input = document.createElement("input");
    input.type = "text";
    input.value = "fn" + Date.now().toString(36).slice(-3);
    field.appendChild(label);
    field.appendChild(input);
    wrap.appendChild(field);

    const cands = resultCandidates(this.graph, ids);
    let pick = null;
    if (cands.length > 1) {
      const row = document.createElement("div");
      row.className = "field";
      row.style.marginTop = "8px";
      const l2 = document.createElement("label");
      l2.textContent = "函数结果（用哪个节点的值当返回值）";
      const sel = document.createElement("select");
      for (const id of cands) {
        const opt = document.createElement("option");
        opt.value = String(id);
        const n = this.graph.get(id);
        opt.textContent = "#" + id + " " + (n ? NODE_TYPES[n.type].name : "");
        sel.appendChild(opt);
      }
      pick = sel;
      row.appendChild(l2);
      row.appendChild(sel);
      wrap.appendChild(row);
    }

    const note = document.createElement("div");
    note.className = "fn-empty";
    note.textContent =
      "输入节点会保留在画布上，作为函数参数的来源；其余被选中的节点会被一个调用节点取代。" +
      "函数存在浏览器本地，所有关卡共用。";
    wrap.appendChild(note);

    const err = document.createElement("div");
    err.className = "fn-empty";
    err.style.color = "var(--err)";
    err.hidden = true;
    wrap.appendChild(err);

    let sheet = null;
    const doPack = () => {
      const res = buildFunctionDef(this.graph, ids, input.value, pick ? Number(pick.value) : null, this.lib);
      if (!res.ok) {
        err.hidden = false;
        err.textContent = res.error;
        return;
      }
      if (sheet) sheet.close();
      this.applyPack(res.def, res.plan);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doPack();
    });
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "10px";
    const ok = document.createElement("button");
    ok.className = "btn";
    ok.textContent = "打包";
    ok.addEventListener("click", doPack);
    row.appendChild(ok);
    wrap.appendChild(row);
    sheet = ui.openSheet({ title: "打包为函数", subtitle: "把一组节点封装成可复用的函数", bodyNode: wrap });
    input.focus();
    input.select();
  }

  applyPack(def, plan) {
    const g = this.graph;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of plan.removed) {
      const n = g.get(id);
      if (!n) continue;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + 150);
      maxY = Math.max(maxY, n.y + 34);
    }
    const cx = Number.isFinite(minX) ? Math.round((minX + maxX) / 2) : 0;
    const cy = Number.isFinite(minY) ? Math.round((minY + maxY) / 2) : 0;
    const call = g.createNode("fn", cx, cy, { fn: def.name, arity: def.params });
    for (let k = 0; k < plan.paramSources.length; k++) {
      const src = plan.paramSources[k];
      if (src !== null && src !== undefined) call.inputs[k] = src;
    }
    // 原来的下游改接到调用节点（调用节点自己的端口不能改，否则会接到自己）
    for (const node of g.nodes.values()) {
      if (node.id === call.id) continue;
      for (let p = 0; p < node.inputs.length; p++) {
        if (node.inputs[p] === plan.result) node.inputs[p] = call.id;
      }
    }
    g.removeMany(plan.removed);
    g.touch();
    this.lib.set(def);
    this._expCache = null;
    this.buildPalette();
    this.editor.invalidate(null);
    this.editor.select([call.id]);
    this.commit("打包函数 " + def.name);
    this.renderStatus();
    this.scheduleValues(true);
    ui.toast("已封装函数 " + def.name + "（展开后 W" + def.weight + "）", "ok");
  }

  expandCall(id) {
    const res = expandCallInPlace(this.graph, id, this.lib);
    if (!res.ok) {
      ui.toast(res.error, "error");
      return;
    }
    this.editor.invalidate(null);
    this.editor.select(res.ids || []);
    this.commit("展开函数调用");
    this.renderStatus();
    this.scheduleValues(true);
  }

  openFnInfo(node) {
    const def = this.lib.get(node.fn);
    const wrap = document.createElement("div");
    const info = document.createElement("div");
    info.className = "prose";
    info.innerHTML = def
      ? "<b>ƒ " + ui.escapeHtml(def.name) + "</b>：参数 " + def.params + " 个，展开后加权 W" + def.weight + "。<br>" +
        "函数库存在浏览器本地，所有关卡共用；调用节点在检查 / 导出时会自动展开成平图。"
      : "函数「" + ui.escapeHtml(node.fn || "?") + "」已经不在函数库里了，这个调用节点无法展开，可以删掉它。";
    wrap.appendChild(info);
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "10px";
    const inlineBtn = document.createElement("button");
    inlineBtn.className = "btn";
    inlineBtn.textContent = "展开为节点";
    inlineBtn.addEventListener("click", () => {
      sheet.close();
      this.expandCall(node.id);
    });
    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "从函数库删除";
    delBtn.addEventListener("click", () => {
      if (!def || !this.lib.delete(node.fn)) return;
      this._expCache = null;
      this.buildPalette();
      sheet.close();
      this.markCheckStale();
      this.scheduleSave();
      ui.toast("已从函数库删除 " + node.fn);
    });
    row.appendChild(inlineBtn);
    row.appendChild(delBtn);
    wrap.appendChild(row);
    const sheet = ui.openSheet({ title: "函数调用", subtitle: node.fn || "", bodyNode: wrap });
  }

  // ---------- 重命名 ----------

  openRename(node) {
    const id = node.id;
    const isOut = node.type === "out";
    const initialName = node.name || "";
    const wrap = document.createElement("div");
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = (isOut ? "输出节点" : "输入节点") + "名称（1–16 个字符，不能重名）";
    const input = document.createElement("input");
    input.type = "text";
    input.value = initialName;
    input.maxLength = 16;
    input.spellcheck = false;
    const msg = document.createElement("div");
    msg.className = "ok";
    msg.textContent = "显示为 #" + initialName;
    field.appendChild(label);
    field.appendChild(input);
    field.appendChild(msg);
    wrap.appendChild(field);

    const sheet = ui.openSheet({
      title: "重命名节点",
      subtitle: "节点上显示为 #名称，名称在所有输入/输出节点之间必须唯一。",
      bodyNode: wrap,
      width: "min(430px, 100%)",
    });
    const rawClose = sheet.close;
    let closed = false;
    sheet.close = () => {
      if (!closed) {
        closed = true;
        const cur = this.graph.get(id);
        if (cur && cur.name !== initialName) this.commit("重命名为 " + cur.name);
      }
      rawClose();
    };

    input.addEventListener("input", () => {
      const cur = this.graph.get(id);
      if (!cur) return;
      const res = this.graph.setName(id, input.value);
      if (res.ok) {
        msg.className = "ok";
        msg.textContent = "显示为 #" + res.name;
        this.renderer.invalidateNode(cur);
        this.renderer.requestDraw();
        this.scheduleValues(true);
        this.scheduleSave();
      } else {
        msg.className = "err";
        msg.textContent = res.reason;
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sheet.close();
      }
    });

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  }

  // ---------- 常数编辑 ----------

  openConstEditor(node) {
    const id = node.id;
    const initial = String(node.value === undefined || node.value === null ? "1" : node.value);
    const wrap = document.createElement("div");
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.textContent = "常数值（|c| ≤ 10^6，支持 1e-3 这类科学计数法）";
    const input = document.createElement("input");
    input.type = "text";
    input.value = initial;
    input.spellcheck = false;
    const msg = document.createElement("div");
    msg.className = "ok";
    msg.textContent = "合法";

    const dm = new DigitMatrix({
      label: "数位矩阵 · 72 位小数",
      intRows: 2,
      onChange: (text) => {
        if (text !== input.value) input.value = text;
        apply(text, false);
      },
    });
    dm.setText(initial, { silent: true });

    const apply = (text, fromText) => {
      const r = this.checkConst(text);
      if (!r.ok) {
        msg.className = "err";
        msg.textContent = r.reason;
        return false;
      }
      msg.className = "ok";
      msg.textContent = "合法";
      this.graph.setValue(id, text);
      if (fromText) dm.setText(text, { silent: true });
      const cur = this.graph.get(id);
      if (cur) this.renderer.invalidateNode(cur);
      this.renderer.requestDraw();
      this.scheduleStatus();
      this.scheduleSave();
      this.markCheckStale();
      this.scheduleValues();
      return true;
    };

    input.addEventListener("input", () => apply(input.value, true));
    field.appendChild(label);
    field.appendChild(input);
    field.appendChild(msg);
    wrap.appendChild(field);
    wrap.appendChild(dm.el);

    const sheet = ui.openSheet({
      title: "编辑常数节点",
      subtitle: "#" + id + " · 直接改文本或用数位矩阵按位编辑",
      bodyNode: wrap,
      width: "min(620px, 100%)",
    });
    const rawClose = sheet.close;
    let closed = false;
    sheet.close = () => {
      if (!closed) {
        closed = true;
        const cur = this.graph.get(id);
        if (cur && String(cur.value) !== initial) this.commit("修改常数为 " + cur.value);
      }
      rawClose();
    };

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  }

  // ---------- 数值面板 ----------
  //
  // 单击任意节点，这里显示它当前的精确数值：
  //   * 输入节点 / 常数节点可编辑（按位改，直接参与求值）；
  //   * 其余节点只读，可以查看计算中间值。

  initValuePanel() {
    const collapsed = this._ioCollapsedSaved === undefined ? false : !!this._ioCollapsedSaved;
    document.body.classList.toggle("val-collapsed", collapsed);
    this.dom.btnVal.classList.toggle("active", !collapsed);
    this.dom.btnVal.addEventListener("click", () => this.toggleValue());
  }

  toggleValue() {
    const collapsed = document.body.classList.toggle("val-collapsed");
    this.dom.btnVal.classList.toggle("active", !collapsed);
    this.onResize();
    this.scheduleSave();
  }

  scheduleValues(force = false) {
    if (force) this._valKey = null;
    window.clearTimeout(this._valTimer);
    this._valTimer = window.setTimeout(
      () => {
        this._valTimer = 0;
        this.refreshValues();
      },
      force ? 0 : 180
    );
  }

  // 求值整张图（先把函数调用展开），拿到每个节点（含中间值）的结果。
  evaluateNow() {
    const eff = this.effective();
    if (!eff.ok) return { ok: false, error: { message: "函数展开失败：" + eff.error } };
    const g = eff.graph;
    if (this.graph.size > LIVE_EVAL_MAX_NODES || g.size > LIVE_EVAL_MAX_NODES) {
      return {
        ok: false,
        error: {
          message:
            "图较大（展开后 " + ui.formatInt(g.size) + " 个节点），已暂停实时求值；点「运行检查」查看结果。",
        },
      };
    }
    const inputs = g.inputNodes().map((n) => (n.inputValue === undefined ? "0" : n.inputValue));
    try {
      const res = evaluateGraph(g, inputs);
      // 调用节点在展开图里没有对应节点，把它的结果值借过来，数值面板照样能看。
      if (res.ok && eff.fnMap && eff.fnMap.size > 0) {
        for (const [callId, srcId] of eff.fnMap) {
          const v = res.values.get(srcId);
          if (v !== undefined) res.values.set(callId, v);
        }
      }
      return res;
    } catch (err) {
      return { ok: false, error: { message: String((err && err.message) || err) } };
    }
  }

  refreshValues() {
    const res = this.evaluateNow();
    this._values = res.ok ? res.values : null;
    this._valError = res.ok ? null : (res.error && res.error.message) || "当前图无法求值";
    this.renderer.setNodeValues(this._values);
    this.renderSelection();
  }

  selectedNode() {
    if (this.editor.selection.size !== 1) return null;
    const id = this.editor.selection.values().next().value;
    return this.graph.get(id) || null;
  }

  _hint(text) {
    const p = document.createElement("div");
    p.className = "val-empty";
    p.textContent = text;
    return p;
  }

  renderSelection() {
    const body = this.dom.valBody;
    if (!body) return;
    const count = this.editor.selection.size;
    const node = this.selectedNode();
    if (!node) {
      this._valKey = null;
      this._valDm = null;
      if (this.dom.valKind) this.dom.valKind.textContent = "";
      body.innerHTML = "";
      body.appendChild(
        this._hint(
          count > 1
            ? "已选中 " + count + " 个节点。单击单个节点查看数值，或点工具箱里的「＋ 打包选中」把它们封装成函数。"
            : "单击画布上的任意节点，这里会显示它当前的精确数值：输入 / 常数节点可直接修改，其余节点只读（可查看中间值）。"
        )
      );
      return;
    }

    const t = NODE_TYPES[node.type];
    const editable = node.type === "I" || node.type === "C";
    const isOut = node.type === "out";
    const ports = isOut ? Math.max(1, node.inputs.length) : 1;
    const port = Math.min(Math.max(0, this._valPort), ports - 1);
    this._valPort = port;
    const key = node.id + ":" + port + ":" + (editable ? "e" : "r");
    if (this.dom.valKind) this.dom.valKind.textContent = editable ? "可编辑" : "只读";

    if (key !== this._valKey) {
      this._valKey = key;
      body.innerHTML = "";

      const head = document.createElement("div");
      head.className = "val-node";
      const name =
        node.type === "I" || isOut ? "#" + (node.name || "?") : node.type === "fn" ? "ƒ " + (node.fn || "?") : t.name;
      head.innerHTML =
        ui.glyphBox(node.type) +
        "<b>" +
        ui.escapeHtml(name) +
        "</b><span class='spacer'></span><span class='mono'>#" +
        node.id +
        "</span>";
      body.appendChild(head);

      if (isOut) {
        const row = document.createElement("div");
        row.className = "val-ports";
        for (let i = 0; i < ports; i++) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "val-port" + (i === port ? " active" : "");
          btn.textContent = String(i + 1);
          btn.title = "查看第 " + (i + 1) + " 个输出端的值";
          btn.addEventListener("click", () => {
            this._valPort = i;
            this._valKey = null;
            this.renderSelection();
          });
          row.appendChild(btn);
        }
        const arity = document.createElement("label");
        arity.className = "val-arity";
        arity.textContent = "端口数";
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "1";
        inp.max = "16";
        inp.value = String(node.inputs.length);
        inp.addEventListener("change", () => {
          this.graph.setArity(node.id, Number(inp.value));
          this.editor.invalidate(null);
          this.commit("调整输出项数");
          this.renderStatus();
          this._valKey = null;
          this.scheduleValues(true);
        });
        arity.appendChild(inp);
        row.appendChild(arity);
        body.appendChild(row);
      }

      const dm = new DigitMatrix({
        readonly: !editable,
        minIntRows: 2,
        intRows: 2,
        label: "",
        onChange: editable ? (text) => this.applyValueEdit(node.id, text) : null,
      });
      this._valDm = dm;
      body.appendChild(dm.el);

      const note = document.createElement("div");
      note.className = "val-note";
      body.appendChild(note);
    }

    this._updateValMatrix(node, port, editable);
  }

  _updateValMatrix(node, port, editable) {
    const dm = this._valDm;
    if (!dm) return;
    if (editable && dm.hasFocus()) return; // 正在输入时不要回写打断光标

    let text = null;
    let real = null;
    if (node.type === "I") text = String(node.inputValue === undefined ? "0" : node.inputValue);
    else if (node.type === "C") text = String(node.value === undefined ? "0" : node.value);
    else if (this._values) {
      if (node.type === "out") {
        const src = node.inputs[port];
        real = src === undefined || src === null ? null : this._values.get(src) || null;
      } else {
        real = this._values.get(node.id) || null;
      }
    }
    if (text !== null) dm.setText(text, { silent: true });
    else if (real) dm.setFromReal(real, { silent: true });
    else dm.setText("0", { silent: true });

    const note = this.dom.valBody.querySelector(".val-note");
    if (!note) return;
    note.classList.toggle("err", !editable && !!this._valError);
    if (!editable && this._valError) note.textContent = "⚠ " + this._valError;
    else if (editable)
      note.textContent =
        node.type === "I" ? "输入值：按位编辑，改动会立刻参与求值。" : "常数值：按位编辑，|c| ≤ 10^6。";
    else if (node.type === "fn")
      note.textContent = "函数「" + (node.fn || "?") + "」的输出（只读）——展开后的计算结果。";
    else
      note.textContent =
        node.type === "out"
          ? "输出值（只读）——该输出端的最终结果。"
          : "中间值（只读）——该节点在当前输入下的计算结果。";
  }

  // 面板里的编辑：只有输入节点与常数节点会走到这里。
  applyValueEdit(id, text) {
    const node = this.graph.get(id);
    if (!node) return;
    if (node.type === "I") {
      this.graph.setInputValue(id, text);
    } else if (node.type === "C") {
      const r = this.checkConst(text);
      if (!r.ok) {
        ui.toast(r.reason, "error");
        this.scheduleValues();
        return;
      }
      this.graph.setValue(id, r.text || text);
      this.renderer.invalidateNode(node);
    } else {
      return;
    }
    this.markCheckStale();
    this.scheduleSave();
    this.scheduleValues();
    this.renderer.requestDraw();
  }

  // ---------- 检查 ----------
  //
  // 结果放在不遮挡画布的悬浮面板里：结构有问题就直接列结构问题；
  // 结构没问题但数值对不上，就用只读数位矩阵把出错那一组的「期望 / 实得」摆出来。

  checkPanel() {
    if (this._chkPanel) return this._chkPanel;
    const vw = window.innerWidth || 1200;
    const left = this._probPanel ? Math.max(12, vw - 560 - 24 - 240) : undefined;
    this._chkPanel = ui.openFloatPanel({
      title: "运行检查",
      width: 560,
      top: 64,
      left,
      onClose: () => {
        this._chkPanel = null;
      },
    });
    return this._chkPanel;
  }

  _checkNote(text, kind) {
    const p = document.createElement("p");
    p.className = "chk-lead" + (kind ? " " + kind : "");
    p.textContent = text;
    return p;
  }

  _checkLine(label, value, kind) {
    const d = document.createElement("div");
    d.className = "chk-kv";
    const s = document.createElement("span");
    s.textContent = label;
    const b = document.createElement("b");
    b.className = kind || "";
    b.textContent = value;
    d.appendChild(s);
    d.appendChild(b);
    return d;
  }

  _checkBox(node) {
    const box = document.createElement("div");
    box.className = "chk";
    if (node) box.appendChild(node);
    return box;
  }

  _fillCheck(panel, node) {
    panel.body.innerHTML = "";
    panel.body.appendChild(this._checkBox(node));
  }

  // 用一个只读数位矩阵展示某个数值（期望 / 实得）。
  _checkValue(label, text, bad) {
    const wrap = document.createElement("div");
    wrap.className = "chk-val" + (bad ? " bad" : "");
    const lab = document.createElement("div");
    lab.className = "chk-val-label";
    lab.textContent = label;
    const dm = new DigitMatrix({ readonly: true, minIntRows: 2, intRows: 2, label: "" });
    dm.setText(text === undefined || text === null ? "0" : String(text), { silent: true });
    wrap.appendChild(lab);
    wrap.appendChild(dm.el);
    return wrap;
  }

  renderMismatch(panel, grade) {
    panel.setTitle("数值不一致");
    const box = this._checkBox();
    if (grade.error) {
      box.appendChild(this._checkNote("第 " + (grade.failedAt + 1) + " 组求值中断：" + grade.error.message, "err"));
      this._fillCheck(panel, box);
      return;
    }
    const bad = grade.details.filter((d) => !d.ok);
    const first = bad[0];
    box.appendChild(this._checkNote("通过 " + grade.passed + " / " + grade.total + " 组，最早对不上的那一组：", "err"));

    const caseLine = document.createElement("div");
    caseLine.className = "chk-case";
    caseLine.textContent = "输入 " + first.inputs.join("  ");
    box.appendChild(caseLine);

    const miss = first.outputs.map((o, idx) => ({ o, idx })).filter((x) => !x.o.ok);
    for (const { o, idx } of miss.slice(0, 3)) {
      const t = document.createElement("div");
      t.className = "chk-out";
      t.textContent = "输出 " + (idx + 1);
      box.appendChild(t);
      box.appendChild(this._checkValue("期望", o.want, false));
      if (o.got === null || o.got === undefined) box.appendChild(this._checkNote("实得：没有算出结果"));
      else box.appendChild(this._checkValue("实得", o.got, true));
    }
    if (miss.length > 3) box.appendChild(this._checkNote("另有 " + (miss.length - 3) + " 个输出不一致。"));
    if (bad.length > 1) box.appendChild(this._checkNote("另有 " + (bad.length - 1) + " 组也不一致。"));
    this._fillCheck(panel, box);
  }

  async runCheck() {
    if (this._checking) return;
    this._checking = true;
    const panel = this.checkPanel();
    panel.raise();
    const chip = this.dom.statCheck;
    try {
      const level = this.level;
      const eff = this.effective();
      const res = analyze(this.graph, level, { expanded: eff.ok ? eff.graph : null });
      if (!eff.ok) res.errors.unshift({ code: "fn", message: "函数展开失败：" + eff.error });
      this.lastCheck = res;

      // 1) 结构有问题：直接说明问题。
      if (res.errors.length) {
        chip.className = "chip err";
        chip.textContent = res.errors.length + " 个结构问题";
        panel.setTitle("检查未通过 · 结构问题");
        const box = this._checkBox();
        const ul = document.createElement("ul");
        ul.className = "chk-errs";
        for (const e of res.errors) {
          const li = document.createElement("li");
          li.textContent = e.message;
          ul.appendChild(li);
        }
        box.appendChild(ul);
        this._fillCheck(panel, box);
        return;
      }

      const isTask = !!(level && level.key && level.key !== "sandbox");
      if (!isTask) {
        chip.className = "chip ok";
        chip.textContent = "结构通过 · W" + ui.formatInt(res.cost);
        panel.setTitle("结构通过");
        this._fillCheck(panel, this._checkNote("结构没问题；沙盒不做数值评测。加权节点数 W = " + ui.formatInt(res.cost) + "。", "ok"));
        return;
      }

      // 2) 结构通过，做数值评测。
      chip.className = "chip";
      chip.textContent = "评测中…";
      panel.setTitle("评测中…");
      const wait = this._checkNote("正在用官方测试输入逐组求值（72 位定点）…");
      this._fillCheck(panel, wait);

      let grade = null;
      try {
        const vectors = await loadVectors();
        const pack = vectors[level.key];
        if (!pack) throw new Error("缺少 " + level.key + " 的参考数据，请先运行 tools/gen_vectors.mjs");
        grade = await gradeAgainstVectorsAsync(eff.ok ? eff.graph : this.graph, pack, (done, total) => {
          wait.textContent = "正在求值 " + done + " / " + total + " 组…";
        });
      } catch (err) {
        chip.className = "chip err";
        chip.textContent = "评测失败";
        panel.setTitle("评测失败");
        this._fillCheck(panel, this._checkNote(err.message, "err"));
        return;
      }

      if (grade.ok && res.factor > 0) {
        const rec = this.recordClear(level, res.cost);
        chip.className = "chip ok";
        chip.textContent = "通关 · W" + ui.formatInt(res.cost) + " · " + grade.passed + "/" + grade.total;
        panel.setTitle("通关 · " + this.starsText(rec.stars));
        const box = this._checkBox(this._checkNote("数值全部通过（" + grade.passed + " / " + grade.total + " 组）。", "ok"));
        const rem = level.base - res.cost;
        box.appendChild(this._checkLine("加权节点数 W", ui.formatInt(res.cost)));
        box.appendChild(this._checkLine("剩余权重", ui.formatInt(rem), rem < 0 ? "err" : "ok"));
        this._fillCheck(panel, box);
        this.renderStatus();
        this.updateBrand();
        return;
      }

      if (grade.ok) {
        chip.className = "chip err";
        chip.textContent = "W 超预算";
        panel.setTitle("W 超预算");
        this._fillCheck(
          panel,
          this._checkNote("数值全部正确，但 W = " + ui.formatInt(res.cost) + " 已达到 2B（" + ui.formatInt(2 * level.base) + "），不能通关。", "err")
        );
        return;
      }

      chip.className = "chip err";
      chip.textContent = grade.error ? "求值中断" : "数值不一致 · " + grade.passed + "/" + grade.total;
      this.renderMismatch(panel, grade);
    } finally {
      this._checking = false;
    }
  }

  // ---------- 导入 / 导出 ----------

  showExport() {
    let text = "";
    try {
      const eff = this.effective();
      if (!eff.ok) throw new GraphFormatError("fn", "函数展开失败：" + eff.error);
      text = toProblemText(eff.graph);
    } catch (err) {
      const msg = err instanceof GraphFormatError ? err.message : "导出失败：" + err.message;
      ui.toast(msg, "error");
      ui.openSheet({ title: "无法导出", bodyHtml: "<div class='prose'>" + ui.escapeHtml(msg) + "</div>" });
      return;
    }
    const wrap = document.createElement("div");
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.rows = 14;
    ta.style.width = "100%";
    ta.style.background = "var(--panel-2)";
    ta.style.color = "var(--fg)";
    ta.style.border = "1px solid var(--line-2)";
    ta.style.borderRadius = "8px";
    ta.style.padding = "8px";
    ta.style.fontFamily = "ui-monospace, Consolas, monospace";
    ta.style.fontSize = "12px";
    ta.spellcheck = false;
    wrap.appendChild(ta);
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "10px";
    const copy = document.createElement("button");
    copy.className = "btn";
    copy.textContent = "复制";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        ui.toast("已复制到剪贴板", "ok");
      } catch (err) {
        ta.select();
        ui.toast("请手动复制", "error");
      }
    });
    const dl = document.createElement("button");
    dl.className = "btn";
    dl.textContent = "下载 .graph";
    dl.addEventListener("click", () => {
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = this.level.key + ".graph";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    row.appendChild(copy);
    row.appendChild(dl);
    wrap.appendChild(row);
    ui.openSheet({
      title: "导出标准 DAG 文本",
      subtitle: "已按拓扑序重新编号，可直接作为 checker 的选手输出",
      bodyNode: wrap,
    });
  }

  showImport() {
    const wrap = document.createElement("div");
    const ta = document.createElement("textarea");
    ta.rows = 12;
    ta.placeholder = "第一行 N，随后 N 行指令，最后一行 OUT k id...";
    ta.style.width = "100%";
    ta.style.background = "var(--panel-2)";
    ta.style.color = "var(--fg)";
    ta.style.border = "1px solid var(--line-2)";
    ta.style.borderRadius = "8px";
    ta.style.padding = "8px";
    ta.style.fontFamily = "ui-monospace, Consolas, monospace";
    ta.style.fontSize = "12px";
    ta.spellcheck = false;
    wrap.appendChild(ta);
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "10px";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "导入并替换画布";
    const file = document.createElement("button");
    file.className = "btn";
    file.textContent = "选择文件…";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".graph,.txt,text/plain";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        ta.value = String(reader.result || "");
      };
      reader.readAsText(f);
    });
    file.addEventListener("click", () => input.click());
    row.appendChild(btn);
    row.appendChild(file);
    wrap.appendChild(row);
    wrap.appendChild(input);
    const sheet = ui.openSheet({ title: "导入标准 DAG 文本", subtitle: "会替换当前画布，可用撤销恢复", bodyNode: wrap });
    btn.addEventListener("click", () => {
      try {
        const r = fromProblemText(ta.value);
        this.replaceGraph(r.graph, "导入 " + r.graph.size + " 个节点");
        sheet.close();
        this.editor.fit();
        this.onResize();
        if (r.warnings.length) ui.toast(r.warnings[0], "error");
        else ui.toast("导入成功", "ok");
      } catch (err) {
        const msg = err instanceof GraphFormatError ? err.message : "解析失败：" + err.message;
        ui.toast(msg, "error");
      }
    });
  }

  replaceGraph(g, label) {
    this.graph = g;
    this.editor.setGraph(g);
    this.renderer.setGraph(g);
    this.renderer.invalidateAll();
    this.history.reset(JSON.stringify(g.toJSON()), label);
    this.lastCheck = null;
    this.markCheckStale();
    this.renderStatus();
    this.scheduleValues(true);
    this.updateUndoButtons();
    this.updateHud();
    this.saveNow();
    this.renderer.requestDraw();
  }

  clearCanvas() {
    if (this.graph.size === 0) return;
    ui.confirmDialog("清空画布", "将删除当前画布上的全部节点，可以用撤销恢复。", "清空").then((ok) => {
      if (!ok) return;
      this.replaceGraph(new Graph(), "清空画布");
      ui.toast("已清空", "ok");
    });
  }

  // ---------- 关卡 ----------

  // ---------- 关卡与闯关进度 ----------

  // 星级 / 解锁 / 总分等规则都在 core/progress.js，这里只做转发。
  starsFor(level, cost) {
    return progress.starsFor(level && level.base, cost);
  }

  starsText(n) {
    return progress.starsText(n);
  }

  progressOf(key) {
    return this.progress[key] || null;
  }

  totalStars() {
    return progress.totalStars(TASKS, this.progress);
  }

  // 通关后记录成绩：保留历史最好星级 / 得分 / 最小 W。
  recordClear(level, cost) {
    const entry = progress.mergeResult(this.progress[level.key], progress.clearEntry(level, cost));
    this.progress[level.key] = entry;
    this.saveNow();
    this.updateBrand();
    return entry;
  }



  setLevel(key) {
    if (key === this.level.key) return;
    this.saveNow(); // 先把当前关卡存好
    this.level = getLevel(key);
    this.editor.setLevel(this.level);
    const saved = this.savedGraphs[key];
    const g = saved ? Graph.fromJSON(saved) : key === "sandbox" ? this.makeStarter() : new Graph();
    this.graph = g;
    this.editor.setGraph(g);
    this.renderer.setGraph(g);
    this.renderer.invalidateAll();
    this.history.reset(JSON.stringify(g.toJSON()), "切换到 " + this.level.name);
    this.lastCheck = null;
    this.markCheckStale();
    this.editor.fit();
    this.renderStatus();
    this.scheduleValues(true);
    this.updateBrand();
    this.updateUndoButtons();
    this.updateHud();
    this.saveNow();
    this.renderer.requestDraw();
  }

  showLevels(first = false) {
    let cards = "";
    for (const l of LEVELS) {
      const active = l.key === this.level.key;
      const p = this.progressOf(l.key);
      const bits = [];
      if (l.inputs !== null) bits.push("输入 " + l.inputs);
      if (l.outputs !== null) bits.push("输出 " + l.outputs);
      if (l.base) bits.push("B = " + ui.formatInt(l.base));
      if (p) bits.push("最佳 W = " + ui.formatInt(p.bestW));
      const badge = l.base ? this.starsText(p ? p.stars : 0) : "自由";
      cards +=
        "<button class='lv-card" + (active ? " active" : "") + "' data-key='" + l.key + "'>" +
        "<span class='lv-top'><b>" + ui.escapeHtml(l.name) + "</b><span class='pts'>" + badge + "</span></span>" +
        "<span class='lv-meta'>" + bits.join(" · ") + "</span>" +
        "</button>";
    }
    const html =
      "<div class='prose' style='margin-bottom:10px'>所有关卡均已解锁。星级只看加权节点数 W：" +
      "<b>W ≤ B 三星</b>，≤ 1.5B 两星，&lt; 2B 一星。当前 <b>" +
      this.totalStars() + " / " + TASKS.length * 3 + "</b> 星。</div>" +
      "<div class='lv-grid'>" + cards + "</div>";
    const sheet = ui.openSheet({
      title: "选择关卡",
      subtitle: "每关的画布独立保存",
      bodyHtml: html,
      dismissible: true,
    });
    sheet.body.addEventListener("click", (e) => {
      const card = e.target.closest(".lv-card");
      if (!card) return;
      this.setLevel(card.getAttribute("data-key"));
      sheet.close();
      if (first) ui.toast("从任务 1 开始试试吧", "ok");
      else ui.toast("已切换到 " + this.level.name);
    });
  }

  // 右上角「题面」：只显示当前关卡的题目与限制，不遮挡画布的悬浮窗，用 KaTeX 渲染 LaTeX。
  openProblem() {
    if (this._probPanel) {
      this._probPanel.raise();
      return;
    }
    const level = this.level;
    const isTask = level.key !== "sandbox";
    const panel = ui.openFloatPanel({
      title: isTask ? "题面 · 任务 " + level.id + " " + level.name : "题面 · 沙盒",
      subtitle: PROBLEM_TITLE,
      width: 560,
      top: 64,
      onClose: () => {
        this._probPanel = null;
      },
    });
    this._probPanel = panel;
    const meta = [];
    if (level.inputs !== null) meta.push("输入 " + level.inputs + " 项：" + level.inputDesc.join("；"));
    if (level.outputs !== null) meta.push("输出 " + level.outputs + " 项：" + level.outputDesc);
    if (level.base) meta.push("基准 B = " + ui.formatInt(level.base) + "　星级：W ≤ B 三星，≤ 1.5B 两星，< 2B 一星");
    panel.body.innerHTML =
      "<div class='prob'>" +
      (meta.length ? "<div class='prob-meta'>" + meta.map(ui.escapeHtml).join("<br>") + "</div>" : "") +
      "<h3>" + (isTask ? "题目" : "说明") + "</h3>" +
      problemForLevel(level.key) +
      "</div>";
    ui.renderMath(panel.body);
  }
  showHelp() {
    let types = "";
    for (const k of TYPE_ORDER) {
      const t = NODE_TYPES[k];
      types +=
        "<div class='kv'><span>" + ui.escapeHtml(t.name) + " <code>" + ui.escapeHtml(t.op) + "</code></span><b>W" + t.weight + " · " + t.arity + " 入</b></div>";
    }
    const html =
      "<div class='prose'><b>操作</b><ul>" +
      "<li>从左侧<b>工具箱</b>把节点拖进画布创建；双击空白处也可快速新建。</li>" +
      "<li>从<b>输出端</b>拖到<b>输入端</b>连线；把已连线的<b>输入端</b>拖走可断开重接。</li>" +
      "<li>拖到空白处松开会弹出菜单，可直接新建节点并自动接线（类似 nandgame）。</li>" +
      "<li>空白处拖动 = 框选；中键 / 右键 / 按住空格拖动 = 平移画布；滚轮 = 平移，Ctrl+滚轮 = 缩放。</li>" +
      "<li><b>单击任意节点</b>，右侧「数值」面板会显示它的精确数值；输入节点与常数节点可直接编辑，其余节点只能查看中间值。</li>" +
      "<li>右上角「<b>题面</b>」按钮会打开可拖动的悬浮窗，显示当前关卡的输入输出与题目（LaTeX 用本地 KaTeX 渲染）；所有关卡共用的机器规格与限制就在本页下方。右上角还实时显示<b>剩余权重</b>（B − W，负数变红）。</li>" +
      "<li>快捷键：<code>V</code> 指针、<code>H</code> 平移、<code>F</code> 适应内容、<code>G</code> 网格吸附、<code>Delete</code> 删除、<code>Ctrl+Z/Y</code> 撤销重做、<code>Ctrl+C/V/D</code> 复制粘贴、<code>Ctrl+S</code> 保存。</li>" +
      "</ul></div>" +
      "<div class='prose'><b>节点与权重</b>" + types + "<div style='margin-top:6px;color:var(--fg-mute)'>输出节点 OUT 不计权重与引用上限。</div></div>" +
      "<div class='prose'><b>函数（打包复用）</b><p>框选一组节点，点工具箱里的「＋ 打包选中」就能把它封装成函数：选中的输入节点留作参数来源，其余节点被一个调用节点取代。" +
        "函数会出现在工具箱下方的「函数」栏，拖出来即可复用。</p>" +
        "<p>调用节点在检查 / 导出时会先<b>宏展开</b>成平图，所以 W 按展开后的节点数计，评分口径不变；节点右侧小三角里，「打包为函数…」对选区打包，调用节点上还有「函数信息…」与「展开为节点」（就地摊开，方便调试）。函数库存在浏览器本地，所有关卡共用。</p></div>" +
        "<div class='prose'><b>关于评分</b><p>本题唯一的硬约束是加权节点数 W 与结构合法性，没有运行时间限制；数值评测用 72 位定点对照官方参考值。通关要求数值全部通过且 W &lt; 2B，按 W 给 1–3 星。导出会把图按拓扑序重新编号为题面要求的标准文本。</p></div>" +
      "<div class='prose'><b>机器规格与限制</b>" + PROBLEM_LIMITS + "</div>";
    const sheet = ui.openSheet({ title: "帮助", subtitle: "旷野大计算 pro · 可视化编辑器", bodyHtml: html });
    ui.renderMath(sheet.body);
  }
}
