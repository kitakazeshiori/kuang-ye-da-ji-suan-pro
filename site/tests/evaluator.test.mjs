// 高精度求值器测试：
//   * 纯 BigInt 运算与 bigreal.hpp 逐位一致；
//   * exp/sin/cos/sqrt 与 C++ 参考值相对误差 < 1e-60（收敛种子精度差异，见下）；
//   * 用官方 std 计算图 + 官方测试输入，验证 JS 求值器能复现 checker 的通过判定；
//   * 各类非法图（负数开方、超范围、越界值、空端口、输入数不符）都能被拦下。
//
// 说明：inv/sqrt 的收敛种子在 C++ 里用 long double 计算，JS 用 double，二者
// 相差约 1e-20 相对量级，最终落在相差约 1e-70 的定点不动点上——远低于题面
// 1e-45 的容差，因此不影响评测结论。
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Graph } from "../js/core/graph.js";
import { fromProblemText } from "../js/core/serialize.js";
import {
  evaluateGraph,
  gradeAgainstVectors,
  withinTolerance,
  prepare,
  evaluatePlan,
  evaluatePlanAsync,
} from "../js/core/evaluate.js";
import { TASKS } from "../js/core/levels.js";
import {
  parseDecimal,
  sinR,
  cosR,
  expR,
  sqrtR,
  formatReal,
} from "../js/core/bigreal.js";

const DATA = new URL("../data/vectors.json", import.meta.url);
const vectors = JSON.parse(readFileSync(DATA, "utf8"));

function rel(got, want) {
  return Math.abs(got.ld() - want.ld()) / Math.max(1, Math.abs(want.ld()));
}

test("parseDecimal 与 C++ Real::decimal 输出一致", () => {
  assert.equal(
    parseDecimal("1.5").toString(),
    "1.5" + "0".repeat(71)
  );
  assert.equal(parseDecimal("-1.5e2").toString(), "-150." + "0".repeat(72));
  assert.equal(
    parseDecimal("1e-45").toString(),
    "0." + "0".repeat(44) + "1" + "0".repeat(27)
  );
  assert.equal(parseDecimal("0").toString(), "0");
  assert.equal(parseDecimal("2").toString(), "2." + "0".repeat(72));
});

test("定点乘法向零截断，与 shiftDown(8) 一致", () => {
  const a = parseDecimal("1.234567890123456789012345678901234567890123456789012345678901234567890123456789");
  const b = parseDecimal("0.0000000000000000000000000000000000000000000000000000000000000000000000012345");
  assert.equal(a.mul(b).toString(), "0." + "0".repeat(71) + "1");
  // 0.33…3（72 个 3）= (10^72-1)/3，乘 3 后应得到 72 个 9，而不是 1
  const third = parseDecimal("0." + "3".repeat(72));
  assert.equal(third.mul(parseDecimal("3")).toString(), "0." + "9".repeat(72));
});

test("exp/sin/cos/sqrt 与 C++ bigreal.hpp 一致（相对误差 < 1e-60）", () => {
  const p = parseDecimal;
  const cases = [
    [sinR(p("1")), "0.841470984807896506652502321630298999622563060798371065672751709991910407"],
    [cosR(p("1")), "0.540302305868139717400936607442976603732310420617922227670097255381100394"],
    [sinR(p("-2.5")), "-0.598472144103956494051854702186162271703597171577223573302627032638744272"],
    [expR(p("1")), "2.718281828459045235360287471352662497757247093699959574966967627724075976"],
    [expR(p("-3")), "0.049787068367863942979342415650061776631699592188423215567627727606060667"],
    [sqrtR(p("2")), "1.414213562373095048801688724209698078569671875376948073176679737990732478"],
    [sqrtR(p("1000000")), "999.999999999999999999999999999999999999999999999999999999999999999999937500"],
  ];
  for (const [got, want] of cases) {
    const w = parseDecimal(want);
    assert.ok(withinTolerance(got, w), "超出 1e-45 容差: " + got.toString());
    assert.ok(rel(got, w) < 1e-60, "相对误差过大: " + rel(got, w).toExponential(3));
  }
});

