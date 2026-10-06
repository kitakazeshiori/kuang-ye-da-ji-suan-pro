// 计算图求值器：把编辑器里的 DAG 按题面语义算成高精度实数。
//
// 与 checker 的逐节点执行严格对应：
//   * 所有节点都会执行（包括没被 OUT 引用的节点），所以它们同样计入权重；
//   * 每个中间值都要满足 |value| <= 1e60；
//   * S/T 自变量 |x| < 1e6，E 自变量 |x| < 100，Q 自变量 >= 0；
//   * 常数节点绝对值 <= 1e6；
//   * I 节点按拓扑序依次吃输入，数量必须与测试输入完全一致；
//   * 判定 |got - want| <= 1e-45 * max(1, |want|)。
//
// 数值原语来自 bigreal.js（原生 BigInt，72 位定点），与 bigreal.hpp 对齐。
import { NODE_TYPES } from "./types.js";
import { Real, parseDecimal, expR, sinR, cosR, sqrtR, formatReal } from "./bigreal.js";

const DEC_RE = /^[-+]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$/;

export const TOLERANCE = parseDecimal("1e-45");
const MAX_CONST = Real.fromInt(1000000);
const MAX_VALUE = parseDecimal("1e60");
const TRIG_LIMIT = Real.fromInt(1000000);
const EXP_LIMIT = Real.fromInt(100);
const ONE = parseDecimal("1");

function fail(code, nodeId, message) {
  return { ok: false, error: { code, nodeId, message } };
}

// 预处理：拓扑序 + 只保留可执行节点（OUT 单独处理）。一个图只需做一次。
export function prepare(graph) {
  const order = graph.topoOrder();
  if (order === null) return { error: { code: "cycle", message: "图中存在环，无法求值" } };
  const outNodes = graph.outNodes();
  if (outNodes.length !== 1) return { error: { code: "out", message: "需要恰好一个输出节点" } };
  const plan = [];
  for (const id of order) {
    const node = graph.get(id);
    const t = NODE_TYPES[node.type];
    if (!t) return { error: { code: "type", nodeId: id, message: "未知节点类型：" + node.type } };
    if (t.isOutput) continue;
    plan.push({ node, t });
  }
  return { plan, out: outNodes[0] };
}

// 单次求值。inputValues 可以是字符串数组或 Real 数组。
export function evaluatePlan(plan, out, inputValues) {
  const inputs = inputValues.map((x) => (x instanceof Real ? x : parseDecimal(x)));
  const values = new Map();
  let p = 0;

  for (const { node, t } of plan) {
    let value;
    if (node.type === "I") {
      if (p >= inputs.length) return fail("inputs", node.id, "输入节点多于测试输入");
      value = inputs[p++];
    } else if (node.type === "C") {
      const text = String(node.value === undefined || node.value === null ? "" : node.value).trim();
      if (!DEC_RE.test(text)) return fail("bad-const", node.id, "常数不是合法十进制：" + text);
      value = parseDecimal(text);
      if (MAX_CONST.cmp(value.abs()) < 0) return fail("const-range", node.id, "常数绝对值超过 1e6");
    } else {
      const args = [];
      for (const s of node.inputs) {
        if (s === null) return fail("dangling", node.id, "节点 #" + node.id + " 有输入端未连线");
        const v = values.get(s);
        if (v === undefined) return fail("order", node.id, "节点 #" + node.id + " 引用了非拓扑序节点");
        args.push(v);
      }
      switch (node.type) {
        case "add":
          value = args[0].add(args[1]);
          break;
        case "neg":
          value = args[0].neg();
          break;
        case "mul":
          value = args[0].mul(args[1]);
          break;
        case "wire":
          value = args[0]; // 空节点：输出等于输入
          break;
        case "sin":
        case "cos":
          if (!(args[0].abs().cmp(TRIG_LIMIT) < 0)) return fail("trig-range", node.id, "三角函数自变量绝对值不小于 1e6");
          value = node.type === "sin" ? sinR(args[0]) : cosR(args[0]);
          break;
        case "exp":
          if (!(args[0].abs().cmp(EXP_LIMIT) < 0)) return fail("exp-range", node.id, "exp 自变量绝对值不小于 100");
          value = expR(args[0]);
          break;
        case "sqrt":
          if (args[0].negative()) return fail("sqrt-negative", node.id, "负数开平方");
          value = sqrtR(args[0]);
          break;
        default:
          return fail("type", node.id, "未知操作：" + node.type);
      }
    }
    if (MAX_VALUE.cmp(value.abs()) < 0) return fail("oversized", node.id, "节点 #" + node.id + " 的中间值绝对值超过 1e60");
    values.set(node.id, value);
  }

  if (p !== inputs.length) return fail("inputs", null, "输入节点数量与测试输入数量不一致");
  const outputs = [];
  for (const s of out.inputs) {
    if (s === null) return fail("dangling", out.id, "输出端未连线");
    const v = values.get(s);
    if (v === undefined) return fail("order", out.id, "输出引用了不可用节点");
    outputs.push(v);
  }
  // values 里带着每个节点（含中间值）的求值结果，界面可以查看任意节点的内部数值。
  return { ok: true, outputs, values };
}

