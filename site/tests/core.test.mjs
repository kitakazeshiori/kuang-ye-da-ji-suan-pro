// 核心逻辑单测：node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Graph } from "../js/core/graph.js";
import { SpatialGrid } from "../js/core/grid.js";
import { nodeHeight, nodeWidth, portPosition, wirePath, cubicPoint, distanceToPolyline, sampleCubic } from "../js/core/geometry.js";
import { analyze, checkConstText, scoreFactor } from "../js/core/validate.js";
import { GraphFormatError, fromProblemText, toProblemText } from "../js/core/serialize.js";
import { History } from "../js/core/history.js";
import { LEVELS, SANDBOX, TASKS, getLevel } from "../js/core/levels.js";
import { NODE_TYPES, TYPE_ORDER } from "../js/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(here, "..", "..", "build");

test("图：创建、连线、断开与扇出", () => {
  const g = new Graph();
  const a = g.createNode("I", 0, 0);
  const b = g.createNode("C", 0, 100, { value: "2" });
  const s = g.createNode("mul", 200, 0);
  assert.equal(g.connect(a.id, s.id, 0).ok, true);
  assert.equal(g.connect(b.id, s.id, 1).ok, true);
  assert.equal(s.inputs[0], a.id);
  assert.equal(g.refCount(), 2);
  // 输出端可扇出到多个输入端
  const s2 = g.createNode("add", 400, 0);
  assert.equal(g.connect(s.id, s2.id, 0).ok, true);
  assert.equal(g.connect(s.id, s2.id, 1).ok, true);
  assert.equal(g.consumersOf(s.id).length, 2);
  assert.equal(g.disconnect(s2.id, 1), true);
  assert.equal(s2.inputs[1], null);
});

test("图：拒绝成环与非法连线", () => {
  const g = new Graph();
  const a = g.createNode("I");
  const b = g.createNode("add");
  const c = g.createNode("add");
  g.connect(a.id, b.id, 0);
  g.connect(b.id, c.id, 0);
  const res = g.connect(c.id, b.id, 1);
  assert.equal(res.ok, false);
  assert.match(res.reason, /环/);
  assert.equal(g.connect(b.id, a.id, 0).reason.length > 0, true, "输入节点没有输入端");
  assert.equal(g.connect(a.id, a.id, 0).ok, false);
});

test("图：删除节点会清理引用", () => {
  const g = new Graph();
  const a = g.createNode("I");
  const s = g.createNode("sqrt");
  const o = g.createNode("out");
  g.connect(a.id, s.id, 0);
  g.connect(s.id, o.id, 0);
  assert.equal(g.remove(a.id), true);
  assert.equal(s.inputs[0], null);
  assert.equal(g.removeMany([s.id, o.id]), 2);
  assert.equal(g.size, 0);
});

test("图：拓扑排序稳定且检测环", () => {
  const g = new Graph();
  const a = g.createNode("I");
  const b = g.createNode("neg");
  const c = g.createNode("neg");
  g.connect(a.id, b.id, 0);
  g.connect(b.id, c.id, 0);
  assert.deepEqual(g.topoOrder(), [a.id, b.id, c.id]);
  g.nodes.get(a.id).inputs.push(b.id); // 人为造环
  assert.equal(g.topoOrder(), null);
});

test("图：权重符合题面", () => {
  const g = new Graph();
  g.createNode("I");
  g.createNode("C", 0, 0, { value: "1" });
  g.createNode("add");
  g.createNode("neg");
  g.createNode("mul");
  g.createNode("sqrt");
  g.createNode("sin");
  g.createNode("cos");
  g.createNode("exp");
  g.createNode("out");
  assert.equal(g.cost(), 1 + 1 + 1 + 1 + 4 + 7 + 9 + 9 + 12);
  assert.equal(NODE_TYPES.out.weight, 0);
});

test("常数：语法与范围校验", () => {
  assert.equal(checkConstText("1.5").ok, true);
  assert.equal(checkConstText("-0.375").ok, true);
  assert.equal(checkConstText(".5").ok, true);
  assert.equal(checkConstText("1e3").ok, true);
  assert.equal(checkConstText("999999.999").ok, true);
  assert.equal(checkConstText("1e6").ok, true);
  assert.equal(checkConstText("1e7").ok, false);
  assert.equal(checkConstText("-1000000").ok, true);
  assert.equal(checkConstText("1000001").ok, false);
  assert.equal(checkConstText("1e301").ok, false);
  assert.equal(checkConstText("1e4").ok, true);
  assert.equal(checkConstText("abc").ok, false);
  assert.equal(checkConstText("1.2.3").ok, false);
  assert.equal(checkConstText("").ok, false);
  assert.equal(checkConstText("1".repeat(257)).ok, false);
  assert.equal(checkConstText("1e-300").ok, true);
});

