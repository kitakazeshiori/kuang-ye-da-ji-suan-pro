// 与题面《提交格式》互转：标准 DAG 文本 <-> 图模型。
// 导出时按拓扑序重新编号，因此编辑器里怎么摆都能产出合法文件。
import { NODE_TYPES, MAX_NODES } from "./types.js";
import { Graph } from "./graph.js";

export class GraphFormatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GraphFormatError";
    this.code = code;
  }
}

const OP_TO_TYPE = { "+": "add", "*": "mul", "-": "neg", S: "sin", T: "cos", E: "exp", Q: "sqrt" };

export function toProblemText(graph) {
  const order = graph.topoOrder();
  if (order === null) throw new GraphFormatError("cycle", "图中存在环，不能导出");
  const outNodes = graph.outNodes();
  if (outNodes.length === 0) throw new GraphFormatError("no-out", "缺少输出节点");
  if (outNodes.length > 1) throw new GraphFormatError("multi-out", "只能有一个输出节点");

  const emit = order.filter((id) => graph.get(id).type !== "out");
  if (emit.length === 0) throw new GraphFormatError("empty", "没有可导出的节点");
  if (emit.length > MAX_NODES) {
    throw new GraphFormatError("nodes", "节点数 " + emit.length + " 超过上限 " + MAX_NODES);
  }

  const idMap = new Map();
  emit.forEach((oldId, i) => idMap.set(oldId, i + 1));

  const lines = [String(emit.length)];
  for (const oldId of emit) {
    const node = graph.get(oldId);
    const t = NODE_TYPES[node.type];
    const refs = node.inputs.map((s) => {
      if (s === null) throw new GraphFormatError("dangling", "节点 #" + oldId + " 的输入端口未连线");
      const mapped = idMap.get(s);
      if (mapped === undefined) throw new GraphFormatError("dangling", "节点 #" + oldId + " 引用了不可用节点");
      return mapped;
    });
    if (node.type === "I") lines.push("I");
    else if (node.type === "C") lines.push("C " + String(node.value).trim());
    else if (refs.length === 2) lines.push(t.op + " " + refs[0] + " " + refs[1]);
    else if (refs.length === 1) lines.push(t.op + " " + refs[0]);
    else throw new GraphFormatError("arity", "节点 #" + oldId + " 的端口数不合法");
  }

  const out = outNodes[0];
  if (out.inputs.length === 0) throw new GraphFormatError("no-out", "输出端口为空");
  const outRefs = out.inputs.map((s) => {
    if (s === null) throw new GraphFormatError("dangling", "输出端口未连线");
    const mapped = idMap.get(s);
    if (mapped === undefined) throw new GraphFormatError("dangling", "输出引用了不可用节点");
    return mapped;
  });
  lines.push("OUT " + outRefs.length + " " + outRefs.join(" "));
  return lines.join("\n") + "\n";
}

// 宽松导入：接受任意合法 id 引用（即使不是拓扑序），导出时自动重排。
export function fromProblemText(text) {
  const raw = String(text).replace(/\r\n?/g, "\n");
  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length < 2) throw new GraphFormatError("parse", "内容太短：至少需要节点数和 OUT 两行");

  const n = Number(lines[0]);
  if (!Number.isInteger(n) || n < 1) throw new GraphFormatError("parse", "第一行必须是节点数 N（正整数）");
  if (n > MAX_NODES) throw new GraphFormatError("parse", "节点数超过上限 " + MAX_NODES);
  if (lines.length < n + 2) throw new GraphFormatError("parse", "指令行不足：声明了 " + n + " 个节点，只找到 " + (lines.length - 1) + " 行");

  const warnings = [];
  const g = new Graph();

  for (let i = 1; i <= n; i++) {
    const parts = lines[i].split(/\s+/);
    const op = parts[0];
    let node;
    if (op === "I") node = g.createNode("I", 0, 0);
    else if (op === "C") node = g.createNode("C", 0, 0, { value: parts[1] === undefined ? "0" : parts[1] });
    else if (OP_TO_TYPE[op]) node = g.createNode(OP_TO_TYPE[op], 0, 0);
    else throw new GraphFormatError("parse", "第 " + (i + 1) + " 行：未知指令 " + op);

    if (OP_TO_TYPE[op]) {
      const need = node.inputs.length;
      for (let k = 0; k < need; k++) {
        const tok = parts[1 + k];
        const v = Number(tok);
        if (!Number.isInteger(v) || v < 1 || v > n) {
          throw new GraphFormatError("parse", "第 " + (i + 1) + " 行：引用非法 " + String(tok));
        }
        if (v >= i) {
          warnings.push("第 " + (i + 1) + " 行引用了不小于自身的节点 #" + v + "，导入后会重新排序");
        }
        node.inputs[k] = v;
      }
    }
  }

  const outLine = lines[n + 1].split(/\s+/);
  if (outLine[0] !== "OUT") throw new GraphFormatError("parse", "缺少 OUT 行");
  const k = Number(outLine[1]);
  if (!Number.isInteger(k) || k < 1 || k > 16) throw new GraphFormatError("parse", "OUT 的输出项数不合法");
  if (outLine.length < 2 + k) throw new GraphFormatError("parse", "OUT 行引用的节点数不足");
  const outNode = g.createNode("out", 0, 0, { arity: k });
  for (let j = 0; j < k; j++) {
    const v = Number(outLine[2 + j]);
    if (!Number.isInteger(v) || v < 1 || v > n) throw new GraphFormatError("parse", "OUT 引用了非法节点 " + String(outLine[2 + j]));
    outNode.inputs[j] = v;
  }

  g.autoLayout();
  return { graph: g, warnings };
}