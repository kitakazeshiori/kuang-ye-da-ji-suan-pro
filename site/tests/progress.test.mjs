// 闯关进度规则测试：星级、通关判定、解锁、成绩合并。
import test from "node:test";
import assert from "node:assert/strict";
import {
  starsFor,
  starsText,
  isPassed,
  scoreFor,
  clearEntry,
  mergeResult,
  isUnlocked,
  totalStars,
  totalScore,
} from "../js/core/progress.js";
import { TASKS, SANDBOX, LEVELS, getLevel } from "../js/core/levels.js";

const B = 1000;
const level = { key: "t", name: "t", points: 10, base: B, inputs: 1, outputs: 1 };

test("三星 / 两星 / 一星 / 0 星的边界", () => {
  assert.equal(starsFor(B, B), 3);
  assert.equal(starsFor(B, B - 1), 3);
  assert.equal(starsFor(B, B + 1), 2);
  assert.equal(starsFor(B, Math.floor(B * 1.5)), 2);
  assert.equal(starsFor(B, Math.floor(B * 1.5) + 1), 1);
  assert.equal(starsFor(B, 2 * B - 1), 1);
  assert.equal(starsFor(B, 2 * B), 0);
  assert.equal(starsFor(B, 5 * B), 0);
  assert.equal(starsFor(null, 1), 0);
});

test("starsText 始终是三个符号", () => {
  assert.equal(starsText(0), "☆☆☆");
  assert.equal(starsText(1), "★☆☆");
  assert.equal(starsText(2), "★★☆");
  assert.equal(starsText(3), "★★★");
  assert.equal(starsText(9), "★★★");
  assert.equal(starsText(-1), "☆☆☆");
});

test("通关判定与得分与 f(W) 一致", () => {
  assert.equal(isPassed(level, B), true);
  assert.equal(isPassed(level, 2 * B - 1), true);
  assert.equal(isPassed(level, 2 * B), false);
  assert.equal(isPassed(SANDBOX, 10), false);

  assert.equal(scoreFor(level, B), 10);
  assert.equal(scoreFor(level, 1.5 * B), Math.floor(10 * 0.5));
  assert.equal(scoreFor(level, 2 * B), 0);
  assert.equal(scoreFor(SANDBOX, 10), 0);
});

test("clearEntry 组合星级与得分", () => {
  const e = clearEntry(level, 900, 1234);
  assert.deepEqual(e, { passed: true, stars: 3, score: 10, bestW: 900, at: 1234 });
});

test("mergeResult 保留最好星级 / 得分 / 最小 W", () => {
  const first = clearEntry(level, 1900, 1); // 一星，得分 1
  const better = clearEntry(level, 800, 2); // 三星，得分 10
  const merged = mergeResult(first, better);
  assert.equal(merged.stars, 3);
  assert.equal(merged.score, 10);
  assert.equal(merged.bestW, 800);
  const worse = mergeResult(better, clearEntry(level, 1999, 3));
  assert.equal(worse.stars, 3);
  assert.equal(worse.score, 10);
  assert.equal(worse.bestW, 800);
  assert.equal(mergeResult(null, better), better);
});

test("所有关卡默认解锁", () => {
  assert.equal(isUnlocked(TASKS, {}, "sandbox"), true);
  assert.equal(isUnlocked(TASKS, {}, "task1"), true);
  assert.equal(isUnlocked(TASKS, {}, "task2"), true);
  assert.equal(isUnlocked(TASKS, {}, "task5"), true);
  assert.equal(isUnlocked(TASKS, {}, "task9"), true);
  assert.equal(isUnlocked(TASKS, { task1: { passed: false } }, "task3"), true);
});

test("总分与总星数统计", () => {
  const t1 = getLevel("task1");
  const t2 = getLevel("task2");
  const t3 = getLevel("task3");
  const p = {
    task1: clearEntry(t1, 100), // 5 分，三星
    task2: clearEntry(t2, t2.base * 2), // 0 分，0 星
    task3: clearEntry(t3, t3.base * 1.4), // 两星
  };
  // task1 三星 5 分；task2 恰好 2B 得 0 分 0 星；task3 系数 0.6 → 6×0.6 = 3.6 向下取整 3 分、两星
  assert.equal(totalStars(TASKS, p), 5);
  assert.equal(totalScore(TASKS, p), 8);
});

test("关卡表与问题定义一致", () => {
  assert.equal(LEVELS.length, 17);
  const total = TASKS.reduce((s, t) => s + t.points, 0);
  assert.equal(total, 200); // 连续数学 100 + 离散数学 100（热身关 0 分）
  assert.deepEqual(
    TASKS.map((t) => t.base),
    [3, 2, 6, 1, 160, 1500, 1200, 6200, 9800, 30000, 6000, 30000, 4000, 30000, 160000, 160000]
  );
  assert.deepEqual(
    TASKS.map((t) => t.outputs),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 8, 1, 2, 1, 1, 1]
  );
});