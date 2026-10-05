// 自动布局质量评估工具。
//
//   node tools/bench_layout.mjs ans7.txt
//   node tools/bench_layout.mjs ans7.txt cols=3 rowRatio=8 perCol=40
//
// 指标：画布宽高（宽高比越接近 1.4 越「方」）、填充率（节点面积 / 画布面积），
// 以及连线的平均/中位/95 分位长度（都以行高为单位）与长连线（> 4 行）占比。
import fs from "node:fs";
import { fromProblemText } from "../site/js/core/serialize.js";
import { nodeWidth, nodeHeight } from "../site/js/core/geometry.js";

const opts = {};
for (const a of process.argv.slice(3)) {
  const m = /^([A-Za-z]+)=(.*)$/.exec(a);
  if (!m) continue;
  const num = Number(m[2]);
  opts[m[1]] = Number.isFinite(num) && m[2] !== "" ? num : m[2];
}

function metrics(g) {
  const nh = nodeHeight();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, area = 0;
  for (const n of g.nodes.values()) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + nodeWidth(n));
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + nodeHeight(n));
    area += nodeWidth(n) * nodeHeight(n);
  }
  const lens = [];
  for (const n of g.nodes.values()) {
    for (const s of n.inputs) {
      if (s === null || s === undefined) continue;
      const p = g.nodes.get(s);
      if (!p) continue;
      const dx = p.x + nodeWidth(p) / 2 - (n.x + nodeWidth(n) / 2);
      const dy = p.y + nodeHeight(p) - n.y;
      lens.push(Math.hypot(dx, dy));
    }
  }
  lens.sort((a, b) => a - b);
  const q = (p) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))] || 0;
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const w = maxX - minX, h = maxY - minY;
  return {
    n: g.nodes.size,
    canvas: w + "x" + h,
    ratio: +(w / h).toFixed(2),
    fill: +(area / (w * h)).toFixed(3),
    wires: lens.length,
    meanWireRows: +(mean / nh).toFixed(2),
    medWireRows: +(q(0.5) / nh).toFixed(2),
    p95WireRows: +(q(0.95) / nh).toFixed(2),
    longShare: (lens.filter((x) => x > 4 * nh).length / lens.length * 100).toFixed(1) + "%",
  };
}

const file = process.argv[2];
const t0 = Date.now();
const { graph } = fromProblemText(fs.readFileSync(file, "utf8"));
const t1 = Date.now();
if (Object.keys(opts).length) graph.autoLayout(opts);
console.log(file, JSON.stringify(opts), JSON.stringify(metrics(graph)), "layout=" + (t1 - t0) + "ms");