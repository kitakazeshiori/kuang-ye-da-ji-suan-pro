// 函数打包 / 函数库 / 宏展开单测。
import test from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../js/core/graph.js";
import {
  FunctionLibrary,
  buildFunctionDef,
  expandGraph,
  expandCallInPlace,
  resultCandidates,
} from "../js/core/functions.js";
import { evaluateGraph } from "../js/core/evaluate.js";
import { toProblemText } from "../js/core/serialize.js";
import { nodeWidth, nodeHeight } from "../js/core/geometry.js";

// 模拟 App.applyPack：把打包计划落到画布上，返回调用节点。
function applyPlan(g, def, plan) {
  const call = g.createNode("fn", 0, 0, { fn: def.name, arity: def.params });
  for (let k = 0; k < plan.paramSources.length; k++) {
    const src = plan.paramSources[k];
    if (src !== null && src !== undefined) call.inputs[k] = src;
  }
  for (const node of g.nodes.values()) {
    if (node.id === call.id) continue;
    for (let p = 0; p < node.inputs.length; p++) {
      if (node.inputs[p] === plan.result) node.inputs[p] = call.id;
    }
  }
  g.removeMany(plan.removed);
  g.touch();
  return call;
}

function rebuild(spec) {
  const g = new Graph();
  const n = {};
  for (const s of spec.nodes) n[s[0]] = g.createNode(s[1], s[2] || 0, s[3] || 0, s[4] || {});
  for (const s of spec.nodes) {
    const node = g.get(n[s[0]].id);
    (s[5] || []).forEach((src, i) => {
      if (src !== null && src !== undefined) node.inputs[i] = n[src].id;
    });
  }
  return { g, n };
}

test("打包：x*2 抽成函数后就地变成调用节点，展开后数值与权重不变", () => {
  const { g, n } = rebuild({
    nodes: [["x", "I"], ["c", "C", 0, 120, { value: "2" }], ["m", "mul", 200, 0, {}, ["x", "c"]], ["o", "out", 400, 0, { arity: 1 }, ["m"]]],
  });
  const r = buildFunctionDef(g, [n.x.id, n.c.id, n.m.id], "dbl", null, null);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.def.params, 1);
  assert.equal(r.def.weight, 5); // C + mul（参数 I 不算权重）
  assert.deepEqual(r.plan.paramSources, [n.x.id]);
  assert.deepEqual(r.plan.removed.slice().sort((a, b) => a - b), [n.c.id, n.m.id].sort((a, b) => a - b));

  const call = applyPlan(g, r.def, r.plan);
  assert.equal(n.o.inputs[0], call.id);
  assert.equal(g.size, 3); // I + 调用 + out

  const lib = new FunctionLibrary([r.def]);
  const ex = expandGraph(g, lib);
  assert.equal(ex.ok, true, ex.error);
  assert.equal(ex.graph.size, 4); // I + C + mul + out
  assert.equal(ex.graph.cost(), 6);
  const ev = evaluateGraph(ex.graph, ["3"]);
  assert.equal(ev.ok, true);
  assert.equal(ev.outputs[0].ld(), 6);
  assert.match(toProblemText(ex.graph), /OUT 1 \d+/);
});

test("打包：输入节点本身就是结果时得到恒等函数", () => {
  const { g, n } = rebuild({ nodes: [["x", "I"], ["o", "out", 200, 0, { arity: 1 }, ["x"]]] });
  const r = buildFunctionDef(g, [n.x.id], "id", null, null);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.def.params, 1);
  assert.equal(r.def.weight, 0); // 恒等函数：展开不新增任何节点
  assert.deepEqual(r.plan.removed, []);
  const call = applyPlan(g, r.def, r.plan);
  assert.equal(n.o.inputs[0], call.id);
  const ex = expandGraph(g, new FunctionLibrary([r.def]));
  assert.equal(ex.ok, true, ex.error);
  assert.equal(evaluateGraph(ex.graph, ["7"]).outputs[0].ld(), 7);
});