// 便捷入口：一次性求值（图 + 输入）。
export function evaluateGraph(graph, inputValues) {
  const prep = prepare(graph);
  if (prep.error) return { ok: false, error: prep.error };
  return evaluatePlan(prep.plan, prep.out, inputValues);
}

// 判定 |got - want| <= 1e-45 * max(1, |want|)，与 checker 完全一致。
export function withinTolerance(got, want) {
  let scale = want.abs();
  if (scale.cmp(ONE) < 0) scale = ONE;
  return TOLERANCE.mul(scale).cmp(got.sub(want).abs()) >= 0;
}

function gradeCase(prep, testCase) {
  const r = evaluatePlan(prep.plan, prep.out, testCase.inputs);
  if (!r.ok) return { evaluateError: r.error };
  const expected = testCase.expected || [];
  const outputs = [];
  let ok = r.outputs.length === expected.length;
  let worst = 0;
  for (let j = 0; j < expected.length; j++) {
    const want = parseDecimal(expected[j]);
    const got = r.outputs[j];
    if (got === undefined) {
      ok = false;
      outputs.push({ ok: false, got: null, want: formatReal(want) });
      continue;
    }
    const good = withinTolerance(got, want);
    ok = ok && good;
    const wn = want.ld();
    const rel = Math.abs(got.ld() - wn) / Math.max(1, Math.abs(wn));
    if (Number.isFinite(rel) && rel > worst) worst = rel;
    outputs.push({ ok: good, got: formatReal(got), want: formatReal(want) });
  }
  return { ok, outputs, worst };
}

// 同步评测全部测试向量。返回通过数、每组明细与最大相对误差。
export function gradeAgainstVectors(graph, vectors) {
  const prep = prepare(graph);
  if (prep.error) return { ok: false, passed: 0, total: 0, details: [], error: prep.error, worst: null };
  const cases = (vectors && vectors.cases) || [];
  const details = [];
  let passed = 0;
  let worst = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = gradeCase(prep, cases[i]);
    if (r.evaluateError) return { ok: false, passed, total: cases.length, details, error: r.evaluateError, failedAt: i, worst: null };
    if (r.ok) passed++;
    if (r.worst > worst) worst = r.worst;
    details.push({ index: i, inputs: cases[i].inputs, ok: r.ok, outputs: r.outputs });
  }
  return { ok: passed === cases.length && cases.length > 0, passed, total: cases.length, details, error: null, worst };
}

// 给界面用的协作式版本：每几组让出一次事件循环，避免长图卡住渲染。
export async function gradeAgainstVectorsAsync(graph, vectors, onProgress) {
  const prep = prepare(graph);
  if (prep.error) return { ok: false, passed: 0, total: 0, details: [], error: prep.error, worst: null };
  const cases = (vectors && vectors.cases) || [];
  const details = [];
  let passed = 0;
  let worst = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = gradeCase(prep, cases[i]);
    if (r.evaluateError) return { ok: false, passed, total: cases.length, details, error: r.evaluateError, failedAt: i, worst: null };
    if (r.ok) passed++;
    if (r.worst > worst) worst = r.worst;
    details.push({ index: i, inputs: cases[i].inputs, ok: r.ok, outputs: r.outputs });
    if (onProgress) onProgress(i + 1, cases.length);
    if (i % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { ok: passed === cases.length && cases.length > 0, passed, total: cases.length, details, error: null, worst };
}

// 懒加载离线预计算的参考值（由 tools/gen_vectors.mjs 调用 oracle_probe 生成）。
let vectorsCache = null;
export async function loadVectors() {
  if (vectorsCache) return vectorsCache;
  const url = new URL("../../data/vectors.json", import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error("无法加载参考数据 (" + res.status + ")");
  vectorsCache = await res.json();
  return vectorsCache;
}