test("离散数学四关：T2 官方图在生成的参考向量上全部通过", (t) => {
  const t2 = new URL("../../../T2/build/", import.meta.url);
  if (!existsSync(t2)) {
    t.skip("T2/build 不存在，跳过");
    return;
  }
  for (const [n, key] of [[1, "floor"], [2, "mod"], [3, "gcd"], [4, "prime"]]) {
    const { graph } = fromProblemText(readFileSync(new URL("task" + n + ".graph", t2), "utf8"));
    const r = gradeAgainstVectors(graph, vectors[key]);
    assert.ok(
      r.ok,
      key + " 未通过: " + r.passed + "/" + r.total + (r.error ? " 求值错误 " + r.error.code : "")
    );
  }
});

test("每个关卡都有参考向量，且输入/输出元数与关卡一致", () => {
  for (const t of TASKS) {
    const v = vectors[t.key];
    assert.ok(v, `缺少 ${t.key} 的参考向量（跑 node tools/gen_vectors.mjs / gen_warmup_vectors.mjs）`);
    assert.equal(v.inputs, t.inputs, t.key + " 输入元数");
    assert.equal(v.outputs, t.outputs, t.key + " 输出元数");
    assert.ok(v.cases.length > 0, t.key + " 没有测试组");
    for (const c of v.cases) {
      assert.equal(c.inputs.length, t.inputs, t.key + " 测试输入元数");
      assert.equal(c.expected.length, t.outputs, t.key + " 参考输出个数");
    }
  }
});

const BUILD = new URL("../../build/", import.meta.url);

test("官方 std 图在官方测试输入上通过全部 9 个任务", (t) => {
  if (!existsSync(BUILD)) {
    t.skip("build/ 不存在（公开仓库不含官方图），跳过");
    return;
  }
  for (let task = 1; task <= 9; task++) {
    const text = readFileSync(new URL(`../../build/task${task}.graph`, import.meta.url), "utf8");
    const { graph } = fromProblemText(text);
    const r = gradeAgainstVectors(graph, vectors["task" + task]);
    assert.ok(
      r.ok,
      `task${task} 未通过: ${r.passed}/${r.total}` +
        (r.error ? ` 求值错误 ${r.error.code} @${r.failedAt}` : "")
    );
  }
});

test("换错任务的参考值时判定失败（防止误判为通过）", (t) => {
  if (!existsSync(BUILD)) {
    t.skip("build/ 不存在，跳过");
    return;
  }
  const { graph } = fromProblemText(
    readFileSync(new URL("../../build/task1.graph", import.meta.url), "utf8")
  );
  const r = gradeAgainstVectors(graph, vectors.task2);
  assert.equal(r.ok, false);
  assert.ok(r.passed < r.total);
});

test("负数开方被拦下", () => {
  const g = new Graph();
  const c = g.createNode("C", 0, 0, { value: "-1" });
  const q = g.createNode("sqrt", 0, 0);
  const o = g.createNode("out", 0, 0, { arity: 1 });
  g.connect(c.id, q.id, 0);
  g.connect(q.id, o.id, 0);
  const r = evaluateGraph(g, []);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "sqrt-negative");
});

test("未连接到输出的节点同样会执行并计入检查", () => {
  const g = new Graph();
  const x = g.createNode("I", 0, 0);
  const q = g.createNode("sqrt", 0, 0);
  g.createNode("C", 0, 0, { value: "-4" }); // 悬空常数节点
  const bad = g.createNode("sqrt", 0, 0);
  bad.inputs[0] = 3; // 直接接到 -4
  const o = g.createNode("out", 0, 0, { arity: 1 });
  g.connect(x.id, q.id, 0);
  g.connect(q.id, o.id, 0);
  const r = evaluateGraph(g, ["1"]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "sqrt-negative");
});

test("溢出 1e60、三角函数与 exp 自变量越界都被拦下", () => {
  const tooBig = new Graph();
  const i1 = tooBig.createNode("I", 0, 0);
  const m = tooBig.createNode("mul", 0, 0);
  const o1 = tooBig.createNode("out", 0, 0, { arity: 1 });
  m.inputs[0] = i1.id;
  m.inputs[1] = i1.id;
  tooBig.connect(m.id, o1.id, 0);
  const r1 = evaluateGraph(tooBig, ["1e60"]);
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, "oversized");

  const trig = new Graph();
  const c = trig.createNode("C", 0, 0, { value: "1000000" });
  const s = trig.createNode("sin", 0, 0);
  const o2 = trig.createNode("out", 0, 0, { arity: 1 });
  trig.connect(c.id, s.id, 0);
  trig.connect(s.id, o2.id, 0);
  assert.equal(evaluateGraph(trig, []).error.code, "trig-range");

  const ex = new Graph();
  const c2 = ex.createNode("C", 0, 0, { value: "100" });
  const e = ex.createNode("exp", 0, 0);
  const o3 = ex.createNode("out", 0, 0, { arity: 1 });
  ex.connect(c2.id, e.id, 0);
  ex.connect(e.id, o3.id, 0);
  assert.equal(evaluateGraph(ex, []).error.code, "exp-range");
});

