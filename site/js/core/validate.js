// 结构校验、权重统计与评分系数。对应题面《评分》《提交格式》两节的可静态判定部分。
import { NODE_TYPES, MAX_NODES, MAX_REFS, MAX_CONST_MAG } from "./types.js";

// 与 checker 里的正则一致：普通十进制或科学计数法，指数最多 3 位数字。
const DEC_RE = /^[-+]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$/;

export function checkConstText(text) {
  const s = String(text === undefined || text === null ? "" : text).trim();
  if (s.length === 0) return { ok: false, reason: "常数不能为空" };
  if (s.length > 256) return { ok: false, reason: "常数文本超过 256 字符" };
  if (!DEC_RE.test(s)) return { ok: false, reason: "不是合法的十进制或科学计数法" };
  const ep = s.search(/[eE]/);
  if (ep >= 0) {
    const e = parseInt(s.slice(ep + 1), 10);
    if (!Number.isFinite(e) || Math.abs(e) > 300) return { ok: false, reason: "十进制指数绝对值超过 300" };
  }
  const num = Number(s);
  if (!Number.isFinite(num)) return { ok: false, reason: "常数不是有限值" };
  if (Math.abs(num) > MAX_CONST_MAG) return { ok: false, reason: "常数绝对值超过 10^6" };
  return { ok: true, value: num, text: s };
}

// 评分系数 f(W)：W ≤ B 得 1，B < W < 2B 线性衰减，W ≥ 2B 得 0。
export function scoreFactor(cost, base) {
  if (!base) return null;
  if (cost <= base) return 1;
  if (cost >= 2 * base) return 0;
  return (2 * base - cost) / base;
}

export function analyze(graph, level) {
  const errors = [];
  const warnings = [];
  const nodes = [];
  for (const node of graph.nodes.values()) nodes.push(node);
  const nodeCount = nodes.length;
  let refs = 0;
  let cost = 0;
  const dangling = [];
  const unusedHint = [];

  if (nodeCount === 0) {
    errors.push({ code: "empty", message: "画布是空的：先添加节点" });
  }
  // 编辑器不限制规模：时间限制与节点上限只影响能否提交给官方评测，属于兼容性警告。
  if (nodeCount > MAX_NODES) {
    warnings.push({
      code: "judge-nodes",
      message: "节点数 " + nodeCount + " 超过官方上限 " + MAX_NODES + "，导出文件会被判非法（编辑器本身不限）",
    });
  }

  const seenConsts = new Map();
  for (const node of nodes) {
    const t = NODE_TYPES[node.type];
    if (!t) {
      errors.push({ code: "type", nodeId: node.id, message: "节点 #" + node.id + " 类型未知" });
      continue;
    }
    cost += t.weight;
    for (let i = 0; i < node.inputs.length; i++) {
      const s = node.inputs[i];
      if (s === null) dangling.push({ nodeId: node.id, port: i });
      else if (!t.isOutput) refs++;
    }
    if (t.hasValue) {
      const r = checkConstText(node.value);
      if (!r.ok) {
        errors.push({ code: "const", nodeId: node.id, message: "节点 #" + node.id + " 的常数非法：" + r.reason });
      } else {
        const prev = seenConsts.get(r.text);
        if (prev !== undefined) unusedHint.push(prev + " 与 #" + node.id);
        else seenConsts.set(r.text, "#" + node.id);
      }
    }
  }

  if (refs > MAX_REFS) {
    warnings.push({
      code: "judge-refs",
      message: "节点引用 " + refs + " 超过官方上限 " + MAX_REFS + "，导出文件会被判非法（编辑器本身不限）",
    });
  }
  if (dangling.length > 0) {
    const head = dangling
      .slice(0, 6)
      .map((d) => "#" + d.nodeId)
      .join("、");
    errors.push({
      code: "dangling",
      message: "有 " + dangling.length + " 个输入端口没有连线（" + head + (dangling.length > 6 ? " 等" : "") + "）",
      detail: dangling,
    });
  }

  const topo = graph.topoOrder();
  if (topo === null) {
    errors.push({ code: "cycle", message: "图中存在环，无法拓扑排序" });
  }

  const inputNodes = graph.inputNodes();
  const outNodes = graph.outNodes();
  if (level && level.inputs !== null && level.inputs !== undefined) {
    if (inputNodes.length !== level.inputs) {
      errors.push({
        code: "inputs",
        message: "任务需要 " + level.inputs + " 个输入节点，当前有 " + inputNodes.length + " 个",
      });
    }
  }
  if (outNodes.length === 0) {
    errors.push({ code: "no-out", message: "缺少输出节点" });
  } else if (outNodes.length > 1) {
    errors.push({ code: "multi-out", message: "只能有一个输出节点，当前有 " + outNodes.length + " 个" });
  } else {
    const want = level && level.outputs !== null && level.outputs !== undefined ? level.outputs : null;
    if (want !== null && outNodes[0].inputs.length !== want) {
      errors.push({
        code: "out-arity",
        message: "输出端口应为 " + want + " 项，当前是 " + outNodes[0].inputs.length + " 项",
      });
    }
  }

  // 从输出反向可达的节点集合；其余节点白拿权重，给出提示。
  const used = new Set();
  const stack = [];
  for (const o of outNodes) {
    used.add(o.id);
    for (const s of o.inputs) if (s !== null) stack.push(s);
  }
  while (stack.length > 0) {
    const id = stack.pop();
    if (used.has(id)) continue;
    used.add(id);
    const node = graph.get(id);
    if (!node) continue;
    for (const s of node.inputs) if (s !== null) stack.push(s);
  }
  const unusedIds = [];
  for (const node of nodes) if (!used.has(node.id)) unusedIds.push(node.id);
  if (unusedIds.length > 0 && nodeCount > 0) {
    warnings.push({
      code: "unused",
      message: "有 " + unusedIds.length + " 个节点没有被输出引用，但仍然计入权重",
      detail: unusedIds,
    });
  }
  if (unusedHint.length > 0) {
    warnings.push({ code: "dup-const", message: "常数重复：" + unusedHint.slice(0, 3).join("，") });
  }
  if (outNodes.length === 1 && outNodes[0].inputs.length > 0 && dangling.length === 0 && topo !== null) {
    // 仅在结构完整时提示输入节点不足
    if (level && level.inputs !== null && level.inputs !== undefined && inputNodes.length !== level.inputs) {
      // 已在上面报错
    }
  }

  const factor = level && level.base ? scoreFactor(cost, level.base) : null;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    cost,
    nodeCount,
    refs,
    dangling,
    unusedIds,
    inputCount: inputNodes.length,
    outNodes: outNodes.map((n) => ({ id: n.id, arity: n.inputs.length })),
    topo,
    factor,
    // 关卡得分 = 任务分值 × f(W)，向下取整。阈值与分值都放在 levels.js，方便后续加权重预算/星级。
    score: level && level.base ? Math.floor(level.points * factor) : null,
  };
}