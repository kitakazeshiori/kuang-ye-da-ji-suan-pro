// 函数（可复用子图）的打包、函数库与宏展开。
//
// 约定：
//   * 一个「函数」就是一张小图：若干 I 节点是参数（按 id 升序即参数顺序），
//     恰好一个 out 节点是返回值（只留 1 个端口）。
//   * 画布上的调用节点 type = "fn"，用 fn 字段存函数名，端口数 = 参数个数。
//   * 求值 / 校验 / 导出 / 统计权重之前，先把调用就地展开成一张平图（宏展开），
//     所以 W 天然等于展开后的加权节点数，评分口径与官方 checker 完全一致。
//   * 展开时画布上原有节点保留原 id（数值面板仍按 id 取中间值），
//     函数体复制出来的节点用更大的新 id，互不冲突。
import { Graph } from "./graph.js";
import { NODE_TYPES } from "./types.js";

export const FN_NAME_RE = /^[^\s]{1,24}$/;

export class FunctionLibrary {
  constructor(defs = []) {
    this.map = new Map();
    this.version = 0;
    for (const d of defs) this._put(d);
  }

  _put(d) {
    if (!d || !d.name || !d.body) return;
    const body = Graph.fromJSON(d.body);
    const outNodes = body.outNodes();
    this.map.set(String(d.name), {
      name: String(d.name),
      params: body.inputNodes().length,
      weight: d.weight === undefined ? body.cost() : Math.max(0, d.weight | 0),
      body: d.body,
    });
  }

