// 计算图数据结构：节点 + 端口连接。
// 连接只保存在目标节点的 inputs[] 里（null 表示空端口），连线由模型推导出来。
import { NODE_TYPES } from "./types.js";
import { NAME_POOL, nodeHeight, nodeWidth } from "./geometry.js";

export class Graph {
  constructor() {
    this.nodes = new Map();
    this.nextId = 1;
    this.version = 0;
    this._outsCache = null;
    this._outsVersion = -1;
  }

  get size() {
    return this.nodes.size;
  }

  // 任何结构变化都要 +1，渲染与缓存靠它判断是否过期。
  touch() {
    this.version++;
    this._outsCache = null;
  }

  get(id) {
    return this.nodes.get(id);
  }

  has(id) {
    return this.nodes.has(id);
  }

  createNode(typeKey, x = 0, y = 0, opts = {}) {
    const t = NODE_TYPES[typeKey];
    if (!t) throw new Error("未知节点类型: " + typeKey);
    const node = { id: this.nextId++, type: typeKey, x: Math.round(x), y: Math.round(y) };
    if (t.hasValue) node.value = opts.value === undefined ? "1" : String(opts.value);
    if (t.hasName) node.name = opts.name ? String(opts.name) : this.nextName();
    if (typeKey === "I") node.inputValue = opts.inputValue === undefined ? "1" : String(opts.inputValue);
    if (opts.fn !== undefined) node.fn = String(opts.fn);
    const arity = t.variableArity
      ? Math.max(typeKey === "out" ? 1 : 0, opts.arity === undefined ? t.arity : Math.round(opts.arity))
      : t.arity;
    node.inputs = new Array(arity).fill(null);
    this.nodes.set(node.id, node);
    this.touch();
    return node;
  }

  namesInUse() {
    const used = new Set();
    for (const n of this.nodes.values()) if (n.name) used.add(String(n.name));
    return used;
  }

  // 默认命名：XYZABCDEF… 取第一个没被占用的字母；用尽后加数字后缀（X2、X3…）。
  nextName() {
    const used = this.namesInUse();
    for (const ch of NAME_POOL) if (!used.has(ch)) return ch;
    for (let i = 2; ; i++) {
      for (const ch of NAME_POOL) {
        const cand = ch + i;
        if (!used.has(cand)) return cand;
      }
    }
  }

  // 重命名：非空、唯一、无空白、长度不超过 16。
  setName(id, name) {
    const node = this.nodes.get(id);
    if (!node) return { ok: false, reason: "节点不存在" };
    if (!NODE_TYPES[node.type].hasName) return { ok: false, reason: "该节点没有名称" };
    const s = String(name === undefined || name === null ? "" : name).trim();
    if (s.length === 0) return { ok: false, reason: "名称不能为空" };
    if (s.length > 16) return { ok: false, reason: "名称最长 16 个字符" };
    if (/\s/.test(s)) return { ok: false, reason: "名称不能包含空白字符" };
    for (const n of this.nodes.values()) {
      if (n.id !== id && n.name === s) return { ok: false, reason: "名称 " + s + " 已被占用" };
    }
    node.name = s;
    this.touch();
    return { ok: true, name: s };
  }

  setInputValue(id, value) {
    const node = this.nodes.get(id);
    if (!node || node.type !== "I") return false;
    node.inputValue = String(value);
    this.touch();
    return true;
  }

  remove(id) {
    return this.removeMany([id]) > 0;
  }

  // 批量删除：先删点，再清理所有指向它们的引用，整体 O(V + E)。
  removeMany(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    let removed = 0;
    for (const id of set) {
      if (this.nodes.delete(id)) removed++;
    }
    if (removed === 0) return 0;
    for (const node of this.nodes.values()) {
      const list = node.inputs;
      for (let i = 0; i < list.length; i++) {
        if (list[i] !== null && set.has(list[i])) list[i] = null;
      }
    }
    this.touch();
    return removed;
  }

  move(id, x, y) {
    const node = this.nodes.get(id);
    if (!node) return false;
    node.x = Math.round(x);
    node.y = Math.round(y);
    this.touch();
    return true;
  }

