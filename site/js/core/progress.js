// 闯关进度与星级：纯函数，方便单测，也方便以后加更多权重玩法。
//
// 星级只由加权节点数 W 与满分基准 B 决定：
//   W ≤ B        → 三星
//   W ≤ 1.5B     → 两星
//   W < 2B       → 一星
//   W ≥ 2B       → 0 星（系数为 0，不能通关）
import { scoreFactor } from "./validate.js";

export const MAX_STARS = 3;

export function starsFor(base, cost) {
  if (!base) return 0;
  if (cost <= base) return 3;
  if (cost <= base * 1.5) return 2;
  if (cost < base * 2) return 1;
  return 0;
}

export function starsText(n) {
  const k = Math.max(0, Math.min(MAX_STARS, Math.round(n || 0)));
  return "★★★".slice(0, k) + "☆☆☆".slice(0, MAX_STARS - k);
}

// 通关条件只看 W：W < 2B 才算进入得分区间（此时至少一星）。
export function isPassed(level, cost) {
  return !!(level && level.base) && cost < 2 * level.base;
}

export function scoreFor(level, cost) {
  if (!level || !level.base) return 0;
  return Math.floor(level.points * scoreFactor(cost, level.base));
}

export function clearEntry(level, cost, now = Date.now()) {
  return {
    passed: isPassed(level, cost),
    stars: starsFor(level.base, cost),
    score: scoreFor(level, cost),
    bestW: cost,
    at: now,
  };
}

// 同一关重复通关时保留最好成绩。
export function mergeResult(prev, entry) {
  if (!prev) return entry;
  return {
    passed: !!(prev.passed || entry.passed),
    stars: Math.max(prev.stars || 0, entry.stars || 0),
    score: Math.max(prev.score || 0, entry.score || 0),
    bestW: Math.min(prev.bestW === undefined ? Infinity : prev.bestW, entry.bestW),
    at: entry.at,
  };
}

// 游戏模式下所有关卡默认解锁，不依赖通关进度。
export function isUnlocked() {
  return true;
}

export function totalStars(tasks, progress) {
  let n = 0;
  for (const t of tasks) {
    const p = progress[t.key];
    if (p) n += p.stars || 0;
  }
  return n;
}

export function totalScore(tasks, progress) {
  let n = 0;
  for (const t of tasks) {
    const p = progress[t.key];
    if (p) n += p.score || 0;
  }
  return n;
}