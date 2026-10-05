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
  assert.equal(r.def.weight, 6); // I + C + mul
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
  assert.equal(r.def.weight, 1);
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
  // dbl 的参数复用同一个 I 节点，展开后不会再多一个输入节点：I + C3 + (C2 + mul) + mul = 11
  assert.equal(rb.def.weight, 11);
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
  assert.equal(lib.get("id").weight, 1);
  const clone = FunctionLibrary.fromJSON({ functions: lib.toJSON() });
  assert.equal(clone.size, 1);
  assert.equal(clone.get("id").weight, 1);
  assert.equal(clone.delete("id"), true);
  assert.equal(clone.size, 0);
});