test("展开：函数可以调用别的函数，W 按展开后的节点数计", () => {
  const a = rebuild({ nodes: [["x", "I"], ["c", "C", 0, 120, { value: "2" }], ["m", "mul", 200, 0, {}, ["x", "c"]], ["o", "out", 400, 0, { arity: 1 }, ["m"]]] });
  const ra = buildFunctionDef(a.g, [a.n.x.id, a.n.c.id, a.n.m.id], "dbl", null, null);
  const lib = new FunctionLibrary([ra.def]);

  const b = rebuild({ nodes: [["x", "I"], ["c", "C", 0, 120, { value: "3" }], ["f", "fn", 200, 0, { fn: "dbl", arity: 1 }, ["x"]], ["m", "mul", 400, 0, {}, ["f", "c"]], ["o", "out", 600, 0, { arity: 1 }, ["m"]]] });
  const rb = buildFunctionDef(b.g, [b.n.x.id, b.n.c.id, b.n.f.id, b.n.m.id], "six", null, lib);
  assert.equal(rb.ok, true, rb.error);
  // dbl 的参数复用同一个 I 节点：C3 + (C2 + mul) + mul = 10（参数 I 不算权重）
  assert.equal(rb.def.weight, 10);
  lib.set(rb.def);

  const ex = expandGraph(b.g, lib);
  assert.equal(ex.ok, true, ex.error);
  assert.equal(evaluateGraph(ex.graph, ["5"]).outputs[0].ld(), 30); // (5*2)*3
  assert.equal(ex.graph.cost(), 11);
});

test("展开：递归调用与缺失函数都会被拦下", () => {
  const mk = (self, other) => {
    const g = new Graph();
    const i = g.createNode("I");
    const f = g.createNode("fn", 0, 100, { fn: other, arity: 1 });
    const o = g.createNode("out", 0, 200, { arity: 1 });
    g.connect(i.id, f.id, 0);
    g.connect(f.id, o.id, 0);
    return g;
  };
  const lib = new FunctionLibrary();
  lib.set({ name: "a", params: 1, body: mk("a", "b").toJSON() });
  lib.set({ name: "b", params: 1, body: mk("b", "a").toJSON() });
  const caller = rebuild({ nodes: [["x", "I"], ["f", "fn", 0, 0, { fn: "a", arity: 1 }, ["x"]], ["o", "out", 200, 0, { arity: 1 }, ["f"]]] });
  const ex = expandGraph(caller.g, lib);
  assert.equal(ex.ok, false);
  assert.match(ex.error, /递归/);

  const miss = rebuild({ nodes: [["x", "I"], ["f", "fn", 0, 0, { fn: "nope", arity: 1 }, ["x"]], ["o", "out", 200, 0, { arity: 1 }, ["f"]]] });
  const ex2 = expandGraph(miss.g, lib);
  assert.equal(ex2.ok, false);
  assert.match(ex2.error, /不存在/);
});

test("展开：参数没连线会报错", () => {
  const a = rebuild({ nodes: [["x", "I"], ["c", "C", 0, 120, { value: "2" }], ["m", "mul", 200, 0, {}, ["x", "c"]], ["o", "out", 400, 0, { arity: 1 }, ["m"]]] });
  const ra = buildFunctionDef(a.g, [a.n.x.id, a.n.c.id, a.n.m.id], "dbl", null, null);
  const lib = new FunctionLibrary([ra.def]);
  const g = new Graph();
  const c = g.createNode("fn", 0, 0, { fn: "dbl", arity: 1 });
  const o = g.createNode("out", 200, 0, { arity: 1 });
  g.connect(c.id, o.id, 0);
  const ex = expandGraph(g, lib);
  assert.equal(ex.ok, false);
  assert.match(ex.error, /没有连线/);
});

