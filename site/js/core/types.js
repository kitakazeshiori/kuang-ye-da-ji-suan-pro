// 节点类型表：严格对应题面《计算模型》一节的 8 种指令 + 输出端子。
export const NODE_TYPES = {
  I: {
    key: "I", op: "I", name: "输入", en: "in", glyph: "I", arity: 0, weight: 1,
    hasOutput: true, hasValue: false, hasIndex: true, hasName: true, hue: "#3b82f6",
    desc: "按顺序读取一个实数。输入节点数量必须与任务一致，顺序由创建先后决定。",
  },
  C: {
    key: "C", op: "C", name: "常数", en: "const", glyph: "c", arity: 0, weight: 1,
    hasOutput: true, hasValue: true, hue: "#a855f7",
    desc: "常数 c，|c| ≤ 10^6。文本至多 256 字符，指数绝对值不超过 300。",
  },
  add: {
    key: "add", op: "+", name: "加法", en: "add", glyph: "+", arity: 2, weight: 1,
    hasOutput: true, hue: "#14b8a6", desc: "两数相加 z = x + y。",
  },
  neg: {
    key: "neg", op: "-", name: "取反", en: "neg", glyph: "−", arity: 1, weight: 1,
    hasOutput: true, hue: "#14b8a6", desc: "取相反数 z = −x。",
  },
  mul: {
    key: "mul", op: "*", name: "乘法", en: "mul", glyph: "×", arity: 2, weight: 4,
    hasOutput: true, hue: "#f59e0b", desc: "两数相乘 z = x · y。权重 4。",
  },
  sin: {
    key: "sin", op: "S", name: "正弦", en: "sin", glyph: "sin", arity: 1, weight: 9,
    hasOutput: true, hue: "#ef4444", desc: "sin(x)，弧度制，|x| < 10^6。权重 9。",
  },
  cos: {
    key: "cos", op: "T", name: "余弦", en: "cos", glyph: "cos", arity: 1, weight: 9,
    hasOutput: true, hue: "#ef4444", desc: "cos(x)，弧度制，|x| < 10^6。权重 9。",
  },
  exp: {
    key: "exp", op: "E", name: "指数", en: "exp", glyph: "exp", arity: 1, weight: 12,
    hasOutput: true, hue: "#f43f5e", desc: "exp(x)，|x| < 100。权重 12。",
  },
  sqrt: {
    key: "sqrt", op: "Q", name: "平方根", en: "sqrt", glyph: "√", arity: 1, weight: 7,
    hasOutput: true, hue: "#22c55e", desc: "√x，要求 x ≥ 0。权重 7。",
  },
  fn: {
    key: "fn", op: "FN", name: "函数调用", en: "fn", glyph: "ƒ", arity: 1, weight: 0,
    hasOutput: true, variableArity: true, isCall: true, hue: "#8b5cf6",
    desc: "调用一个自定义函数：端口数就是参数个数，权重按展开后的内部节点数计。",
  },
  wire: {
    key: "wire", op: "=", name: "中转", en: "=", glyph: "=", arity: 1, weight: 0,
    hasOutput: true, hue: "#94a3b8",
    desc: "空节点：输出 = 输入，不计权重（W0），只用来把线理清楚。导出时会被省略。",
  },
  out: {
    key: "out", op: "OUT", name: "输出", en: "out", glyph: "OUT", arity: 1, weight: 0,
    hasOutput: false, isOutput: true, variableArity: true, hasName: true, hue: "#64748b",
    desc: "输出端子。输入端口的自上而下顺序即答案顺序；不计权重与引用上限。",
  },
};

// 面板顺序：先输入/常数，再算术，再初等函数，最后输出。
export const TYPE_ORDER = ["I", "C", "add", "neg", "mul", "sin", "cos", "exp", "sqrt", "wire", "out"];

export const MAX_NODES = 180000;
export const MAX_REFS = 300000;
export const MAX_CONST_MAG = 1e6;
export const MAX_VALUE_MAG = "1e60";

export function typeInfo(key) {
  const t = NODE_TYPES[key];
  if (!t) throw new Error("unknown node type: " + key);
  return t;
}

// 判断节点实例的输入端口数量（OUT 的端口数可变）。
export function arityOf(node) {
  return node.inputs.length;
}

export function typeOf(node) {
  return NODE_TYPES[node.type];
}
