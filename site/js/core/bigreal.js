// 高精度十进制定点实数（原生 BigInt 实现）。
//
// 语义与题面自包含的 bigreal.hpp 中 agm_decimal::Real 逐条对齐：
//   * 内部值 v = x · 10^72（72 位小数，对应 8 个 1e9 肢体）；
//   * 乘法 = 精确相乘后向零截断掉低 72 位（对应 shiftDown(8)）；
//   * 除以小整数向零截断——BigInt 的 "/" 恰好就是这个语义；
//   * exp / sin / cos / sqrt 的迭代与收敛种子顺序照搬 C++ 版本。
//
// 全程只用 BigInt 与「除以 10 的幂」表达截断，绕开 JS Number 的 2^53 精度陷阱。

export const BASE = 1000000000n;
export const BASE_DIGITS = 9;
export const SCALE_LIMBS = 8;
export const SCALE_DIGITS = SCALE_LIMBS * BASE_DIGITS; // 72

const SCALE = 10n ** BigInt(SCALE_DIGITS);

function ipow10(n) {
  return 10n ** BigInt(n);
}

export class Real {
  constructor(v = 0n) {
    this.v = v;
  }

  static fromInt(n) {
    return new Real(BigInt(n) * SCALE);
  }

  static decimal(s) {
    return parseDecimal(s);
  }

  isZero() {
    return this.v === 0n;
  }

  negative() {
    return this.v < 0n;
  }

  abs() {
    return new Real(this.v < 0n ? -this.v : this.v);
  }

  neg() {
    return new Real(-this.v);
  }

  add(o) {
    return new Real(this.v + o.v);
  }

  sub(o) {
    return new Real(this.v - o.v);
  }

  // 对应 C++ 的 (a.v * b.v).shiftDown(SCALE_LIMBS)
  mul(o) {
    return new Real((this.v * o.v) / SCALE);
  }

  // 对应 divSmall：按绝对值取整；BigInt 的 "/" 同样是向零截断
  divInt(m) {
    return new Real(this.v / BigInt(m));
  }

  cmp(o) {
    return this.v < o.v ? -1 : this.v > o.v ? 1 : 0;
  }

  lt(o) {
    return this.v < o.v;
  }

  le(o) {
    return this.v <= o.v;
  }

  eq(o) {
    return this.v === o.v;
  }

  // 仅供收敛种子使用的近似浮点值（对应 C++ 的 ld()）
  ld() {
    const mag = (this.v < 0n ? -this.v : this.v).toString();
    const x = Number(mag) * Math.pow(10, -SCALE_DIGITS);
    return this.v < 0n ? -x : x;
  }

  // 与 C++ str() 相同的定点输出：符号 + 整数部分 + 72 位小数
  toString() {
    if (this.v === 0n) return "0";
    let mag = (this.v < 0n ? -this.v : this.v).toString();
    if (mag.length <= SCALE_DIGITS) mag = mag.padStart(SCALE_DIGITS + 1, "0");
    const cut = mag.length - SCALE_DIGITS;
    return (this.v < 0n ? "-" : "") + mag.slice(0, cut) + "." + mag.slice(cut);
  }
}

// 解析十进制 / 科学计数法文本，等价于 Real::decimal。
export function parseDecimal(input) {
  let s = String(input).trim();
  let neg = false;
  if (s[0] === "+" || s[0] === "-") {
    neg = s[0] === "-";
    s = s.slice(1);
  }
  let exponent = 0;
  const ep = s.search(/[eE]/);
  if (ep >= 0) {
    exponent = parseInt(s.slice(ep + 1), 10) || 0;
    s = s.slice(0, ep);
  }
  const dot = s.indexOf(".");
  const frac = dot < 0 ? 0 : s.length - dot - 1;
  let digits = dot < 0 ? s : s.slice(0, dot) + s.slice(dot + 1);
  digits = digits.replace(/^0+(?=\d)/, "");
  let x = digits.length > 0 ? BigInt(digits) : 0n;
  const power = SCALE_DIGITS - frac + exponent;
  if (power >= 0) x *= ipow10(power);
  else x /= ipow10(-power); // 等价于重复 divSmall(10)，依然向零截断
  return new Real(neg ? -x : x);
}

// C++ fromLongDouble：30 位有效数字的科学计数法种子。
// 种子只影响迭代路径，不影响收敛到的高精度不动点。
export function fromLongDouble(x) {
  if (!Number.isFinite(x) || x === 0) return new Real(0n);
  return parseDecimal(x.toExponential(29));
}

export const ONE = parseDecimal("1");
export const TWO = parseDecimal("2");
export const HALF = parseDecimal("0.5");
export const PI = parseDecimal(
  "3.141592653589793238462643383279502884197169399375105820974944592307816406"
);

// llround：四舍五入且远离零
function roundHalfAway(x) {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

export function inv(x) {
  if (x.isZero()) return parseDecimal("1e80");
  let r = fromLongDouble(1 / x.ld());
  for (let i = 0; i < 5; i++) r = r.mul(TWO.sub(x.mul(r)));
  return r;
}

export function sqrtR(x) {
  if (x.isZero()) return new Real(0n);
  let y = fromLongDouble(Math.sqrt(Math.max(0, x.ld())));
  if (y.isZero()) y = ONE;
  for (let i = 0; i < 6; i++) y = y.add(x.mul(inv(y))).mul(HALF);
  return y;
}

export function expR(x) {
  const y = x.divInt(16);
  let term = ONE;
  let sum = ONE;
  for (let n = 1; n <= 150; n++) {
    term = term.mul(y).divInt(n);
    sum = sum.add(term);
  }
  for (let i = 0; i < 4; i++) sum = sum.mul(sum);
  return sum;
}

export function sinR(x) {
  let y = x;
  const k = roundHalfAway(y.ld() / (2 * Math.PI));
  if (Math.abs(k) < 1000000) y = y.sub(PI.mul(Real.fromInt(2 * k)));
  const x2 = y.mul(y);
  let term = y;
  let sum = y;
  for (let n = 1; n <= 100; n++) {
    term = term.mul(x2).divInt(2 * n * (2 * n + 1));
    sum = n & 1 ? sum.sub(term) : sum.add(term);
  }
  return sum;
}

export function cosR(x) {
  let y = x;
  const k = roundHalfAway(y.ld() / (2 * Math.PI));
  if (Math.abs(k) < 1000000) y = y.sub(PI.mul(Real.fromInt(2 * k)));
  const x2 = y.mul(y);
  let term = ONE;
  let sum = ONE;
  for (let n = 1; n <= 100; n++) {
    term = term.mul(x2).divInt((2 * n - 1) * (2 * n));
    sum = n & 1 ? sum.sub(term) : sum.add(term);
  }
  return sum;
}

// 便于界面显示：取约 16 位有效数字的指数形式
export function formatReal(r, digits = 15) {
  const x = r.ld();
  if (!Number.isFinite(x)) return r.toString();
  if (x === 0) return "0";
  return x.toExponential(digits);
}