test("就地展开：调用节点被函数体取代，下游结果不变", () => {
  const a = rebuild({ nodes: [["x", "I"], ["c", "C", 0, 120, { value: "2" }], ["m", "mul", 200, 0, {}, ["x", "c"]], ["o", "out", 400, 0, { arity: 1 }, ["m"]]] });
  const ra = buildFunctionDef(a.g, [a.n.x.id, a.n.c.id, a.n.m.id], "dbl", null, null);
  const lib = new FunctionLibrary([ra.def]);

  const { g, n } = rebuild({ nodes: [["x", "I"], ["f", "fn", 0, 200, { fn: "dbl", arity: 1 }, ["x"]], ["o", "out", 300, 0, { arity: 1 }, ["f"]]] });
  const before = evaluateGraph(expandGraph(g, lib).graph, ["4"]).outputs[0].ld();
  const res = expandCallInPlace(g, n.f.id, lib);
  assert.equal(res.ok, true, res.error);
  assert.equal(g.has(n.f.id), false);
  assert.equal(res.ids.length, 2); // C + mul
  assert.equal(n.o.inputs[0], res.outSrc);
  const flat = evaluateGraph(g, ["4"]);
  assert.equal(flat.ok, true);
  assert.equal(flat.outputs[0].ld(), before);
});

test("打包：输出端子不能入包，多个出口会被拒绝", () => {
  const { g, n } = rebuild({ nodes: [["x", "I"], ["o", "out", 200, 0, { arity: 1 }, ["x"]]] });
  const bad = buildFunctionDef(g, [n.x.id, n.o.id], "bad", null, null);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /输出端子/);

  const two = rebuild({
    nodes: [
      ["x", "I"],
      ["m1", "neg", 100, 100, {}, ["x"]],
      ["m2", "neg", 100, 200, {}, ["x"]],
      ["o", "out", 300, 0, { arity: 1 }, ["m1"]],
      ["o2", "out", 300, 200, { arity: 1 }, ["m2"]],
    ],
  });
  const r = buildFunctionDef(two.g, [two.n.x.id, two.n.m1.id, two.n.m2.id], "two", null, null);
  assert.equal(r.ok, false);
  assert.match(r.error, /个不同的出口/);
});

test("结果候选：优先选流向选区外的节点", () => {
  const { g, n } = rebuild({
    nodes: [["x", "I"], ["m", "neg", 100, 0, {}, ["x"]], ["t", "add", 200, 0, {}, ["m", "m"]], ["o", "out", 300, 0, { arity: 1 }, ["t"]]],
  });
  assert.deepEqual(resultCandidates(g, [n.m.id, n.t.id]), [n.t.id]);
  assert.deepEqual(resultCandidates(g, [n.m.id]), [n.m.id]);
});

test("图形序列化会保留函数调用节点", () => {
  const g = new Graph();
  const c = g.createNode("fn", 10, 20, { fn: "dbl", arity: 2 });
  const back = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  const node = back.get(c.id);
  assert.equal(node.type, "fn");
  assert.equal(node.fn, "dbl");
  assert.equal(node.inputs.length, 2);
  assert.equal(back.nodes.get(c.id).fn, "dbl");
});

test("函数库：增删改查与 JSON 往返", () => {
  const lib = new FunctionLibrary();
  const body = new Graph();
  const i = body.createNode("I");
  const o = body.createNode("out", 0, 100, { arity: 1 });
  body.connect(i.id, o.id, 0);
  lib.set({ name: "id", params: 1, body: body.toJSON() });
  assert.equal(lib.size, 1);
  assert.equal(lib.get("id").params, 1);
  assert.equal(lib.get("id").weight, 0);
  const clone = FunctionLibrary.fromJSON({ functions: lib.toJSON() });
  assert.equal(clone.size, 1);
  assert.equal(clone.get("id").weight, 0);
  assert.equal(clone.delete("id"), true);
  assert.equal(clone.size, 0);
});

