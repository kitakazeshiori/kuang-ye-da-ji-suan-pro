// 均匀网格空间索引：视口裁剪与命中测试都走它，保证大图下每帧只处理可见部分。
// 桶里存的是节点包围盒 {x,y,w,h}，命中测试再做一次精确 AABB 判定。
export class SpatialGrid {
  constructor(cell = 320) {
    this.cell = cell;
    this.buckets = new Map(); // "cx,cy" -> Map<id, rect>
    this.keys = new Map(); // id -> string[]，该 id 占用的桶
    this._epoch = 0;
    this._seen = new Map(); // id -> epoch，查询去重
  }

  _key(cx, cy) {
    return cx + "," + cy;
  }

  clear() {
    this.buckets.clear();
    this.keys.clear();
    this._seen.clear();
  }

  get size() {
    return this.keys.size;
  }

  insert(id, r) {
    const c = this.cell;
    const cx0 = Math.floor(r.x / c);
    const cx1 = Math.floor((r.x + r.w) / c);
    const cy0 = Math.floor(r.y / c);
    const cy1 = Math.floor((r.y + r.h) / c);
    const ks = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = this._key(cx, cy);
        let b = this.buckets.get(k);
        if (!b) {
          b = new Map();
          this.buckets.set(k, b);
        }
        b.set(id, r);
        ks.push(k);
      }
    }
    this.keys.set(id, ks);
  }

  remove(id) {
    const ks = this.keys.get(id);
    if (!ks) return;
    for (const k of ks) {
      const b = this.buckets.get(k);
      if (!b) continue;
      b.delete(id);
      if (b.size === 0) this.buckets.delete(k);
    }
    this.keys.delete(id);
  }

  update(id, r) {
    if (this.keys.has(id)) this.remove(id);
    this.insert(id, r);
  }

  // 查询与矩形相交的 id，结果写入 out 并返回。
  query(x, y, w, h, out = []) {
    const c = this.cell;
    const ep = ++this._epoch;
    const cx0 = Math.floor(x / c);
    const cx1 = Math.floor((x + w) / c);
    const cy0 = Math.floor(y / c);
    const cy1 = Math.floor((y + h) / c);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const b = this.buckets.get(this._key(cx, cy));
        if (!b) continue;
        for (const [id, r] of b) {
          if (this._seen.get(id) === ep) continue;
          this._seen.set(id, ep);
          if (r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y) out.push(id);
        }
      }
    }
    return out;
  }

  // 按 id 升序返回可见节点，保证后创建的节点画在上层。
  querySorted(x, y, w, h, out = []) {
    this.query(x, y, w, h, out);
    out.sort((a, b) => a - b);
    return out;
  }
}