test("评分系数 f(W)", () => {
  assert.equal(scoreFactor(100, 160), 1);
  assert.equal(scoreFactor(160, 160), 1);
  assert.equal(scoreFactor(240, 160), 0.5);
  assert.equal(scoreFactor(320, 160), 0);
  assert.equal(scoreFactor(400, 160), 0);
  assert.equal(scoreFactor(10, null), null);
});

test("校验：悬空端口、输入输出数量与未使用节点", () => {
  const g = new Graph();
  const i1 = g.createNode("I");
  const sq = g.createNode("sqrt");
  const out = g.createNode("out", 0, 0, { arity: 1 });
  g.connect(i1.id, sq.id, 0);
  g.connect(sq.id, out.id, 0);

  let res = analyze(g, getLevel("task1"));
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.inputCount, 1);
  assert.equal(res.cost, 8);
  assert.equal(res.factor, 1);
  assert.equal(res.score, 5);
  assert.equal(res.unusedIds.length, 0);

  // 多出一个未使用的输入节点：既违反输入数量，又被标记为未使用
  const i2 = g.createNode("I");
  res = analyze(g, getLevel("task1"));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "inputs"));
  assert.deepEqual(res.unusedIds, [i2.id]);
  assert.ok(res.warnings.some((w) => w.code === "unused"));

  // 断掉输入 -> 悬空
  g.removeMany([i2.id]);
  g.disconnect(sq.id, 0);
  res = analyze(g, getLevel("task1"));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "dangling"));

  // 任务 6 需要两个输入节点
  const res2 = analyze(g, getLevel("task6"));
  assert.ok(res2.errors.some((e) => e.code === "inputs"));
});

test("校验：输出项数不匹配", () => {
  const g = new Graph();
  const i = g.createNode("I");
  const out = g.createNode("out", 0, 0, { arity: 3 });
  g.connect(i.id, out.id, 0);
  g.connect(i.id, out.id, 1);
  g.connect(i.id, out.id, 2);
  const res = analyze(g, getLevel("task9"));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === "out-arity"));
});

test("序列化：题面示例逐字往返", () => {
  const sample = "4\nI\nC 0.75\n* 1 2\nQ 3\nOUT 1 4\n";
  const r = fromProblemText(sample);
  assert.equal(r.graph.size, 5);
  assert.equal(r.graph.cost(), 13);
  assert.equal(toProblemText(r.graph), sample);
});

test("序列化：按拓扑序重编号", () => {
  const g = new Graph();
  const a = g.createNode("add");
  const b = g.createNode("neg");
  const c = g.createNode("I");
  // 故意让 I 的 id 最大，制造非拓扑的 id 顺序
  g.connect(c.id, b.id, 0);
  g.connect(b.id, a.id, 0);
  g.connect(c.id, a.id, 1);
  const out = g.createNode("out");
  g.connect(a.id, out.id, 0);
  const text = toProblemText(g);
  const lines = text.trim().split("\n");
  assert.equal(lines[0], "3");
  assert.match(lines[4], /^OUT 1 [1-3]$/);
  // 每条指令引用的编号必须严格小于自身
  for (let i = 1; i <= 3; i++) {
    const parts = lines[i].split(" ");
    for (let k = 1; k < parts.length; k++) assert.ok(Number(parts[k]) < i);
  }
  const again = toProblemText(fromProblemText(text).graph);
  assert.equal(again, text);
});

test("序列化：拒绝悬空与成环", () => {
  const g = new Graph();
  const i = g.createNode("I");
  const s = g.createNode("sqrt");
  const o = g.createNode("out");
  g.connect(s.id, o.id, 0);
  assert.throws(() => toProblemText(g), (e) => e instanceof GraphFormatError && e.code === "dangling");
  g.connect(i.id, s.id, 0);
  g.nodes.get(i.id).inputs.push(s.id);
  assert.throws(() => toProblemText(g), (e) => e.code === "cycle");
  assert.throws(() => fromProblemText("2\nI\n"), (e) => e.code === "parse");
});

test("序列化：宽松导入非拓扑引用", () => {
  const text = "3\n+ 2 3\nI\nI\nOUT 1 1\n";
  const r = fromProblemText(text);
  assert.equal(r.warnings.length, 2);
  assert.equal(toProblemText(r.graph).trim().split("\n")[0], "3");
});

test("历史：撤销重做与分支截断", () => {
  const h = new History();
  h.reset("A");
  h.push("B", "b");
  h.push("C", "c");
  assert.equal(h.undo(), "B");
  assert.equal(h.undo(), "A");
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), "B");
  h.push("D", "d");
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), "B");
});