test("打包：悬空输入端口各自变成一个参数，不会有孤儿参数", () => {
  // 三个 add，上面两个的输出接进下面那个（对应用户截图 fn4add.png 的结构）
  const { g, n } = rebuild({
    nodes: [
      ["a0", "add", 0, 0],
      ["a1", "add", 300, 0],
      ["a2", "add", 150, 200, {}, ["a0", "a1"]],
      ["o", "out", 150, 400, { arity: 1 }, ["a2"]],
    ],
  });
  const r = buildFunctionDef(g, [n.a0.id, n.a1.id, n.a2.id], "four", null, null);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.def.params, 4); // 4 个悬空端口 = 4 个参数
  assert.deepEqual(r.plan.paramSources, [null, null, null, null]);
  assert.equal(r.def.weight, 3); // 3 个 add（4 个参数 I 不算权重）

  // 函数体里每个参数都能用上，且没有悬空端口（否则参数就是摆设）
  const body = Graph.fromJSON(r.def.body);
  const used = new Set();
  for (const node of body.nodes.values()) for (const src of node.inputs) if (src !== null) used.add(src);
  for (const pid of body.inputNodes().map((x) => x.id)) assert.equal(used.has(pid), true, "参数 #" + pid + " 没被使用");
  const dangling = [];
  for (const node of body.nodes.values()) {
    if (node.type === "out") continue;
    node.inputs.forEach((src, i) => {
      if (src === null) dangling.push(node.id + ":" + i);
    });
  }
  assert.deepEqual(dangling, []);

  // 落地成调用节点：端口先留空，接线后展开求值 (1+2)+(3+4) = 10
  const call = applyPlan(g, r.def, r.plan);
  assert.equal(call.inputs.length, 4);
  assert.deepEqual(call.inputs, [null, null, null, null]);
  const xs = [1, 2, 3, 4].map((k) => g.createNode("I", k * 100, 600));
  xs.forEach((x, k) => (call.inputs[k] = x.id));
  const ex = expandGraph(g, new FunctionLibrary([r.def]));
  assert.equal(ex.ok, true, ex.error);
  assert.equal(ex.graph.cost(), 7);
  assert.equal(evaluateGraph(ex.graph, ["1", "2", "3", "4"]).outputs[0].ld(), 10);
});

test("打包：同一个外部来源只算一个参数", () => {
  const { g, n } = rebuild({
    nodes: [
      ["x", "I"],
      ["m", "mul", 200, 0, {}, ["x", "x"]],
      ["o", "out", 400, 0, { arity: 1 }, ["m"]],
    ],
  });
  const r = buildFunctionDef(g, [n.m.id], "sq", null, null);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.def.params, 1);
  assert.deepEqual(r.plan.paramSources, [n.x.id]);
  const call = applyPlan(g, r.def, r.plan);
  assert.equal(call.inputs.length, 1);
  assert.equal(call.inputs[0], n.x.id);
  assert.equal(n.o.inputs[0], call.id);
  const ex = expandGraph(g, new FunctionLibrary([r.def]));
  assert.equal(ex.ok, true, ex.error);
  const v = evaluateGraph(ex.graph, ["5"]).outputs[0].ld();
  assert.ok(Math.abs(v - 25) < 1e-9, "5*5 = " + v);
});

test("展开为节点：没连线的端口保持没连线（空展开）", () => {
  const a = rebuild({ nodes: [["x", "I"], ["c", "C", 0, 120, { value: "2" }], ["m", "mul", 200, 0, {}, ["x", "c"]], ["o", "out", 400, 0, { arity: 1 }, ["m"]]] });
  const ra = buildFunctionDef(a.g, [a.n.x.id, a.n.c.id, a.n.m.id], "dbl", null, null);
  const lib = new FunctionLibrary([ra.def]);
  const g = new Graph();
  const call = g.createNode("fn", 0, 0, { fn: "dbl", arity: 1 }); // 端口一个都不连
  const res = expandCallInPlace(g, call.id, lib);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.ids.length, 2); // 常量节点和 mul 被铺出来（输入节点是参数，不铺）
  assert.equal(g.get(res.ids[0]).type, "C");
  assert.equal(res.dangling, 1); // mul 的参数端口没连线
  const mul = g.get(res.outSrc);
  assert.equal(mul.type, "mul");
  assert.equal(mul.inputs[0], null);
  assert.equal(mul.inputs[1], res.ids[0]);
  assert.equal(g.has(call.id), false);
});

