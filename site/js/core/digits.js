// 数位矩阵的纯逻辑：解析、序列化、Insert 模式的插入/删除与显示辅助。
// 与 DOM 解耦，便于单测；数值语义复用 bigreal.js 的 parseDecimal。
import { parseDecimal } from "./bigreal.js";

// 把十进制 / 科学计数法文本拆成定长整数位（右对齐）与小数位（左对齐补零）。
export function splitDigits(text, intTotal, fracTotal) {
  const raw = text === undefined || text === null ? "0" : String(text).trim();
  let str;
  try {
    str = parseDecimal(raw === "" ? "0" : raw).toString();
  } catch (err) {
    str = "0";
  }
  let neg = str.startsWith("-");
  if (neg) str = str.slice(1);
  const dot = str.indexOf(".");
  const ip = dot < 0 ? str : str.slice(0, dot);
  const fp = dot < 0 ? "" : str.slice(dot + 1);
  const int = ip.slice(-intTotal).padStart(intTotal, "0");
  const frac = (fp + "0".repeat(fracTotal)).slice(0, fracTotal);
  const digits = (int + frac).split("");
  if (!digits.some((d) => d !== "0")) neg = false;
  return { digits, neg };
}

// 紧凑文本：去掉整数前导 0 与小数末尾 0，用于存储与导出。
export function toText(digits, intTotal, neg) {
  const ip = digits.slice(0, intTotal).join("").replace(/^0+/, "") || "0";
  const fp = digits.slice(intTotal).join("").replace(/0+$/, "");
  const zero = ip === "0" && fp === "";
  return (neg && !zero ? "-" : "") + (fp === "" ? ip : ip + "." + fp);
}

// 完整定点文本：整数位保留前导 0，小数位固定长度。
export function toRawText(digits, intTotal, neg) {
  const ip = digits.slice(0, intTotal).join("");
  const fp = digits.slice(intTotal).join("");
  return (neg ? "-" : "") + ip + "." + fp;
}

// 删除 [from, to) 并把后面的数字整体左移，末尾补 0；返回新光标位置。
export function applyDelete(digits, from, to, total) {
  const lo = Math.max(0, from);
  const hi = Math.min(to, total);
  if (hi <= lo) return Math.max(0, Math.min(lo, total - 1));
  digits.splice(lo, hi - lo);
  while (digits.length < total) digits.push("0");
  if (digits.length > total) digits.length = total;
  return Math.max(0, Math.min(lo, total - 1));
}

// 在 at 处插入文本（后面的数字右移，溢出丢弃）。
// '.' / ',' 把光标移到小数首位，'-' 反转符号。返回新的 { caret, neg }。
export function applyInsert(digits, at, text, total, intTotal, neg) {
  let sign = !!neg;
  let caret = Math.max(0, Math.min(at, total - 1));
  for (const ch of String(text === undefined || text === null ? "" : text)) {
    if (ch === "-") {
      sign = !sign;
      continue;
    }
    if (ch === "." || ch === ",") {
      caret = Math.min(intTotal, total - 1);
      continue;
    }
    if (ch < "0" || ch > "9") continue;
    if (caret >= total - 1) {
      digits[total - 1] = ch;
      continue;
    }
    digits.splice(caret, 0, ch);
    if (digits.length > total) digits.length = total;
    caret += 1;
  }
  if (!digits.some((d) => d !== "0")) sign = false;
  return { caret, neg: sign };
}

// 选区文本：跨过小数点时补上 '.'，选区含首位且为负时补 '-'。
export function selectionText(digits, intTotal, a, b, neg) {
  let out = a === 0 && neg ? "-" : "";
  for (let i = a; i < b; i++) {
    if (i === intTotal && b > intTotal) out += ".";
    out += digits[i];
  }
  return out;
}

// 第 i 格对应的位权指数（10^place）。
export function placeOf(i, intTotal) {
  return i < intTotal ? intTotal - 1 - i : -(i - intTotal + 1);
}

// 该位是否属于「前导 0」或「末尾 0」，界面上淡显。
export function isDim(digits, i, intTotal) {
  if (digits[i] !== "0") return false;
  if (i < intTotal) {
    for (let k = 0; k < i; k++) if (digits[k] !== "0") return false;
    return true;
  }
  for (let k = i + 1; k < digits.length; k++) if (digits[k] !== "0") return false;
  return true;
}

export function isZero(digits) {
  return !digits.some((d) => d !== "0");
}