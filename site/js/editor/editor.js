// 交互控制器：把指针/触摸/键盘事件翻译成图操作。
// 设计要点：
//  - 命中测试在屏幕空间做（端口半径以 CSS 像素计），移动端手指才好点。
//  - 拖动期间只更新受影响节点的索引项，不重建空间索引。
//  - 触摸：单指点空白 = 平移，双指 = 缩放 + 平移；鼠标：空白拖动 = 框选，中键/右键/空格 = 平移。
import { NODE_TYPES } from "../core/types.js";
import {
  menuButtonRect,
  SNAP,
  distanceToPolyline,
  nodeHeight,
  nodeWidth,
  portPosition,
  sampleCubic,
  wirePath,
} from "../core/geometry.js";

const MIN_SCALE = 0.01;
const MAX_SCALE = 6;
const MOUSE_PORT_R = 13;
const TOUCH_PORT_R = 24;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Editor {
  constructor(opts) {
    this.graph = opts.graph;
    this.fnDef = opts.fnDef || (() => null);
    this.renderer = opts.renderer;
    this.canvas = opts.canvas;
    this.level = opts.level || null;
    this.commit = opts.commit || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.onViewChange = opts.onViewChange || (() => {});
    this.onToast = opts.onToast || (() => {});
    this.onSelectionChange = opts.onSelectionChange || (() => {});
    this.onQuickMenu = opts.onQuickMenu || (() => {});
    this.onEditNode = opts.onEditNode || (() => {});
    this.onNodeMenu = opts.onNodeMenu || (() => {});
    this.onCursor = opts.onCursor || (() => {});

    this.tool = "select";
    this.snap = false;
    this.spaceDown = false;
    this.selection = new Set();
    this.selectedWires = new Set();
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.clipboard = null;
    this.quick = null;
    this._rect = null;
    this._handlers = [];
  }

  // ---------- 生命周期 ----------

  attach() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push([target, type, fn, opts]);
    };
    on(this.canvas, "pointerdown", (e) => this.onPointerDown(e));
    on(this.canvas, "pointermove", (e) => this.onPointerMove(e));
    on(this.canvas, "pointerup", (e) => this.onPointerUp(e));
    on(this.canvas, "pointercancel", (e) => this.onPointerCancel(e));
    on(this.canvas, "wheel", (e) => this.onWheel(e), { passive: false });
    on(this.canvas, "dblclick", (e) => this.onDoubleClick(e));
    on(this.canvas, "contextmenu", (e) => e.preventDefault());
    // 双指手势必须用原生 touch 事件 preventDefault：pointer 事件的 preventDefault
    // 拦不住浏览器的滚动/缩放（那由 touch-action 决定）。多指时一律拦下。
    const blockMultiTouch = (e) => {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    };
    on(this.canvas, "touchstart", blockMultiTouch, { passive: false });
    on(this.canvas, "touchmove", blockMultiTouch, { passive: false });
    on(document, "touchmove", blockMultiTouch, { passive: false });
    on(document, "gesturestart", (e) => e.preventDefault(), { passive: false });
    on(document, "gesturechange", (e) => e.preventDefault(), { passive: false });
    on(document, "gestureend", (e) => e.preventDefault(), { passive: false });
    on(this.canvas, "gesturestart", (e) => e.preventDefault(), { passive: false });
    on(window, "keydown", (e) => this.onKeyDown(e));
    on(window, "keyup", (e) => this.onKeyUp(e));
    on(window, "blur", () => {
      this.spaceDown = false;
      this.drag = null;
      this.pinch = null;
      this.pointers.clear();
      this.setPending(null);
    });
    return this;
  }

  destroy() {
    for (const [target, type, fn, opts] of this._handlers) target.removeEventListener(type, fn, opts);
    this._handlers = [];
  }

  setLevel(level) {
    this.level = level;
  }

  refreshRect() {
    this._rect = this.canvas.getBoundingClientRect();
  }

  setGraph(graph) {
    this.graph = graph;
    this.selection.clear();
    this.selectedWires.clear();
    this.pointers.clear();
    this.drag = null;
    this.pinch = null;
    this.setPending(null);
    this.syncSelection();
  }

  // ---------- 基础换算 ----------

  screenPoint(e) {
    if (!this._rect) this._rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - this._rect.left, y: e.clientY - this._rect.top };
  }

  toWorld(sp) {
    return this.renderer.screenToWorld(sp.x, sp.y);
  }

  portHitRadius(pointerType) {
    return pointerType === "touch" ? TOUCH_PORT_R : MOUSE_PORT_R;
  }

  // ---------- 渲染同步 ----------

  syncSelection() {
    this.renderer.selection = this.selection;
    this.renderer.selectedWires = this.selectedWires;
    this.renderer.requestDraw();
    this.onSelectionChange();
  }

  setPending(p) {
    this.pending = p;
    this.renderer.pending = p;
    this.renderer.requestDraw();
  }

  invalidate(node) {
    if (node) this.renderer.invalidateNode(node);
    else this.renderer.invalidateAll();
    this.renderer.requestDraw();
  }

  // ---------- 视口 ----------

  // 屏幕坐标向右下为正；view.x/y 变大意味着内容左移，所以要减去位移。
  panBy(dxPx, dyPx) {
    const v = this.renderer.view;
    v.x -= dxPx / v.scale;
    v.y -= dyPx / v.scale;
    this.onViewChange();
  }

  zoomAt(sx, sy, factor) {
    const r = this.renderer;
    const v = r.view;
    const before = r.screenToWorld(sx, sy);
    const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
    if (scale === v.scale) return;
    v.scale = scale;
    v.x = before.x - sx / scale;
    v.y = before.y - sy / scale;
    this.onViewChange();
  }

  setZoom(scale) {
    const r = this.renderer;
    this.zoomAt(r.cssW / 2, r.cssH / 2, scale / r.view.scale);
  }

  centerOn(wx, wy) {
    const r = this.renderer;
    r.view.x = wx - r.cssW / 2 / r.view.scale;
    r.view.y = wy - r.cssH / 2 / r.view.scale;
    this.onViewChange();
  }

  fit(margin = 64) {
    const r = this.renderer;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let count = 0;
    for (const node of this.graph.nodes.values()) {
      const w = nodeWidth(node), h = nodeHeight(node);
      if (node.x < x0) x0 = node.x;
      if (node.y < y0) y0 = node.y;
      if (node.x + w > x1) x1 = node.x + w;
      if (node.y + h > y1) y1 = node.y + h;
      count++;
    }
    if (count === 0) {
      r.view.x = 0;
      r.view.y = 0;
      r.view.scale = 1;
      this.onViewChange();
      return;
    }
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const scale = clamp(Math.min((r.cssW - margin * 2) / w, (r.cssH - margin * 2) / h), MIN_SCALE, 2);
    r.view.scale = scale;
    r.view.x = x0 + w / 2 - r.cssW / 2 / scale;
    r.view.y = y0 + h / 2 - r.cssH / 2 / scale;
    this.onViewChange();
  }

  // ---------- 命中测试 ----------

  nearNodes(wp, radiusWorld) {
    return this.renderer.grid.query(wp.x - radiusWorld, wp.y - radiusWorld, radiusWorld * 2, radiusWorld * 2, []);
  }

  hitPortAt(sp, pointerType = "mouse") {
    const wp = this.toWorld(sp);
    const r = this.portHitRadius(pointerType);
    const radiusWorld = (r + 12) / this.renderer.view.scale;
    const ids = this.nearNodes(wp, radiusWorld);
    let best = null;
    let bestD = r;
    for (const id of ids) {
      const node = this.graph.get(id);
      if (!node) continue;
      if (NODE_TYPES[node.type].hasOutput) {
        const p = this.renderer.worldToScreen(portPosition(node, "out", 0).x, portPosition(node, "out", 0).y);
        const d = Math.hypot(p.x - sp.x, p.y - sp.y);
        if (d <= bestD) {
          bestD = d;
          best = { node, side: "out", index: 0 };
        }
      }
      for (let i = 0; i < node.inputs.length; i++) {
        const pp = portPosition(node, "in", i);
        const p = this.renderer.worldToScreen(pp.x, pp.y);
        const d = Math.hypot(p.x - sp.x, p.y - sp.y);
        if (d <= bestD) {
          bestD = d;
          best = { node, side: "in", index: i };
        }
      }
    }
    return best;
  }

  // 节点右侧的小菜单按钮
  hitMenuAt(sp) {
    const wp = this.toWorld(sp);
    const ids = this.nearNodes(wp, 4 / this.renderer.view.scale);
    for (const id of ids) {
      const node = this.graph.get(id);
      if (!node) continue;
      const r = menuButtonRect(node);
      if (wp.x >= r.x && wp.x <= r.x + r.w && wp.y >= r.y && wp.y <= r.y + r.h) return node;
    }
    return null;
  }

  hitNodeAt(sp) {
    const wp = this.toWorld(sp);
    const ids = this.nearNodes(wp, 4 / this.renderer.view.scale);
    let best = null;
    for (const id of ids) {
      const node = this.graph.get(id);
      if (!node) continue;
      const w = nodeWidth(node), h = nodeHeight(node);
      if (wp.x >= node.x && wp.x <= node.x + w && wp.y >= node.y && wp.y <= node.y + h) {
        if (!best || id > best.id) best = node;
      }
    }
    return best;
  }

  hitWireAt(sp) {
    const wp = this.toWorld(sp);
    const radius = 26 / this.renderer.view.scale;
    const ids = this.nearNodes(wp, radius);
    let best = null;
    let bestD = 7;
    const buf = [];
    for (const id of ids) {
      const node = this.graph.get(id);
      if (!node) continue;
      for (let i = 0; i < node.inputs.length; i++) {
        const s = node.inputs[i];
        if (s === null) continue;
        const src = this.graph.get(s);
        if (!src) continue;
        const path = wirePath(portPosition(src, "out", 0), portPosition(node, "in", i));
        const pts = sampleCubic(path, 22, buf);
        const scr = [];
        for (const p of pts) scr.push(this.renderer.worldToScreen(p.x, p.y));
        const d = distanceToPolyline(sp.x, sp.y, scr);
        if (d < bestD) {
          bestD = d;
          best = { to: id, port: i, from: s };
        }
      }
    }
    return best;
  }

  // ---------- 选择 ----------

  select(ids, mode = "replace") {
    if (mode === "replace") this.selection.clear();
    for (const id of ids) {
      if (mode === "toggle" && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.selectedWires.clear();
    this.syncSelection();
  }

  selectAll() {
    this.selection = new Set(this.graph.nodes.keys());
    this.selectedWires.clear();
    this.syncSelection();
  }

  clearSelection() {
    if (this.selection.size === 0 && this.selectedWires.size === 0) return;
    this.selection.clear();
    this.selectedWires.clear();
    this.syncSelection();
  }

  selectedWiresList() {
    return Array.from(this.selectedWires).map((k) => {
      const parts = k.split(":");
      return { to: Number(parts[0]), port: Number(parts[1]) };
    });
  }

  // ---------- 变更 ----------

  addNodeAt(typeKey, wp, opts = {}) {
    const t = NODE_TYPES[typeKey];
    if (!t) return null;
    let x = wp.x;
    let y = wp.y;
    if (opts.center) {
      const probe = { id: 0, type: typeKey, x: 0, y: 0, inputs: new Array(opts.arity || t.arity).fill(null) };
      x = wp.x - nodeWidth(probe) / 2;
      y = wp.y - nodeHeight(probe) / 2;
    }
    const node = this.graph.createNode(typeKey, x, y, opts);
    this.invalidate(node);
    if (opts.snap !== false && this.snap) {
      const n = node;
      n.x = Math.round(n.x / SNAP) * SNAP;
      n.y = Math.round(n.y / SNAP) * SNAP;
    }
    if (!opts.silent) {
      this.select([node.id]);
      this.commit("新建" + t.name);
      this.onChange();
    } else {
      this.renderer.invalidateNode(node);
    }
    return node;
  }

  deleteSelection() {
    const ids = Array.from(this.selection);
    let wires = 0;
    for (const { to, port } of this.selectedWiresList()) {
      if (this.graph.disconnect(to, port)) wires++;
    }
    const removed = ids.length > 0 ? this.graph.removeMany(ids) : 0;
    if (removed === 0 && wires === 0) return;
    this.selection.clear();
    this.selectedWires.clear();
    this.invalidate(null);
    this.syncSelection();
    this.commit("删除 " + (removed > 0 ? removed + " 个节点" : wires + " 条连线"));
    this.onChange();
  }

  // 从某个输出端口拉线（mode = from-out），或给某个输入端口找源（mode = to-in）。
  beginWire(node, side, index) {
    if (side === "in" && node.inputs[index] !== null) {
      const src = this.graph.get(node.inputs[index]);
      this.graph.disconnect(node.id, index);
      if (src) {
        this.invalidate(node);
        this.onChange();
        this.drag = { kind: "wire", mode: "from-out", anchor: { node: src, side: "out", index: 0 } };
        return;
      }
    }
    this.drag = { kind: "wire", mode: side === "out" ? "from-out" : "to-in", anchor: { node, side, index } };
  }

  connect(fromId, toId, port) {
    const res = this.graph.connect(fromId, toId, port);
    if (!res.ok) {
      this.onToast(res.reason, "error");
      return false;
    }
    const to = this.graph.get(toId);
    if (to) this.invalidate(to);
    this.commit("连线");
    this.onChange();
    return true;
  }

  // ---------- 指针事件 ----------

  onPointerDown(e) {
    if (e.target !== this.canvas) return;
    this.refreshRect();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // 某些环境下（合成事件 / 已释放的指针）会抛错，不影响后续处理。
    }
    const sp = this.screenPoint(e);
    this.pointers.set(e.pointerId, { x: sp.x, y: sp.y, type: e.pointerType, button: e.button });

    if (this.pointers.size === 2) {
      this.drag = null;
      this.setPending(null);
      this.startPinch();
      e.preventDefault();
      return;
    }
    if (this.pointers.size > 2) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    const wp = this.toWorld(sp);

    if (this.spaceDown || this.tool === "pan" || e.button === 1 || e.button === 2) {
      this.drag = { kind: "pan", last: sp };
      this.onCursor("grabbing");
      return;
    }

    const menuNode = this.hitMenuAt(sp);
    if (menuNode) {
      if (!this.selection.has(menuNode.id)) this.select([menuNode.id]);
      this.onNodeMenu({ node: menuNode, screen: sp });
      return;
    }

    const port = this.hitPortAt(sp, e.pointerType);
    if (port) {
      this.beginWire(port.node, port.side, port.index);
      return;
    }

    const node = this.hitNodeAt(sp);
    if (node) {
      if (e.shiftKey) {
        this.select([node.id], "toggle");
      } else if (!this.selection.has(node.id)) {
        this.select([node.id]);
      }
      this.startMove(node, wp, sp);
      return;
    }

    const wire = this.hitWireAt(sp);
    if (wire) {
      this.selection.clear();
      this.selectedWires.clear();
      this.selectedWires.add(wire.to + ":" + wire.port);
      this.syncSelection();
      return;
    }

    if (e.pointerType === "touch") {
      this.drag = { kind: "pan", last: sp };
      return;
    }
    this.drag = { kind: "marquee", start: wp, last: sp, additive: e.shiftKey };
    this.renderer.marquee = { x: wp.x, y: wp.y, w: 0, h: 0 };
    this.renderer.requestDraw();
  }

  startMove(node, wp, sp) {
    const ids = Array.from(this.selection);
    if (ids.length === 0) ids.push(node.id);
    const positions = new Map();
    for (const id of ids) {
      const n = this.graph.get(id);
      if (n) positions.set(id, { x: n.x, y: n.y });
    }
    this.drag = {
      kind: "move",
      ids,
      anchorId: node.id,
      start: wp,
      positions,
      moved: false,
      last: sp,
    };
    this.onCursor("move");
  }

  onPointerMove(e) {
    const rec = this.pointers.get(e.pointerId);
    if (rec) {
      const sp = this.screenPoint(e);
      rec.x = sp.x;
      rec.y = sp.y;
    }

    if (this.pinch && this.pointers.size >= 2) {
      e.preventDefault();
      this.updatePinch();
      return;
    }

    const sp = this.screenPoint(e);
    if (!this.drag) {
      this.updateHover(sp, e.pointerType);
      return;
    }
    e.preventDefault();

    const wp = this.toWorld(sp);
    if (this.drag.kind === "pan") {
      this.panBy(sp.x - this.drag.last.x, sp.y - this.drag.last.y);
      this.drag.last = sp;
      return;
    }
    if (this.drag.kind === "marquee") {
      const s = this.drag.start;
      this.renderer.marquee = {
        x: Math.min(s.x, wp.x),
        y: Math.min(s.y, wp.y),
        w: Math.abs(wp.x - s.x),
        h: Math.abs(wp.y - s.y),
      };
      this.renderer.requestDraw();
      return;
    }
    if (this.drag.kind === "move") {
      let dx = wp.x - this.drag.start.x;
      let dy = wp.y - this.drag.start.y;
      if (this.snap) {
        const a = this.drag.positions.get(this.drag.anchorId);
        dx = Math.round((a.x + dx) / SNAP) * SNAP - a.x;
        dy = Math.round((a.y + dy) / SNAP) * SNAP - a.y;
      }
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && !this.drag.moved) return;
      this.drag.moved = true;
      for (const id of this.drag.ids) {
        const base = this.drag.positions.get(id);
        const n = this.graph.get(id);
        if (!n || !base) continue;
        n.x = Math.round(base.x + dx);
        n.y = Math.round(base.y + dy);
        this.renderer.invalidateNode(n);
      }
      this.graph.touch();
      this.renderer.requestDraw();
      return;
    }
    if (this.drag.kind === "wire") {
      const anchorPos = portPosition(this.drag.anchor.node, this.drag.anchor.side, this.drag.anchor.index);
      const target = this.hitPortAt(sp, e.pointerType);
      const valid = this.isValidTarget(this.drag, target);
      this.setPending({
        from: anchorPos,
        cursor: valid ? portPosition(target.node, target.side, target.index) : wp,
        target: valid ? target : null,
      });
      this.renderer.hoverPort = target || null;
      this.renderer.requestDraw();
    }
  }

  onPointerUp(e) {
    const sp = this.screenPoint(e);
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) {
        this.pinch = null;
        this.drag = null;
        this.onCursor(this.tool === "pan" ? "grab" : "default");
      }
      return;
    }
    const drag = this.drag;
    const marqueeRect = this.renderer.marquee;
    this.drag = null;
    this.renderer.marquee = null;
    if (!drag) {
      this.setPending(null);
      return;
    }
    if (drag.kind === "wire") {
      this.finishWire(drag, sp, e.pointerType);
    } else if (drag.kind === "marquee") {
      this.finishMarquee(marqueeRect, drag.additive);
    } else if (drag.kind === "move") {
      if (drag.moved) {
        this.commit(drag.ids.length > 1 ? "移动 " + drag.ids.length + " 个节点" : "移动节点");
        this.onChange();
      }
    }
    this.setPending(null);
    this.renderer.hoverPort = null;
    this.renderer.requestDraw();
    this.onCursor(this.tool === "pan" ? "grab" : "default");
  }

  onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
    this.drag = null;
    this.pinch = null;
    this.renderer.marquee = null;
    this.setPending(null);
    this.renderer.requestDraw();
  }

  finishWire(drag, sp, pointerType) {
    const anchor = drag.anchor;
    const target = this.hitPortAt(sp, pointerType);
    if (target && this.isValidTarget(drag, target)) {
      if (drag.mode === "from-out") {
        this.connect(anchor.node.id, target.node.id, target.index);
      } else {
        this.connect(target.node.id, anchor.node.id, anchor.index);
      }
      return;
    }
    if (target) {
      const err = this.explainInvalidTarget(drag, target);
      if (err) this.onToast(err, "error");
      return;
    }
    const wp = this.toWorld(sp);
    this.quick = {
      world: wp,
      screen: { x: sp.x, y: sp.y },
      mode: drag.mode,
      anchor,
    };
    this.onQuickMenu({
      screen: { x: sp.x, y: sp.y },
      world: wp,
      side: drag.mode === "from-out" ? "needs-input" : "needs-output",
      anchor,
    });
  }

  isValidTarget(drag, target) {
    if (!drag || !target) return false;
    if (drag.mode === "from-out") return target.side === "in";
    return target.side === "out";
  }

  explainInvalidTarget(drag, target) {
    if (!drag || !target) return "";
    if (drag.mode === "from-out" && target.side === "out") return "输出端不能接输出端";
    if (drag.mode === "to-in" && target.side === "in") return "输入端不能接输入端";
    return "这里不能连线";
  }

  // 快速菜单选择了一个类型：新建节点并自动接线。
  applyQuickChoice(typeKey) {
    const q = this.quick;
    this.quick = null;
    if (!q) return;
    const isFn = typeof typeKey === "string" && typeKey.startsWith("fn:");
    const fnName = isFn ? typeKey.slice(3) : null;
    const def = isFn ? this.fnDef(fnName) : null;
    if (isFn && !def) {
      this.onToast("函数「" + fnName + "」不存在", "error");
      return;
    }
    const type = isFn ? "fn" : typeKey;
    const t = NODE_TYPES[type];
    if (!t) return;
    const node = this.graph.createNode(type, q.world.x, q.world.y, isFn ? { fn: fnName, arity: def.params } : {});
    this.renderer.invalidateNode(node);

    if (q.mode === "from-out") {
      let port = node.inputs.findIndex((v) => v === null);
      if (port < 0) port = 0;
      if (node.inputs.length === 0) {
        // 这个类型没有输入端，无法接收，撤销。
        this.graph.removeMany([node.id]);
        this.invalidate(null);
        this.onToast("该类型没有输入端", "error");
        return;
      }
      const pp = portPosition(node, "in", port);
      node.x = Math.round(node.x + (q.world.x - pp.x));
      node.y = Math.round(node.y + (q.world.y - pp.y));
      this.graph.connect(q.anchor.node.id, node.id, port);
    } else {
      if (!t.hasOutput) {
        this.graph.removeMany([node.id]);
        this.invalidate(null);
        this.onToast("该类型没有输出端", "error");
        return;
      }
      const pp = portPosition(node, "out", 0);
      node.x = Math.round(node.x + (q.world.x - pp.x));
      node.y = Math.round(node.y + (q.world.y - pp.y));
      this.graph.connect(node.id, q.anchor.node.id, q.anchor.index);
    }
    this.invalidate(node);
    this.select([node.id]);
    this.commit("新建" + t.name + "并连线");
    this.onChange();
  }

  cancelQuick() {
    this.quick = null;
  }

  finishMarquee(m, additive) {
    if (!m) return;
    const ids = this.renderer.grid.query(m.x, m.y, Math.max(m.w, 1), Math.max(m.h, 1), []);
    const picked = [];
    for (const id of ids) {
      const node = this.graph.get(id);
      if (!node) continue;
      const w = nodeWidth(node), h = nodeHeight(node);
      if (node.x < m.x + m.w && node.x + w > m.x && node.y < m.y + m.h && node.y + h > m.y) picked.push(id);
    }
    if (additive) {
      for (const id of picked) this.selection.add(id);
      this.syncSelection();
    } else {
      this.select(picked);
    }
  }

  // ---------- 双指缩放 ----------

  startPinch() {
    const pts = Array.from(this.pointers.values());
    if (pts.length < 2) return;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    this.pinch = {
      dist,
      mid,
      world: this.renderer.screenToWorld(mid.x, mid.y),
      scale: this.renderer.view.scale,
    };
    this.renderer.requestDraw();
  }

  updatePinch() {
    const p = this.pinch;
    if (!p) return;
    const pts = Array.from(this.pointers.values());
    if (pts.length < 2) return;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const v = this.renderer.view;
    v.scale = clamp((p.scale * dist) / p.dist, MIN_SCALE, MAX_SCALE);
    v.x = p.world.x - mid.x / v.scale;
    v.y = p.world.y - mid.y / v.scale;
    this.onViewChange();
  }

  // ---------- 滚轮 ----------

  onWheel(e) {
    e.preventDefault();
    this.refreshRect();
    const sp = this.screenPoint(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0125);
      this.zoomAt(sp.x, sp.y, factor);
      return;
    }
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.renderer.cssH : 1;
    this.panBy(-e.deltaX * k, -e.deltaY * k);
  }

  onDoubleClick(e) {
    if (e.target !== this.canvas) return;
    this.refreshRect();
    const sp = this.screenPoint(e);
    const node = this.hitNodeAt(sp);
    if (node) {
      this.onEditNode(node.id);
      return;
    }
    const wp = this.toWorld(sp);
    this.quick = { world: wp, screen: sp, mode: null, anchor: null };
    this.onQuickMenu({ screen: sp, world: wp, side: "free", anchor: null });
  }

  // ---------- 键盘 ----------

  static isTypingTarget(el) {
    if (!el) return false;
    if (el.closest && el.closest(".dm")) return true;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  }

  onKeyDown(e) {
    if (Editor.isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === " ") {
      this.spaceDown = true;
      if (!this.drag) this.onCursor("grab");
      e.preventDefault();
      return;
    }
    if (mod && (k === "z" || k === "Z")) {
      this.onUndo?.(e.shiftKey ? "redo" : "undo");
      e.preventDefault();
      return;
    }
    if (mod && (k === "y" || k === "Y")) {
      this.onUndo?.("redo");
      e.preventDefault();
      return;
    }
    if (mod && (k === "a" || k === "A")) {
      this.selectAll();
      e.preventDefault();
      return;
    }
    if (mod && (k === "c" || k === "C")) {
      this.copy();
      e.preventDefault();
      return;
    }
    if (mod && (k === "v" || k === "V")) {
      this.paste();
      e.preventDefault();
      return;
    }
    if (mod && (k === "d" || k === "D")) {
      this.duplicate();
      e.preventDefault();
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      this.deleteSelection();
      e.preventDefault();
      return;
    }
    if (k === "Escape") {
      this.setPending(null);
      this.drag = null;
      this.pinch = null;
      this.clearSelection();
      this.onEscape?.();
      return;
    }
    if (k === "v" || k === "V") {
      this.setTool("select");
      return;
    }
    if (k === "h" || k === "H") {
      this.setTool("pan");
      return;
    }
    if (k === "g" || k === "G") {
      this.setSnap(!this.snap);
      return;
    }
    if (k === "f" || k === "F") {
      this.fit();
      return;
    }
    if (k === "=" || k === "+") {
      this.setZoom(this.renderer.view.scale * 1.25);
      return;
    }
    if (k === "-" || k === "_") {
      this.setZoom(this.renderer.view.scale / 1.25);
      return;
    }
    if (k === "0") {
      this.setZoom(1);
    }
  }

  onKeyUp(e) {
    if (e.key === " ") {
      this.spaceDown = false;
      if (!this.drag) this.onCursor(this.tool === "pan" ? "grab" : "default");
    }
  }

  setTool(tool) {
    this.tool = tool;
    this.onCursor(tool === "pan" ? "grab" : "default");
    this.onChange();
  }

  setSnap(on) {
    this.snap = !!on;
    this.onChange();
  }

  // ---------- 剪贴板 ----------

  copy() {
    const ids = Array.from(this.selection);
    if (ids.length === 0) return;
    const nodes = [];
    for (const id of ids) {
      const n = this.graph.get(id);
      if (!n) continue;
      nodes.push({ id: n.id, type: n.type, x: n.x, y: n.y, value: n.value, inputValue: n.inputValue, fn: n.fn, inputs: n.inputs.slice() });
    }
    this.clipboard = nodes;
  }

  _pasteNodes(nodes, dx, dy, label) {
    if (!nodes || nodes.length === 0) return;
    const map = new Map();
    const created = [];
    for (const n of nodes) {
      const nn = this.graph.createNode(n.type, n.x + dx, n.y + dy, { value: n.value, inputValue: n.inputValue, fn: n.fn, arity: n.inputs.length });
      map.set(n.id, nn.id);
      created.push(nn);
    }
    for (const n of nodes) {
      const nn = this.graph.get(map.get(n.id));
      if (!nn) continue;
      for (let i = 0; i < n.inputs.length && i < nn.inputs.length; i++) {
        const s = n.inputs[i];
        if (s !== null && map.has(s)) nn.inputs[i] = map.get(s);
      }
    }
    this.invalidate(null);
    this.select(created.map((n) => n.id));
    this.commit(label);
    this.onChange();
  }

  paste() {
    if (!this.clipboard) return;
    this._pasteNodes(this.clipboard, 28, 28, "粘贴 " + this.clipboard.length + " 个节点");
  }

  duplicate() {
    const ids = Array.from(this.selection);
    if (ids.length === 0) return;
    const nodes = [];
    for (const id of ids) {
      const n = this.graph.get(id);
      if (!n) continue;
      nodes.push({ id: n.id, type: n.type, x: n.x, y: n.y, value: n.value, inputValue: n.inputValue, fn: n.fn, inputs: n.inputs.slice() });
    }
    this._pasteNodes(nodes, 28, 28, "复制 " + nodes.length + " 个节点");
  }

  // ---------- 悬停 ----------

  updateHover(sp, pointerType) {
    const menuNode = this.hitMenuAt(sp);
    const menuId = menuNode ? menuNode.id : null;
    if (menuId !== this.renderer.hoverMenu) {
      this.renderer.hoverMenu = menuId;
      this.renderer.requestDraw();
    }
    const port = this.hitPortAt(sp, pointerType);
    const node = menuNode || (port ? port.node : this.hitNodeAt(sp));
    const portChanged =
      (!!port !== !!this.renderer.hoverPort) ||
      (port &&
        this.renderer.hoverPort &&
        (port.node.id !== this.renderer.hoverPort.node.id ||
          port.side !== this.renderer.hoverPort.side ||
          port.index !== this.renderer.hoverPort.index));
    const nodeId = node ? node.id : null;
    const nodeChanged = nodeId !== this.renderer.hoverNode;
    if (portChanged || nodeChanged) {
      this.renderer.hoverPort = port || null;
      this.renderer.hoverNode = nodeId;
      this.renderer.requestDraw();
    }
    if (!this.drag && !this.spaceDown && this.tool !== "pan") {
      this.onCursor(menuNode ? "pointer" : port ? "pointer" : node ? "move" : "default");
    }
  }
}