test("空端口与输入数量不符都能被拦下", () => {
  const g = new Graph();
  const i1 = g.createNode("I", 0, 0);
  const a = g.createNode("add", 0, 0);
  const o = g.createNode("out", 0, 0, { arity: 1 });
  g.connect(i1.id, a.id, 0);
  g.connect(a.id, o.id, 0); // add 的第二个端口空着
  assert.equal(evaluateGraph(g, ["1", "2"]).error.code, "dangling");

  const g2 = new Graph();
  const x = g2.createNode("I", 0, 0);
  const o2 = g2.createNode("out", 0, 0, { arity: 1 });
  g2.connect(x.id, o2.id, 0);
  assert.equal(evaluateGraph(g2, ["1", "2"]).error.code, "inputs");
  assert.equal(evaluateGraph(g2, []).error.code, "inputs");
});

test("非法常数文本被拦下", () => {
  const g = new Graph();
  const c = g.createNode("C", 0, 0, { value: "1.2.3" });
  const o = g.createNode("out", 0, 0, { arity: 1 });
  g.connect(c.id, o.id, 0);
  assert.equal(evaluateGraph(g, []).error.code, "bad-const");
});

test("withinTolerance 与容差边界一致", () => {
  const want = parseDecimal("1000");
  const tol = parseDecimal("1e-45");
  assert.ok(withinTolerance(want.add(tol.mul(parseDecimal("1000"))), want));
  assert.ok(!withinTolerance(want.add(tol.mul(parseDecimal("1000")).mul(parseDecimal("2"))), want));
});

test("prepare + evaluatePlan 可复用同一张图的拓扑序", (t) => {
  if (!existsSync(BUILD)) {
    t.skip("build/ 不存在，跳过");
    return;
  }
  const { graph } = fromProblemText(
    readFileSync(new URL("../../build/task3.graph", import.meta.url), "utf8")
  );
  const prep = prepare(graph);
  assert.ok(!prep.error);
  const r = evaluatePlan(prep.plan, prep.out, vectors.task3.cases[0].inputs);
  assert.ok(r.ok);
  assert.ok(withinTolerance(r.outputs[0], parseDecimal(vectors.task3.cases[0].expected[0])));
  assert.equal(typeof formatReal(r.outputs[0]), "string");
});

test("分片求值：与同步求值完全一致，并能分片让出事件循环", async () => {
  const g = new Graph();
  const x = g.createNode("I");
  let cur = x.id;
  for (let i = 0; i < 300; i++) {
    const n = g.createNode("neg");
    g.connect(cur, n.id, 0);
    cur = n.id;
  }
  const o = g.createNode("out", 0, 0, { arity: 1 });
  g.connect(cur, o.id, 0);

  const prep = prepare(g);
  const sync = evaluatePlan(prep.plan, prep.out, ["1.5"]);
  assert.equal(sync.ok, true, sync.error && sync.error.message);

  const progress = [];
  const asyncRes = await evaluatePlanAsync(prep.plan, prep.out, ["1.5"], {
    chunkSize: 200,
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(asyncRes.ok, true, asyncRes.error && asyncRes.error.message);
  assert.equal(String(asyncRes.outputs[0]), String(sync.outputs[0]));
  assert.deepEqual(
    [...asyncRes.values.keys()].sort((a, b) => a - b),
    [...sync.values.keys()].sort((a, b) => a - b)
  );
  // 301 个节点 / 每片 200 → 中途让出一次，收尾再报一次
  assert.deepEqual(progress[0], [200, prep.plan.length]);
  assert.deepEqual(progress[progress.length - 1], [prep.plan.length, prep.plan.length]);

  // 手动求值允许没有输出端子（调试中间值）
  const noOut = await evaluatePlanAsync(prep.plan, null, ["1.5"], {});
  assert.equal(noOut.ok, true, noOut.error && noOut.error.message);
  assert.deepEqual(noOut.outputs, []);
  assert.equal(noOut.values.size, sync.values.size);
});