test("展开为节点：直通函数不会凭空消失，下游直接接到来源", () => {
  const a = rebuild({ nodes: [["x", "I"], ["o", "out", 200, 0, { arity: 1 }, ["x"]]] });
  const ra = buildFunctionDef(a.g, [a.n.x.id], "id", null, null);
  const lib = new FunctionLibrary([ra.def]);
  const g = new Graph();
  const x = g.createNode("I");
  const call = g.createNode("fn", 0, 0, { fn: "id", arity: 1 });
  const o = g.createNode("out", 200, 0, { arity: 1 });
  g.connect(x.id, call.id, 0);
  g.connect(call.id, o.id, 0);
  const res = expandCallInPlace(g, call.id, lib);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.ids, []); // 函数体没有内部节点
  assert.equal(res.outSrc, x.id);
  assert.equal(o.inputs[0], x.id); // 下游没被丢掉
  assert.equal(g.has(call.id), false);
});

test("中转节点：W0 直通，导出时被省略", () => {
  const g = new Graph();
  const x = g.createNode("I");
  const w1 = g.createNode("wire", 0, 100);
  const w2 = g.createNode("wire", 0, 160);
  const o = g.createNode("out", 0, 220, { arity: 1 });
  g.connect(x.id, w1.id, 0);
  g.connect(w1.id, w2.id, 0);
  g.connect(w2.id, o.id, 0);
  assert.equal(g.cost(), 1); // 中转是 W0
  const ev = evaluateGraph(g, ["2.5"]);
  assert.equal(ev.ok, true, ev.error);
  assert.equal(ev.outputs[0].ld(), 2.5);
  // 导出：中转被穿透，只剩输入节点一条指令
  assert.equal(toProblemText(g), "1\nI\nOUT 1 1\n");
});

test("中转节点：没连线的中转导出时报错", () => {
  const g = new Graph();
  const w = g.createNode("wire", 0, 0);
  const o = g.createNode("out", 0, 100, { arity: 1 });
  g.connect(w.id, o.id, 0);
  assert.throws(() => toProblemText(g));
});

test("展开为节点：原地展开，包围盒中心落在调用节点上", () => {
  const a = rebuild({ nodes: [["x", "I"], ["c", "C", 0, 120, { value: "2" }], ["m", "mul", 200, 0, {}, ["x", "c"]], ["o", "out", 400, 0, { arity: 1 }, ["m"]]] });
  const ra = buildFunctionDef(a.g, [a.n.x.id, a.n.c.id, a.n.m.id], "dbl", null, null);
  const lib = new FunctionLibrary([ra.def]);
  const g = new Graph();
  const src = g.createNode("I", 0, -400);
  const call = g.createNode("fn", 1200, 900, { fn: "dbl", arity: 1 });
  const o = g.createNode("out", 1600, 900, { arity: 1 });
  g.connect(src.id, call.id, 0);
  g.connect(call.id, o.id, 0);
  const res = expandCallInPlace(g, call.id, lib);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.ids.length, 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of res.ids) {
    const n = g.get(id);
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + nodeWidth(n));
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + nodeHeight());
  }
  const wantX = call.x + nodeWidth(call) / 2;
  const wantY = call.y + nodeHeight() / 2;
  assert.ok(Math.abs((minX + maxX) / 2 - wantX) <= 1, "x 中心偏了：" + (minX + maxX) / 2 + " vs " + wantX);
  assert.ok(Math.abs((minY + maxY) / 2 - wantY) <= 1, "y 中心偏了：" + (minY + maxY) / 2 + " vs " + wantY);
});