  moveMany(ids, dx, dy) {
    if (dx === 0 && dy === 0) return;
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node) continue;
      node.x = Math.round(node.x + dx);
      node.y = Math.round(node.y + dy);
    }
    this.touch();
  }

  setValue(id, value) {
    const node = this.nodes.get(id);
    if (!node || !NODE_TYPES[node.type].hasValue) return false;
    node.value = String(value);
    this.touch();
    return true;
  }

  // 可变端口类型（目前只有 OUT）的端口数量调整，尽量保留已有连接。
  setArity(id, arity) {
    const node = this.nodes.get(id);
    if (!node || !NODE_TYPES[node.type].variableArity || NODE_TYPES[node.type].isCall) return false;
    const n = Math.max(1, Math.min(16, Math.round(arity)));
    const old = node.inputs;
    const next = new Array(n).fill(null);
    for (let i = 0; i < Math.min(n, old.length); i++) next[i] = old[i];
    node.inputs = next;
    this.touch();
    return true;
  }

  // 连接校验：返回 null 表示可以连，否则返回中文原因。
  connectError(fromId, toId, port) {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return "节点不存在";
    if (!NODE_TYPES[from.type].hasOutput) return "该节点没有输出端";
    if (to.inputs.length === 0) return "该节点没有输入端";
    if (!Number.isInteger(port) || port < 0 || port >= to.inputs.length) return "端口不存在";
    if (fromId === toId) return "不能连接到自身";
    if (to.inputs[port] === fromId) return null;
    if (this.reaches(toId, fromId)) return "会形成环";
    return null;
  }

  connect(fromId, toId, port) {
    const err = this.connectError(fromId, toId, port);
    if (err) return { ok: false, reason: err };
    this.nodes.get(toId).inputs[port] = fromId;
    this.touch();
    return { ok: true };
  }

  disconnect(toId, port) {
    const node = this.nodes.get(toId);
    if (!node || port < 0 || port >= node.inputs.length) return false;
    if (node.inputs[port] === null) return false;
    node.inputs[port] = null;
    this.touch();
    return true;
  }

  sourceOf(node, port) {
    return node.inputs[port];
  }

  connections() {
    const list = [];
    for (const node of this.nodes.values()) {
      for (let i = 0; i < node.inputs.length; i++) {
        const s = node.inputs[i];
        if (s !== null) list.push({ from: s, to: node.id, port: i });
      }
    }
    return list;
  }

  outNodes() {
    const list = [];
    for (const node of this.nodes.values()) if (node.type === "out") list.push(node);
    return list;
  }

  inputNodes() {
    const list = [];
    for (const node of this.nodes.values()) if (node.type === "I") list.push(node);
    list.sort((a, b) => a.id - b.id);
    return list;
  }

  // 源节点 -> 消费它的节点集合，带版本缓存。
  _outsIndex() {
    if (this._outsVersion === this.version && this._outsCache) return this._outsCache;
    const idx = new Map();
    for (const node of this.nodes.values()) {
      for (const s of node.inputs) {
        if (s === null) continue;
        let arr = idx.get(s);
        if (!arr) {
          arr = [];
          idx.set(s, arr);
        }
        arr.push(node.id);
      }
    }
    this._outsCache = idx;
    this._outsVersion = this.version;
    return idx;
  }

  consumersOf(id) {
    return this._outsIndex().get(id) || [];
  }

  // target 是否在 from 的下游（沿 source -> consumer 方向可达）。
  reaches(from, target) {
    if (from === target) return true;
    const idx = this._outsIndex();
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop();
      const next = idx.get(cur);
      if (!next) continue;
      for (const c of next) {
        if (c === target) return true;
        if (!seen.has(c)) {
          seen.add(c);
          stack.push(c);
        }
      }
    }
    return false;
  }

  // Kahn 拓扑排序；有环时返回 null。零入度节点按 id 升序入队，结果稳定。
  topoOrder() {
    const indeg = new Map();
    for (const id of this.nodes.keys()) indeg.set(id, 0);
    for (const node of this.nodes.values()) {
      for (const s of node.inputs) {
        if (s !== null && indeg.has(node.id)) indeg.set(node.id, indeg.get(node.id) + 1);
      }
    }
    const queue = [];
    for (const [id, d] of indeg) if (d === 0) queue.push(id);
    queue.sort((a, b) => a - b);
    const order = [];
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      order.push(id);
      const node = this.nodes.get(id);
      if (!node) continue;
      for (const c of this.consumersOf(id)) {
        const d = indeg.get(c);
        if (d === undefined) continue;
        const nd = d - 1;
        indeg.set(c, nd);
        if (nd === 0) queue.push(c);
      }
    }
    return order.length === this.nodes.size && this.nodes.size > 0 ? order : this.nodes.size === 0 ? [] : null;
  }

  // 总引用数（OUT 的输出引用不计入题面上限）。
  refCount() {
    let refs = 0;
    for (const node of this.nodes.values()) {
      if (NODE_TYPES[node.type].isOutput) continue;
      for (const s of node.inputs) if (s !== null) refs++;
    }
    return refs;
  }

  // 加权节点数 W。
  cost() {
    let w = 0;
    for (const node of this.nodes.values()) w += NODE_TYPES[node.type].weight;
    return w;
  }

  clone() {
    return Graph.fromJSON(JSON.parse(JSON.stringify(this.toJSON())));
  }

  toJSON() {
    const nodes = [];
    for (const node of this.nodes.values()) {
      const copy = { id: node.id, type: node.type, x: node.x, y: node.y, inputs: node.inputs.slice() };
      if (node.value !== undefined) copy.value = node.value;
      if (node.name !== undefined) copy.name = node.name;
      if (node.inputValue !== undefined) copy.inputValue = node.inputValue;
      if (node.fn !== undefined) copy.fn = node.fn;
      nodes.push(copy);
    }
    return { nextId: this.nextId, nodes };
  }

  static fromJSON(data) {
    const g = new Graph();
    if (!data || !Array.isArray(data.nodes)) return g;
    for (const n of data.nodes) {
      const copy = { id: n.id, type: n.type, x: n.x, y: n.y, inputs: Array.isArray(n.inputs) ? n.inputs.slice() : [] };
      if (n.value !== undefined) copy.value = String(n.value);
      if (n.name !== undefined) copy.name = String(n.name);
      if (n.inputValue !== undefined) copy.inputValue = String(n.inputValue);
      if (n.fn !== undefined) copy.fn = String(n.fn);
      g.nodes.set(copy.id, copy);
      if (copy.id >= g.nextId) g.nextId = copy.id + 1;
    }
    if (data.nextId && data.nextId > g.nextId) g.nextId = data.nextId;
    for (const node of g.nodes.values()) {
      if (NODE_TYPES[node.type].hasName && !node.name) node.name = g.nextName();
      if (node.type === "I" && node.inputValue === undefined) node.inputValue = "1";
    }
    g.touch();
    return g;
  }

  clear() {
    this.nodes.clear();
    this.nextId = 1;
    this.touch();
  }

  // 分层自动布局（Sugiyama 简化版 + 中位数对齐 + 蛇形折列）。
  //
  // 节点端口在上下两边，数据自上而下流动最省连线：
  //   1) 最长路径分层；
  //   2) 层内用重心法反复上下扫描排序，减少交叉；
  //   3) 过宽的层拆成若干行（行内横向紧凑排布）；
  //   4) 每行整体平移到「父节点 x 的中位数」处，让连线尽量竖直，
  //      同时因为整行平移，偏移量不会被逐行放大；
  //   5) 把行序列蛇形折成若干竖列，相邻层在空间上始终相邻；列数在若干候选里
  //      按「连线短 + 形状不过分细长」挑一个。
  autoLayout(opts = {}) {
    const order = this.topoOrder();
    if (!order) return false;
    if (order.length === 0) return true;

    const big = this.nodes.size > 3000;
    const rowGap = opts.rowGap || (big ? 22 : 40);
    const colGap = opts.colGap || (big ? 46 : 84);
    const rowH = nodeHeight() + rowGap;
    const shapePenalty = opts.shapePenalty === undefined ? 40 : opts.shapePenalty;
    const aspectMin = opts.aspectMin || 0.62;
    const aspectMax = opts.aspectMax || 2.2;

    // ---- 1. 分层：深度 = 最长入边路径 ----
    const depth = new Map();
    let maxDepth = 0;
    for (const id of order) {
      const node = this.nodes.get(id);
      let d = 0;
      for (const s of node.inputs) {
        if (s === null || s === undefined) continue;
        const sd = depth.get(s);
        if (sd !== undefined && sd + 1 > d) d = sd + 1;
      }
      depth.set(id, d);
      if (d > maxDepth) maxDepth = d;
    }
    const layers = [];
    for (let d = 0; d <= maxDepth; d++) layers.push([]);
    for (const id of order) layers[depth.get(id)].push(id);

    // 反向邻接表（谁消费了我），自下而上扫描时要用。
    const consumers = new Map();
    for (const id of order) {
      const node = this.nodes.get(id);
      for (const s of node.inputs) {
        if (s === null || s === undefined) continue;
        let arr = consumers.get(s);
        if (!arr) {
          arr = [];
          consumers.set(s, arr);
        }
        arr.push(id);
      }
    }

    // ---- 2. 层内排序：重心法 ----
    const slot = new Map();
    for (const layer of layers) layer.forEach((id, i) => slot.set(id, i));

    const barycenter = (id, up) => {
      const node = this.nodes.get(id);
      const rel = up ? node.inputs : consumers.get(id);
      if (!rel) return null;
      let sum = 0;
      let n = 0;
      for (const x of rel) {
        const p = slot.get(x);
        if (p === undefined) continue;
        sum += p;
        n++;
      }
      return n ? sum / n : null;
    };

    const sweep = (up) => {
      const seq = up ? layers.keys() : Array.from(layers.keys()).reverse();
      for (const d of seq) {
        const layer = layers[d];
        if (layer.length < 2) continue;
        const keyed = layer.map((id, i) => {
          const bc = barycenter(id, up);
          return { id, i, key: bc === null ? i : bc };
        });
        keyed.sort((a, b) => a.key - b.key || a.i - b.i);
        keyed.forEach((k, i) => {
          layer[i] = k.id;
          slot.set(k.id, i);
        });
      }
    };
    const rounds = maxDepth > 400 ? 2 : 4;
    for (let r = 0; r < rounds; r++) {
      sweep(true);
      sweep(false);
    }

    // ---- 3. 拆行：每层切成若干行 ----
    // 一行放多少个不按整图统一取值，而是按这一层的宽度自适应：目标是让这一层
    // 的方块大致是「3 行宽」的横条。否则一个几百节点的输入层会把整张图撑开。
    const perRow = opts.perRow || 0;
    const rowRatio = opts.rowRatio || 8;
    const rows = [];
    for (let d = 0; d <= maxDepth; d++) {
      const layer = layers[d];
      let chunk = perRow;
      if (!chunk) {
        let sumW = 0;
        for (const id of layer) sumW += nodeWidth(this.nodes.get(id)) + colGap;
        chunk = Math.max(1, Math.min(64, Math.round(Math.sqrt((layer.length * rowRatio * rowH) / (sumW / layer.length)))));
      }
      for (let i = 0; i < layer.length; i += chunk) rows.push(layer.slice(i, i + chunk));
    }

    // ---- 4. 行内紧凑排布，整行按父节点 x 的中位数平移 ----
    const centers = new Map();
    const rowX = [];
    const rowL = [];
    const rowR = [];
    const rowW = [];
    for (const row of rows) {
      const w = row.map((id) => nodeWidth(this.nodes.get(id)));
      const localX = new Array(row.length);
      let cursor = 0;
      for (let i = 0; i < row.length; i++) {
        localX[i] = cursor;
        cursor += w[i] + colGap;
      }
      const width = cursor - colGap;

      const offsets = [];
      for (let i = 0; i < row.length; i++) {
        const node = this.nodes.get(row[i]);
        let sum = 0;
        let n = 0;
        for (const s of node.inputs) {
          const c = centers.get(s);
          if (c === undefined) continue;
          sum += c;
          n++;
        }
        if (n) offsets.push(sum / n - (localX[i] + w[i] / 2));
      }
      let off;
      if (offsets.length) {
        // 中位数比均值稳：一条离谱的长连线不会把整行带偏。
        offsets.sort((a, b) => a - b);
        off = offsets[offsets.length >> 1];
      } else {
        // 输入/常数行没有父节点：统一从 0 开始，折列后会堆成一条输入带。
        off = 0;
      }
      const xs = new Array(row.length);
      for (let i = 0; i < row.length; i++) {
        xs[i] = localX[i] + off;
        centers.set(row[i], xs[i] + w[i] / 2);
      }
      rowX.push(xs);
      rowL.push(off);
      rowR.push(off + width);
      rowW.push(width);
    }

    // ---- 5. 蛇形折列：折点选在「割边最少」的地方 ----
    const totalRows = rows.length;
    const idMax = this.nextId;

    // cut[r] = 跨过第 r-1 / r 行分界的边数。边总是向下走（父行 < 子行），
    // 所以用差分数组一次算完；折点优先选割边少的地方，长连线会少很多。
    const rowOf = new Int32Array(idMax + 1);
    for (let r = 0; r < totalRows; r++) for (const id of rows[r]) rowOf[id] = r;
    const cut = new Float64Array(totalRows + 2);
    for (const id of order) {
      const node = this.nodes.get(id);
      const cr = rowOf[id];
      if (cr <= 0) continue;
      for (const s of node.inputs) {
        if (s === null || s === undefined) continue;
        const pr = rowOf[s];
        if (pr < cr) {
          cut[pr + 1] += 1;
          cut[cr + 1] -= 1;
        }
      }
    }
    for (let r = 1; r <= totalRows; r++) cut[r] += cut[r - 1];

    // 把行序列切成 nCols 段：每段长度接近均分，折点在附近找割边最少的行。
    const columnsFor = (nCols) => {
      const cuts = [0];
      let from = 0;
      const span = Math.max(1, Math.round(totalRows / (nCols * 4)));
      for (let c = 1; c < nCols; c++) {
        const target = Math.round((totalRows * c) / nCols);
        const lo = Math.max(from + 1, target - span);
        const hi = Math.min(totalRows - (nCols - c), target + span);
        let bestR = Math.max(lo, Math.min(hi, target));
        let bestV = Infinity;
        for (let r = lo; r <= hi; r++) {
          if (cut[r] < bestV) {
            bestV = cut[r];
            bestR = r;
          }
        }
        cuts.push(bestR);
        from = bestR;
      }
      cuts.push(totalRows);
      return cuts;
    };

    const fold = (cuts) => {
      const px = new Float64Array(idMax + 1);
      const py = new Float64Array(idMax + 1);
      let x0 = 0;
      let maxY = 0;
      for (let c = 0; c + 1 < cuts.length; c++) {
        const from = cuts[c];
        const to = cuts[c + 1];
        const count = to - from;
        let colMin = Infinity;
        let colMax = -Infinity;
        for (let r = from; r < to; r++) {
          if (rowL[r] < colMin) colMin = rowL[r];
          if (rowR[r] > colMax) colMax = rowR[r];
        }
        const down = c % 2 === 0;
        for (let r = from; r < to; r++) {
          const y = (down ? r - from : count - 1 - (r - from)) * rowH;
          const row = rows[r];
          for (let i = 0; i < row.length; i++) {
            px[row[i]] = x0 + (rowX[r][i] - colMin);
            py[row[i]] = y;
          }
          if (y + nodeHeight() > maxY) maxY = y + nodeHeight();
        }
        x0 += colMax - colMin + colGap;
      }
      return { px, py, width: x0 - colGap, height: maxY };
    };

    const score = (lay) => {
      let sum = 0;
      let n = 0;
      for (const id of order) {
        const node = this.nodes.get(id);
        const cx = lay.px[id] + nodeWidth(node) / 2;
        const top = lay.py[id];
        for (const s of node.inputs) {
          if (s === null || s === undefined) continue;
          const parent = this.nodes.get(s);
          const dx = cx - (lay.px[s] + nodeWidth(parent) / 2);
          const dy = top - (lay.py[s] + nodeHeight());
          sum += Math.sqrt(dx * dx + dy * dy);
          n++;
        }
      }
      const mean = n ? sum / n / rowH : 0;
      // 形状只做「别太离谱」的软约束：在窗口内不罚，超出才罚，且连线短优先。
      const aspect = lay.height ? lay.width / lay.height : 1;
      let shape = 0;
      if (aspect > aspectMax) shape = Math.log(aspect / aspectMax);
      else if (aspect < aspectMin) shape = Math.log(aspectMin / aspect);
      return mean + shapePenalty * shape;
    };

    // 写回节点坐标，并整体居中到原点。
    const commit = (lay) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const id of order) {
        const node = this.nodes.get(id);
        node.x = Math.round(lay.px[id]);
        node.y = Math.round(lay.py[id]);
        if (node.x < minX) minX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.x + nodeWidth(node) > maxX) maxX = node.x + nodeWidth(node);
        if (node.y + nodeHeight(node) > maxY) maxY = node.y + nodeHeight(node);
      }
      const dx = Math.round((minX + maxX) / 2);
      const dy = Math.round((minY + maxY) / 2);
      for (const id of order) {
        const node = this.nodes.get(id);
        node.x -= dx;
        node.y -= dy;
      }
      this.touch();
    };

    if (opts.cols) {
      commit(fold(columnsFor(Math.max(1, Math.min(totalRows, Math.round(opts.cols))))));
      return true;
    }

    let best = null;
    const maxCols = Math.min(16, totalRows);
    for (let nCols = 1; nCols <= maxCols; nCols++) {
      const lay = fold(columnsFor(nCols));
      const s = score(lay);
      if (!best || s < best.s) best = { s, lay };
    }
    commit(best.lay);
    return true;
  }

}