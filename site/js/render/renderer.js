// Canvas 渲染器：视口裁剪 + 空间索引 + LOD，保证大图也能 60fps 交互。
// 世界坐标 -> 屏幕坐标：(w - view.x) * view.scale
import { NODE_TYPES } from "../core/types.js";
import { SpatialGrid } from "../core/grid.js";
import {
  MENU_W,
  VALUE_W,
  menuButtonRect,
  nodeHeight,
  nodeLabel,
  nodeWidth,
  portPosition,
  wirePath,
} from "../core/geometry.js";

const FONT_STACK = '"Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const MONO_FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const LOD_SIMPLE = 0.34; // 低于此缩放只画色块，不画文字与端口

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// 把超高精度数值压成一句话，供节点框内快速查看。
function shortRealText(real) {
  if (!real) return "";
  const s = real.toString();
  const dot = s.indexOf(".");
  const neg = s.startsWith("-");
  let ip = (neg ? s.slice(1) : s).slice(0, dot < 0 ? s.length : dot - (neg ? 1 : 0));
  const fp = dot < 0 ? "" : s.slice(dot + 1).replace(/0+$/, "");
  ip = ip.replace(/^0+/, "") || "0";
  const digits = ip.length;
  if (digits > 9 || (ip === "0" && fp.length > 4 && !/^0*$/.test(fp))) {
    const x = real.ld();
    if (Number.isFinite(x) && x !== 0) {
      const e = x.toExponential(5);
      return e.replace(/e([+-])(\d)$/, "e$10$2");
    }
  }
  if (digits > 12) return (neg ? "-" : "") + ip.slice(0, 12) + "…";
  const frac = fp.slice(0, 4);
  return (neg ? "-" : "") + ip + (frac ? "." + frac : "");
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return v.length > 0 ? v : fallback;
  };
  return {
    bg: get("--canvas-bg", "#0d1017"),
    grid: get("--canvas-grid", "rgba(255,255,255,0.07)"),
    gridStrong: get("--canvas-grid-strong", "rgba(255,255,255,0.14)"),
    nodeBg: get("--node-bg", "#1a1f2a"),
    nodeBgSel: get("--node-bg-sel", "#1e2637"),
    nodeBorder: get("--node-border", "#2f3746"),
    nodeBorderHover: get("--node-border-hover", "#5b6575"),
    headerText: get("--node-header-text", "#e8eefc"),
    bodyText: get("--node-body-text", "#93a0b8"),
    port: get("--port", "#63708a"),
    portOut: get("--port-out", "#8fa2c4"),
    accent: get("--accent", "#4d9dff"),
    err: get("--err", "#ff5d6c"),
    warn: get("--warn", "#ffb648"),
    marquee: get("--accent", "#4d9dff"),
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.grid = new SpatialGrid(320);
    this.view = { x: 0, y: 0, scale: 1 };
    this.graph = null;
    this.selection = new Set();
    this.selectedWires = new Set();
    this.hoverNode = null;
    this.hoverPort = null;
    this.hoverMenu = null;
    this.nodeValues = null;
    this.dragPort = null;
    this.pending = null;
    this.marquee = null;
    this.danglingPorts = new Set();
    this.unusedNodes = new Set();
    this.activeWires = new Set();
    this.theme = readTheme();
    this.dpr = 1;
    this.cssW = 0;
    this.cssH = 0;
    this._inputIndex = new Map();
    this._indexVersion = -1;
    this._pendingFull = true;
    this._pendingRects = new Set();
    this._wires = null; // 连线列表缓存（按 graph.version 失效）
    this._wiresVersion = -1;
    this._font = "";
    this._lastVisible = 0;
  }

  // 求值结果（节点 id -> Real），用于在节点上显示简略数值。
  setNodeValues(values) {
    this.nodeValues = values || null;
    this.requestDraw();
  }

  refreshTheme() {
    this.theme = readTheme();
  }

  setGraph(graph) {
    this.graph = graph;
    this.grid.clear();
    this._pendingFull = true;
    this._inputIndex = new Map();
    this._indexVersion = -1;
    this._wires = null;
    this._wiresVersion = -1;
  }

  invalidateAll() {
    this.grid.clear();
    this._pendingFull = true;
    this._wires = null;
    this._wiresVersion = -1;
  }

  invalidateNode(node) {
    if (node) this._pendingRects.add(node.id);
  }

  _syncGrid() {
    if (!this.graph) return;
    if (this._pendingFull) {
      this.grid.clear();
      for (const node of this.graph.nodes.values()) {
        this.grid.insert(node.id, { x: node.x, y: node.y, w: nodeWidth(node), h: nodeHeight(node) });
      }
      this._pendingFull = false;
      this._pendingRects.clear();
      return;
    }
    if (this._pendingRects.size === 0) return;
    for (const id of this._pendingRects) {
      const node = this.graph.get(id);
      if (!node) this.grid.remove(id);
      else this.grid.update(id, { x: node.x, y: node.y, w: nodeWidth(node), h: nodeHeight(node) });
    }
    this._pendingRects.clear();
  }

  _inputIndexMap() {
    if (!this.graph) return this._inputIndex;
    if (this._indexVersion === this.graph.version) return this._inputIndex;
    const map = new Map();
    let i = 0;
    for (const node of this.graph.inputNodes()) map.set(node.id, i++);
    this._inputIndex = map;
    this._indexVersion = this.graph.version;
    return map;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  worldToScreen(wx, wy) {
    return { x: (wx - this.view.x) * this.view.scale, y: (wy - this.view.y) * this.view.scale };
  }

  screenToWorld(sx, sy) {
    return { x: this.view.x + sx / this.view.scale, y: this.view.y + sy / this.view.scale };
  }

  visibleRect(margin = 0) {
    const s = this.view.scale;
    return {
      x: this.view.x - margin / s,
      y: this.view.y - margin / s,
      w: this.cssW / s + (margin * 2) / s,
      h: this.cssH / s + (margin * 2) / s,
    };
  }

  requestDraw() {
    this._dirty = true;
  }

  draw() {
    if (!this.graph) return;
    this._syncGrid();
    const ctx = this.ctx;
    const { theme, view, dpr } = this;
    const scale = view.scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, -view.x * scale * dpr, -view.y * scale * dpr);

    const vis = this.visibleRect(80);
    if (scale > 0.08) this._drawGrid(vis);
    const ids = this.grid.querySorted(vis.x, vis.y, vis.w, vis.h, []);
    this._lastVisible = ids.length;
    this._drawWires();
    this._drawNodes(ids);
    this._drawPending();
    this._drawMarquee();
  }

  _drawGrid(vis) {
    const ctx = this.ctx;
    const scale = this.view.scale;
    let step = 40;
    while (step * scale < 26) step *= 2;
    while (step * scale > 140) step /= 2;
    const x0 = Math.floor(vis.x / step) * step;
    const y0 = Math.floor(vis.y / step) * step;
    const dot = 1.4 / scale;
    ctx.beginPath();
    for (let x = x0; x <= vis.x + vis.w; x += step) {
      for (let y = y0; y <= vis.y + vis.h; y += step) {
        ctx.rect(x, y, dot, dot);
      }
    }
    ctx.fillStyle = this.theme.grid;
    ctx.fill();
  }

  _wireColor(node) {
    const t = NODE_TYPES[node.type];
    return t ? t.hue : this.theme.port;
  }

  // 连线列表缓存：只在图结构 / 坐标变化（graph.version 变了）时重建一次。
  // 端点坐标、节点宽度都随 version 更新，所以这个缓存是自洽的。
  _wireList() {
    const g = this.graph;
    if (!g) return [];
    if (this._wires && this._wiresVersion === g.version) return this._wires;
    const list = [];
    for (const node of g.nodes.values()) {
      for (let i = 0; i < node.inputs.length; i++) {
        const srcId = node.inputs[i];
        if (srcId === null || srcId === undefined) continue;
        const src = g.get(srcId);
        if (!src) continue;
        const p = wirePath(portPosition(src, "out", 0), portPosition(node, "in", i));
        // 三次贝塞尔一定落在 4 个控制点的凸包内，用它们的包围盒做裁剪就够了。
        list.push({
          src,
          key: node.id + ":" + i,
          p,
          x0: Math.min(p.x1, p.c1x, p.c2x, p.x2),
          y0: Math.min(p.y1, p.c1y, p.c2y, p.y2),
          x1: Math.max(p.x1, p.c1x, p.c2x, p.x2),
          y1: Math.max(p.y1, p.c1y, p.c2y, p.y2),
        });
      }
    }
    this._wires = list;
    this._wiresVersion = g.version;
    return list;
  }

  // 常态渲染所有连线：不只画「可见节点的连线」，两端都在画布外、只是跨过视野的线也要画，
  // 否则顺着线找不到远处的节点。每帧只对缓存做一次廉价的包围盒裁剪。
  _drawWires() {
    const ctx = this.ctx;
    const scale = this.view.scale;
    // 缩得太小时连线不足一像素，直接跳过，省掉大量 bezier 绘制。
    if (scale < 0.06) return;
    const vis = this.visibleRect();
    const visX1 = vis.x + vis.w;
    const visY1 = vis.y + vis.h;
    const wires = this._wireList();
    // 可见的连续同色线合成一条 Path：几千条线也只切换几次绘制状态。
    const groups = new Map();
    const hot = [];
    for (const w of wires) {
      if (w.x1 < vis.x || w.x0 > visX1 || w.y1 < vis.y || w.y0 > visY1) continue;
      if (this.activeWires.has(w.key) || this.selectedWires.has(w.key)) {
        hot.push(w);
        continue;
      }
      const hue = this._wireColor(w.src);
      let arr = groups.get(hue);
      if (!arr) {
        arr = [];
        groups.set(hue, arr);
      }
      arr.push(w);
    }
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.6;
    for (const [hue, arr] of groups) {
      ctx.beginPath();
      for (const w of arr) {
        const p = w.p;
        ctx.moveTo(p.x1, p.y1);
        ctx.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.x2, p.y2);
      }
      ctx.strokeStyle = hue;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 高亮（选中 / 正在连）的线单独一批，盖在普通连线上面。
    if (hot.length > 0) {
      ctx.beginPath();
      for (const w of hot) {
        const p = w.p;
        ctx.moveTo(p.x1, p.y1);
        ctx.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.x2, p.y2);
      }
      ctx.strokeStyle = this.theme.accent;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  _drawNodes(ids) {
    if (this.view.scale < LOD_SIMPLE) {
      this._drawNodesBatch(ids);
      return;
    }
    for (const id of ids) {
      const node = this.graph.get(id);
      if (node) this._drawNodeFull(node);
    }
  }

  // 远景：按颜色分组批量 fillRect，避免每节点切换 fillStyle（这是低缩放下最大的开销）。
  _drawNodesBatch(ids) {
    const ctx = this.ctx;
    const groups = new Map();
    for (const id of ids) {
      const node = this.graph.get(id);
      if (!node) continue;
      const t = NODE_TYPES[node.type];
      const hue = t ? t.hue : "#555";
      let arr = groups.get(hue);
      if (!arr) {
        arr = [];
        groups.set(hue, arr);
      }
      arr.push(node);
    }
    ctx.globalAlpha = 0.72;
    for (const [hue, nodes] of groups) {
      ctx.fillStyle = hue;
      for (const n of nodes) ctx.fillRect(n.x, n.y, nodeWidth(n), nodeHeight(n));
    }
    ctx.globalAlpha = 1;
    if (this.selection.size > 0) {
      ctx.strokeStyle = this.theme.accent;
      ctx.lineWidth = 2 / this.view.scale;
      for (const id of this.selection) {
        const n = this.graph.get(id);
        if (n) ctx.strokeRect(n.x, n.y, nodeWidth(n), nodeHeight(n));
      }
    }
  }

  _drawNodeFull(node) {
    const ctx = this.ctx;
    const theme = this.theme;
    const w = nodeWidth(node);
    const h = nodeHeight(node);
    const selected = this.selection.has(node.id);
    const hovered = this.hoverNode === node.id;
    const label = nodeLabel(node);

    rr(ctx, node.x, node.y, w, h, 9);
    ctx.fillStyle = selected ? theme.nodeBgSel : theme.nodeBg;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.globalAlpha = selected ? 0.95 : 0.8;
    ctx.fillStyle = label.accent;
    ctx.fillRect(node.x, node.y, 3.5, h);
    ctx.globalAlpha = 1;
    ctx.restore();

    rr(ctx, node.x, node.y, w, h, 9);
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? theme.accent : hovered ? theme.nodeBorderHover : theme.nodeBorder;
    ctx.stroke();

    // 标题在「左侧色条」与「简略数值 / 菜单按钮」之间居中。
    const titleLeft = node.x + 9;
    let titleRight = node.x + w - MENU_W - 13;

    const valueText = this._nodeValueText(node);
    if (valueText) {
      ctx.font = "10.5px " + MONO_FONT;
      const shown = fitText(ctx, valueText, VALUE_W - 6);
      const vw = ctx.measureText(shown).width;
      ctx.fillStyle = theme.bodyText;
      ctx.globalAlpha = 0.95;
      ctx.textAlign = "right";
      ctx.fillText(shown, titleRight, node.y + h / 2);
      ctx.globalAlpha = 1;
      titleRight -= vw + 8;
    }

    ctx.font = "600 12.5px " + FONT_STACK;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = theme.headerText;
    ctx.fillText(label.title, (titleLeft + titleRight) / 2, node.y + h / 2);

    ctx.textAlign = "left";

    const btn = menuButtonRect(node);
    const hotMenu = this.hoverMenu === node.id;
    rr(ctx, btn.x, btn.y, btn.w, btn.h, 4);
    ctx.fillStyle = hotMenu ? theme.accent : theme.nodeBorder;
    ctx.globalAlpha = hotMenu ? 0.9 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    const cx = btn.x + btn.w / 2;
    const cy = btn.y + btn.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 3.4, cy - 1.6);
    ctx.lineTo(cx + 3.4, cy - 1.6);
    ctx.lineTo(cx, cy + 2.6);
    ctx.closePath();
    ctx.fillStyle = hotMenu ? "#0b0e14" : theme.headerText;
    ctx.fill();

    this._drawPorts(node);
  }

  // 只有输入 / 输出节点在框内显示简略数值；常数节点的标题本身就是数值。
  _nodeValueText(node) {
    if (node.type === "I") {
      const t = String(node.inputValue === undefined ? "" : node.inputValue);
      return t.length > 16 ? t.slice(0, 15) + "…" : t;
    }
    if (node.type !== "out" || !this.nodeValues) return "";
    const first = node.inputs[0];
    const v = first === undefined || first === null ? null : this.nodeValues.get(first);
    if (!v) return "";
    const txt = shortRealText(v);
    return node.inputs.length > 1 ? txt + " …" : txt;
  }

  _drawPorts(node) {
    const ctx = this.ctx;
    const theme = this.theme;
    const t = NODE_TYPES[node.type];
    const r = 5.5;
    for (let i = 0; i < node.inputs.length; i++) {
      const p = portPosition(node, "in", i);
      const key = node.id + ":" + i;
      const dangling = node.inputs[i] === null;
      const hot =
        this.hoverPort && this.hoverPort.node === node.id && this.hoverPort.side === "in" && this.hoverPort.index === i;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hot ? r + 1.6 : r, 0, Math.PI * 2);
      if (dangling) {
        ctx.fillStyle = theme.bg;
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = this.danglingPorts.has(key) ? theme.err : theme.port;
        ctx.stroke();
      } else {
        ctx.fillStyle = hot ? theme.accent : theme.port;
        ctx.fill();
      }
      if (hot) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = theme.accent;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (t.hasOutput) {
      const p = portPosition(node, "out", 0);
      const hot = this.dragPort && this.dragPort.node === node.id && this.dragPort.side === "out";
      ctx.beginPath();
      ctx.arc(p.x, p.y, hot ? r + 1.6 : r, 0, Math.PI * 2);
      ctx.fillStyle = hot ? theme.accent : theme.portOut;
      ctx.fill();
    }
  }

  _drawPending() {
    const p = this.pending;
    if (!p) return;
    const ctx = this.ctx;
    const path = wirePath(p.from, p.cursor);
    ctx.beginPath();
    ctx.moveTo(path.x1, path.y1);
    ctx.bezierCurveTo(path.c1x, path.c1y, path.c2x, path.c2y, path.x2, path.y2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.theme.accent;
    ctx.setLineDash([6 / this.view.scale, 5 / this.view.scale]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p.cursor.x, p.cursor.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.accent;
    ctx.fill();
  }

  _drawMarquee() {
    const m = this.marquee;
    if (!m) return;
    const ctx = this.ctx;
    const scale = this.view.scale;
    ctx.fillStyle = this.theme.marquee;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = this.theme.marquee;
    ctx.setLineDash([5 / scale, 4 / scale]);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.setLineDash([]);
  }
}