test("空间索引：查询与增量更新", () => {
  const grid = new SpatialGrid(100);
  grid.insert(1, { x: 0, y: 0, w: 50, h: 50 });
  grid.insert(2, { x: 500, y: 500, w: 50, h: 50 });
  assert.deepEqual(grid.query(-10, -10, 100, 100).sort(), [1]);
  assert.deepEqual(grid.query(400, 400, 200, 200), [2]);
  grid.update(2, { x: 10, y: 10, w: 50, h: 50 });
  assert.deepEqual(grid.query(-10, -10, 100, 100).sort(), [1, 2]);
  grid.remove(1);
  assert.deepEqual(grid.query(-10, -10, 100, 100), [2]);
});

test("几何：端口位置与连线采样", () => {
  const g = new Graph();
  const n = g.createNode("add", 100, 200);
  const h = nodeHeight(n);
  const w = nodeWidth(n);
  // 新版几何：输入端口在节点上边缘均布，输出端口在下边缘正中。
  assert.equal(h, 34);
  const p0 = portPosition(n, "in", 0);
  const p1 = portPosition(n, "in", 1);
  assert.equal(p0.y, 200);
  assert.equal(p1.y, 200);
  assert.ok(p0.x < p1.x);
  assert.equal(portPosition(n, "out", 0).x, 100 + w / 2);
  assert.equal(portPosition(n, "out", 0).y, 200 + 34);
  const path = wirePath({ x: 0, y: 0 }, { x: 200, y: 0 });
  const mid = cubicPoint(path, 0.5);
  assert.ok(Math.abs(mid.y) < 1e-9);
  assert.ok(mid.x > 0 && mid.x < 200);
  const pts = sampleCubic(path, 16);
  assert.equal(pts.length, 17);
  assert.ok(distanceToPolyline(100, 0, pts) < 1e-6);
  assert.ok(distanceToPolyline(100, 50, pts) > 40);
});

test("关卡数据完整", () => {
  assert.equal(LEVELS.length, 17);
  assert.equal(TASKS.length, 16);
  // 前三关是自制的热身关（points 0）；连续数学九关 100 分、离散数学四关 100 分。
  assert.equal(TASKS.reduce((s, t) => s + t.points, 0), 200);
  // 连续数学九关（T1）与离散数学四关（T2，含最前面的「取整」）各自满分 100。
  assert.equal(TASKS.slice(4, 13).reduce((s, t) => s + t.points, 0), 100);
  assert.equal([TASKS[3], ...TASKS.slice(13)].reduce((s, t) => s + t.points, 0), 100);
  assert.deepEqual(TASKS.slice(0, 3).map((t) => t.key), ["warm1", "warm2", "warm3"]);
  assert.deepEqual(TASKS.slice(13).map((t) => t.key), ["mod", "gcd", "prime"]);
  assert.deepEqual(TASKS.map((t) => t.points), [0, 0, 0, 5, 5, 6, 6, 10, 10, 15, 16, 18, 14, 25, 35, 35]);
  assert.deepEqual(
    TASKS.map((t) => t.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  );
  assert.deepEqual(
    TASKS.map((t) => t.base),
    [3, 2, 6, 1, 160, 1500, 1200, 6200, 9800, 30000, 6000, 30000, 4000, 30000, 160000, 160000]
  );
  assert.deepEqual(
    TASKS.map((t) => t.inputs),
    [2, 1, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 2, 2, 1]
  );
  assert.deepEqual(
    TASKS.map((t) => t.outputs),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 8, 1, 2, 1, 1, 1]
  );
  for (const t of TASKS) {
    assert.ok(t.base > 0);
    assert.ok(t.probes.length > 0);
    for (const p of t.probes) assert.equal(p.length, t.inputs);
  }
  assert.equal(getLevel("nope").key, "sandbox");
  assert.equal(SANDBOX.outputs, null);
  assert.equal(TYPE_ORDER.length, 11);
});

test("真实 std 图：权重与 README 一致，往返稳定", (t) => {
  if (!fs.existsSync(buildDir)) {
    t.skip("build/ 不存在，跳过真实图测试");
    return;
  }
  const expect = { 1: 103, 3: 301, 4: 343, 5: 511, 7: 4273, 8: 16080, 9: 1210 };
  for (const [id, cost] of Object.entries(expect)) {
    const file = path.join(buildDir, "task" + id + ".graph");
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const g = fromProblemText(text).graph;
    assert.equal(g.cost(), cost, "task" + id + " 权重");
    const text2 = toProblemText(g);
    assert.equal(toProblemText(fromProblemText(text2).graph), text2, "task" + id + " 二次导出稳定");
    const res = analyze(g, getLevel("task" + id));
    assert.equal(res.ok, true, "task" + id + " 结构合法: " + JSON.stringify(res.errors));
    assert.equal(res.factor, 1, "task" + id + " 满分");
  }
});