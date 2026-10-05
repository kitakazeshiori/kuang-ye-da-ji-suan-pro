// 节点几何：尺寸、端口位置、连线曲线与采样。全部是纯函数，便于单测。
//
// 版式参考 nandgame，但上下翻转：
//   * 节点是简洁的圆角框，没有说明文字；
//   * 输入端在节点上边缘，输出端在下边缘；
//   * 右侧有一个小菜单按钮（点开有 delete 等操作）。
import { NODE_TYPES } from "./types.js";

export const BOX_H = 34; // 简洁框的统一高度
export const MIN_W = 92;
export const MAX_W = 260;
export const PORT_R = 6; // 端口半径（世界坐标）
export const MENU_W = 16; // 右侧小菜单按钮
export const MENU_H = 16;
export const SNAP = 20;
export const VALUE_W = 56; // 输入/输出节点上简略数值的预留宽度

// 默认命名顺序：XYZABCDEF…
export const NAME_POOL = "XYZABCDEFGHIJKLMNOPQRSTUVW";

export function nameOf(node) {
  return node && node.name ? String(node.name) : "?";
}

export function shortText(text, max = 24) {
  const s = String(text === undefined || text === null ? "" : text);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function textWidth(s, per) {
  return String(s).length * per;
}

export function nodeWidth(node) {
  const t = NODE_TYPES[node.type];
  if (!t) return MIN_W;
  let w;
  if (node.type === "C") w = 30 + textWidth(shortText(node.value, 26), 7.6);
  else if (node.type === "I" || node.type === "out") w = 42 + textWidth("#" + nameOf(node), 8.6) + VALUE_W;
  else w = 44 + textWidth(t.en || t.name, 10);
  // 端口多的节点要足够宽，避免端口挤在一起。
  const n = node.inputs ? node.inputs.length : t.arity || 0;
  if (n > 3) w = Math.max(w, 20 + n * 22);
  return Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));
}

export function nodeHeight() {
  return BOX_H;
}

export function nodeRect(node) {
  return { x: node.x, y: node.y, w: nodeWidth(node), h: nodeHeight(node) };
}

export function menuButtonRect(node) {
  const w = nodeWidth(node);
  return { x: node.x + w - MENU_W - 5, y: node.y + (BOX_H - MENU_H) / 2, w: MENU_W, h: MENU_H };
}

export function portCount(node, side) {
  if (side === "out") return NODE_TYPES[node.type].hasOutput ? 1 : 0;
  return node.inputs.length;
}

// 输入端口沿上边缘均布；输出端口在下边缘正中。
export function portPosition(node, side, index) {
  const w = nodeWidth(node);
  if (side === "out") return { x: node.x + w / 2, y: node.y + BOX_H };
  const n = node.inputs.length;
  if (n <= 0) return { x: node.x + w / 2, y: node.y };
  return { x: node.x + (w * (index + 0.5)) / n, y: node.y };
}

// 节点上显示的内容：只有标题（+ 权重角标），不再写功能说明。
export function nodeLabel(node) {
  const t = NODE_TYPES[node.type];
  if (node.type === "I") return { title: "#" + nameOf(node), accent: t.hue, weight: t.weight };
  if (node.type === "out") return { title: "#" + nameOf(node), accent: t.hue, weight: 0 };
  if (node.type === "C") return { title: shortText(node.value, 22), accent: t.hue, weight: t.weight };
  return { title: t.en || t.name, accent: t.hue, weight: t.weight };
}

// 三次贝塞尔：控制点沿垂直方向外推（端口在上下边缘）。
export function wirePath(from, to) {
  const dy = Math.abs(to.y - from.y);
  const dx = Math.abs(to.x - from.x);
  let c = Math.max(26, Math.min(150, dy * 0.5 + dx * 0.08));
  if (to.y < from.y) c = Math.max(c, Math.min(220, 70 + dy * 0.35 + dx * 0.1));
  return {
    x1: from.x, y1: from.y,
    c1x: from.x, c1y: from.y + c,
    c2x: to.x, c2y: to.y - c,
    x2: to.x, y2: to.y,
  };
}

export function cubicPoint(p, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p.x1 + b * p.c1x + c * p.c2x + d * p.x2,
    y: a * p.y1 + b * p.c1y + c * p.c2y + d * p.y2,
  };
}

export function sampleCubic(p, n = 20, out = []) {
  out.length = 0;
  for (let i = 0; i <= n; i++) out.push(cubicPoint(p, i / n));
  return out;
}

export function distanceToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, ay = pts[i - 1].y;
    const bx = pts[i].x, by = pts[i].y;
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + t * vx);
    const dy = py - (ay + t * vy);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function graphBounds(graph, margin = 48) {
  if (graph.size === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const node of graph.nodes.values()) {
    const w = nodeWidth(node), h = nodeHeight(node);
    if (node.x < x0) x0 = node.x;
    if (node.y < y0) y0 = node.y;
    if (node.x + w > x1) x1 = node.x + w;
    if (node.y + h > y1) y1 = node.y + h;
  }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + margin * 2, h: y1 - y0 + margin * 2 };
}