  get size() {
    return this.map.size;
  }
  has(name) {
    return this.map.has(String(name));
  }
  get(name) {
    return this.map.get(String(name));
  }
  list() {
    return [...this.map.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  names() {
    return this.list().map((d) => d.name);
  }
  set(def) {
    const prev = this.map.get(def.name);
    this._put(def);
    this.version++;
    return prev;
  }
  delete(name) {
    const ok = this.map.delete(String(name));
    if (ok) this.version++;
    return ok;
  }
  toJSON() {
    return this.list().map((d) => ({ name: d.name, params: d.params, weight: d.weight, body: d.body }));
  }
  static fromJSON(data) {
    const arr = data && Array.isArray(data.functions) ? data.functions : Array.isArray(data) ? data : [];
    return new FunctionLibrary(arr);
  }
}

// 可当函数结果的候选节点：优先「值流向选区外」的节点；没有出口时退回
// 选区内的局部汇点（下游都还在选区里）。按 id 升序。
export function resultCandidates(graph, ids) {
  const S = new Set(ids);
  const outs = [];
  const sinks = [];
  for (const id of [...S].sort((a, b) => a - b)) {
    const node = graph.get(id);
    if (!node || node.type === "out") continue;
    let outside = false;
    let inside = false;
    for (const c of graph.consumersOf(id)) {
      if (S.has(c)) inside = true;
      else outside = true;
    }
    if (outside) outs.push(id);
    else if (!inside) sinks.push(id);
  }
  return outs.length > 0 ? outs : sinks;
}

// 收集函数参数。两类来源：
//   1) 选区内的 I 节点：它本身保留在画布上，作为调用端参数的来源（kind "I"）；
//   2) 从选区外引入、或干脆悬空的输入端口（kind "port"）。
// 同一个外部来源被多个端口引用时只算一个参数；悬空端口各自算一个参数，
// 调用节点上对应端口留空，等用户自己接线。返回 paramIndex: "节点id:端口号" -> 参数序号。
export function collectFunctionParams(graph, ids) {
  const S = new Set(ids);
  const sorted = [...S].sort((a, b) => a - b);
  const params = [];
  const paramIndex = new Map();
  for (const id of sorted) {
    const n = graph.get(id);
    if (!n || n.type !== "I") continue;
    paramIndex.set(id + ":*", params.length);
    params.push({ kind: "I", node: id, src: id });
  }
  const external = new Map(); // 外部来源节点 id -> 参数序号
  for (const id of sorted) {
    const n = graph.get(id);
    if (!n || n.type === "I") continue;
    for (let p = 0; p < n.inputs.length; p++) {
      const src = n.inputs[p];
      if (src !== null && S.has(src)) continue; // 选区内部连线，不是参数
      let k;
      if (src === null) {
        k = params.length; // 悬空端口：单独占一个参数
        params.push({ kind: "port", node: id, src: null });
      } else {
        const hit = external.get(src);
        if (hit !== undefined) {
          k = hit; // 同一外部来源复用同一个参数
        } else {
          k = params.length;
          external.set(src, k);
          params.push({ kind: "port", node: id, src });
        }
      }
      paramIndex.set(id + ":" + p, k);
    }
  }
  return { params, paramIndex };
}

// 打包：把选中节点抽成函数定义，并给出在画布上落地调用节点所需的改动计划。
// plan.paramSources[k] 是调用节点第 k 个端口要接的画布节点（null = 悬空）；
// plan.removed 是要被调用节点取代的节点（I 节点保留，作为参数来源）。
export function buildFunctionDef(graph, ids, name, resultId, lib) {
  const fnName = String(name === undefined || name === null ? "" : name).trim();
  if (!FN_NAME_RE.test(fnName)) return { ok: false, error: "函数名需要 1–24 个字符，且不能包含空白" };
  const S = new Set(ids);
  if (S.size === 0) return { ok: false, error: "先在画布上框选要打包的节点" };
  const sorted = [...S].sort((a, b) => a - b);
  for (const id of sorted) {
    const n = graph.get(id);
    if (!n) return { ok: false, error: "选中的节点不存在" };
    if (n.type === "out") return { ok: false, error: "输出端子不能打包进函数，它是当前关卡的出口" };
  }

  const { params, paramIndex } = collectFunctionParams(graph, ids);

  // 出口：指向选区外的边必须来自同一个节点，否则拆掉选区会破坏其它连线。
  const outs = new Set();
  for (const id of sorted) {
    for (const c of graph.consumersOf(id)) if (!S.has(c)) outs.add(id);
  }
  if (outs.size > 1) {
    return {
      ok: false,
      error:
        "选中部分有 " + outs.size + " 个不同的出口（#" + [...outs].sort((a, b) => a - b).join("、#") +
        "），请只留一个出口，或把其它出口的节点也框进来",
    };
  }

  let result = resultId === undefined || resultId === null ? null : Number(resultId);
  if (result === null) {
    if (outs.size === 1) result = [...outs][0];
    else {
      const cands = resultCandidates(graph, sorted);
      if (cands.length === 1) result = cands[0];
      else if (cands.length === 0) return { ok: false, error: "选中部分找不到可当结果的节点" };
      else return { ok: false, error: "请选择哪个节点作为函数的结果", candidates: cands };
    }
  }
  if (!S.has(result)) return { ok: false, error: "指定的结果节点不在选区里" };

  // ---- 造函数体：参数在上一排，其余节点按原相对位置平移过来 ----
  const body = new Graph();
  const map = new Map(); // 画布 id -> 函数体 id
  const paramIds = [];
  for (let k = 0; k < params.length; k++) {
    const node = body.createNode("I", k * 150, 0);
    body.setInputValue(node.id, "1");
    paramIds.push(node.id);
    if (params[k].kind === "I") map.set(params[k].node, node.id);
  }
  let minX = Infinity;
  let minY = Infinity;
  for (const id of sorted) {
    const n = graph.get(id);
    if (n.type === "I") continue;
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  for (const id of sorted) {
    const n = graph.get(id);
    if (n.type === "I") continue;
    const opts = { arity: n.inputs.length };
    if (n.value !== undefined) opts.value = n.value;
    if (n.fn !== undefined) opts.fn = n.fn;
    const nn = body.createNode(n.type, n.x - minX, n.y - minY + 170, opts);
    map.set(id, nn.id);
  }
  for (const id of sorted) {
    const n = graph.get(id);
    if (n.type === "I") continue;
    const nn = body.get(map.get(id));
    for (let p = 0; p < n.inputs.length; p++) {
      const k = paramIndex.get(id + ":" + p);
      nn.inputs[p] = k === undefined ? map.get(n.inputs[p]) : paramIds[k];
    }
  }
  const outNode = body.createNode("out", 0, 0, { arity: 1 });
  outNode.inputs[0] = map.get(result);

  const def = { name: fnName, params: params.length, weight: body.cost(), body: body.toJSON() };
  if (lib) {
    const ex = expandGraph(body, lib);
    if (ex.ok) def.weight = ex.graph.cost();
  }

  return {
    ok: true,
    def,
    plan: {
      paramSources: params.map((p) => p.src),
      removed: sorted.filter((id) => graph.get(id).type !== "I"),
      result,
      params: params.length,
    },
  };
}

// ---- 宏展开 ----

// 把模板实例化进一张平图的节点数组（expandGraph 用，保持平铺的 JSON 形态）。
function flattenTemplate(tpl, remap, nextId) {
  const created = new Map();
  const skip = new Set(tpl.paramIds);
  for (const pid of tpl.paramIds) created.set(pid, remap.get(pid));
  for (const tn of tpl.nodes) if (!skip.has(tn.id)) created.set(tn.id, nextId++);
  const nodes = [];
  for (const tn of tpl.nodes) {
    if (skip.has(tn.id)) continue;
    nodes.push({ ...tn, id: created.get(tn.id), inputs: tn.inputs.map((s) => (s === null ? null : created.get(s))) });
  }
  return { nodes, outSrc: created.get(tpl.outSrc) ?? null, nextId };
}

// mode = "flat"：展开成平图，保留 out，画布节点 id 不变；"template"：展开函数体，丢掉 out，收集参数。
function expand(g, ctx, mode, keepIds) {
  const order = g.topoOrder();
  if (order === null) throw new Error("图中存在环，无法展开");
  const outNodes = g.outNodes();
  const nodes = [];
  const idMap = new Map();
  const paramIds = [];
  let nextId = keepIds ? g.nextId : 1;

  for (const id of order) {
    const node = g.get(id);
    if (node.type === "out") {
      if (mode === "flat") {
        const nid = keepIds ? id : nextId++;
        idMap.set(id, nid);
        nodes.push({ ...node, id: nid, inputs: node.inputs.map((s) => (s === null ? null : idMap.get(s))) });
      }
      continue;
    }
    if (node.type === "fn") {
      if (!ctx.lib.get(node.fn)) throw new Error("函数「" + node.fn + "」不存在（可能已被删除）");
      const tpl = templateOf(node.fn, ctx);
      if (node.inputs.length !== tpl.paramIds.length) {
        throw new Error(
          "函数「" + node.fn + "」需要 " + tpl.paramIds.length + " 个参数，调用处有 " + node.inputs.length + " 个端口"
        );
      }
      const remap = new Map();
      for (let k = 0; k < tpl.paramIds.length; k++) {
        const src = node.inputs[k];
        if (src === null) throw new Error("函数「" + node.fn + "」的第 " + (k + 1) + " 个参数没有连线");
        remap.set(tpl.paramIds[k], idMap.get(src));
      }
      const inst = flattenTemplate(tpl, remap, nextId);
      nextId = inst.nextId;
      for (const n of inst.nodes) nodes.push(n);
      idMap.set(id, inst.outSrc);
      if (ctx.fnMap) ctx.fnMap.set(id, inst.outSrc);
      continue;
    }
    const nid = keepIds ? id : nextId++;
    idMap.set(id, nid);
    nodes.push({
      ...(node.value !== undefined ? { value: node.value } : {}),
      ...(node.name !== undefined ? { name: node.name } : {}),
      ...(node.type === "I" ? { inputValue: node.inputValue } : {}),
      ...(node.fn !== undefined ? { fn: node.fn } : {}),
      id: nid,
      type: node.type,
      x: node.x,
      y: node.y,
      inputs: node.inputs.map((s) => (s === null ? null : idMap.get(s))),
    });
    if (mode === "template" && node.type === "I") paramIds.push(nid);
  }

  let outSrc = null;
  if (outNodes.length === 1 && outNodes[0].inputs.length > 0 && outNodes[0].inputs[0] !== null) {
    outSrc = idMap.get(outNodes[0].inputs[0]) ?? null;
  }
  return { nodes, paramIds, outSrc, nextId };
}

function templateOf(name, ctx) {
  const cached = ctx.cache.get(name);
  if (cached) return cached;
  if (ctx.stack.includes(name)) throw new Error("函数「" + name + "」递归调用自己，无法展开");
  const def = ctx.lib.get(name);
  if (!def) throw new Error("函数「" + name + "」不存在");
  ctx.stack.push(name);
  const body = Graph.fromJSON(def.body);
  const tpl = expand(body, ctx, "template", false);
  ctx.stack.pop();
  ctx.cache.set(name, tpl);
  return tpl;
}

// 把画布上的所有函数调用展开成一张平图。失败时返回 { ok:false, error }。
export function expandGraph(graph, lib) {
  const ctx = { lib, stack: [], cache: new Map(), fnMap: new Map() };
  try {
    const r = expand(graph, ctx, "flat", true);
    return { ok: true, graph: Graph.fromJSON({ nextId: r.nextId, nodes: r.nodes }), fnMap: ctx.fnMap };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// 就地展开一个调用节点（写进当前画布）：把函数体铺在调用节点下方，
// 把调用节点的下游改接到函数结果上，再删掉调用节点。
// 允许「空展开」：参数没连线的照样展开，函数体里对应的输入端口保持留空；
// 返回值没接线时，下游端口也留空；函数体没有内部节点（直通）时只把下游直接接到来源。
export function expandCallInPlace(graph, callId, lib) {
  const call = graph.get(callId);
  if (!call || call.type !== "fn") return { ok: false, error: "这里不是函数调用" };
  let tpl;
  try {
    tpl = templateOf(call.fn, { lib, stack: [], cache: new Map() });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  if (call.inputs.length !== tpl.paramIds.length) {
    return {
      ok: false,
      error:
        "函数「" + call.fn + "」需要 " + tpl.paramIds.length + " 个参数，这个调用节点有 " + call.inputs.length +
        " 个端口（函数可能被重新打包过，删掉这个调用节点再从工具箱拖一个）",
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  for (const tn of tpl.nodes) {
    if (tn.x < minX) minX = tn.x;
    if (tn.y < minY) minY = tn.y;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  const dx = call.x - minX;
  const dy = call.y + 110 - minY;

  // 先记下调用节点的下游，再铺函数体。
  const consumers = [];
  for (const node of graph.nodes.values()) {
    for (let p = 0; p < node.inputs.length; p++) if (node.inputs[p] === callId) consumers.push([node.id, p]);
  }

  // 没连线的参数映射成 null：展开后函数体里对应的输入端口也保持没连线。
  const remap = new Map();
  for (let k = 0; k < tpl.paramIds.length; k++) {
    const src = call.inputs[k];
    remap.set(tpl.paramIds[k], src === undefined ? null : src);
  }

  const created = new Map();
  const skip = new Set(tpl.paramIds);
  for (const pid of tpl.paramIds) created.set(pid, remap.get(pid));
  for (const tn of tpl.nodes) {
    if (skip.has(tn.id)) continue;
    const opts = { arity: tn.inputs.length };
    if (tn.value !== undefined) opts.value = tn.value;
    if (tn.fn !== undefined) opts.fn = tn.fn;
    const nn = graph.createNode(tn.type, tn.x + dx, tn.y + dy, opts);
    if (tn.name !== undefined && NODE_TYPES[tn.type].hasName) nn.name = tn.name;
    created.set(tn.id, nn.id);
  }
  const newIds = [];
  let dangling = 0;
  for (const tn of tpl.nodes) {
    if (skip.has(tn.id)) continue;
    const nn = graph.get(created.get(tn.id));
    newIds.push(nn.id);
    for (let p = 0; p < tn.inputs.length; p++) {
      const s = tn.inputs[p];
      const val = s === null || !created.has(s) ? null : created.get(s);
      nn.inputs[p] = val === undefined ? null : val;
      if (nn.inputs[p] === null) dangling++;
    }
  }
  const outSrc = tpl.outSrc === null || !created.has(tpl.outSrc) ? null : created.get(tpl.outSrc);
  for (const [nodeId, port] of consumers) {
    const node = graph.get(nodeId);
    if (node) node.inputs[port] = outSrc;
  }
  graph.removeMany([callId]);
  graph.touch();
  return { ok: true, ids: newIds, outSrc, dangling };
}