// 离散数学四关（T2）的参考值：输入取自 ../T2/build/task*.in（官方测试输入），
// 期望输出用普通整数运算直接算（floor / mod / gcd / 试除素性），与计算图无关。
// 结果合并进 site/data/vectors.json，不影响 T1 九关由 oracle_probe 生成的参考值。
//
// 用法：node tools/gen_discrete_vectors.mjs [T2 build 目录，默认 ../T2/build]
//
// 注意：T2 的官方数据组数较多（素性 126 组），而 64 位定点图上一次求值很贵，
// 这里对 gcd / prime 只保留一组有代表性的用例，避免浏览器里跑几十秒。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(root, process.argv[2] || "../T2/build");
const outFile = join(root, "site", "data", "vectors.json");

const LEVEL_KEY = { 1: "floor", 2: "mod", 3: "gcd", 4: "prime" };

function gcd(a, b) {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function isPrime(n) {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

const FORMULA = {
  floor: ([n]) => n,
  mod: ([x, m]) => x % m,
  gcd: ([a, b]) => gcd(a, b),
  prime: ([n]) => (isPrime(n) ? 1 : 0),
};

// 保留哪些用例（其余只在官方 checker 里跑）。
const KEEP = {
  floor: null, // 全部
  mod: null, // 全部
  gcd: [[1, 1], [1, 63], [63, 62], [48, 18], [63, 42], [55, 34], [34, 55], [62, 63], [32, 16], [47, 56], [9, 3], [51, 45]],
  prime: [[2], [3], [4], [5], [7], [9], [11], [13], [15], [17], [19], [23], [25], [29], [31], [49], [64], [97], [121], [127]],
};

function readCases(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const count = Number(lines[1]);
  return lines.slice(2, 2 + count).map((l) => l.trim().split(/\s+/).slice(1).map(Number));
}

const vectors = JSON.parse(readFileSync(outFile, "utf8"));
for (const task of [1, 2, 3, 4]) {
  const key = LEVEL_KEY[task];
  const all = readCases(join(buildDir, `task${task}.in`));
  let cases = all;
  const keep = KEEP[key];
  if (keep) {
    const wanted = new Map(keep.map((row) => [row.join(","), row]));
    cases = all.filter((row) => wanted.has(row.join(",")));
    if (cases.length !== keep.length) {
      const got = new Set(cases.map((r) => r.join(",")));
      const missing = keep.filter((r) => !got.has(r.join(",")));
      throw new Error(`${key}: 官方数据里找不到 ${JSON.stringify(missing)}`);
    }
  }
  vectors[key] = {
    inputs: cases[0].length,
    outputs: 1,
    cases: cases.map((row) => ({
      inputs: row.map(String),
      expected: [String(FORMULA[key](row))],
    })),
  };
  console.log(`${key}: ${cases.length}/${all.length} 组, ${vectors[key].inputs} 入 1 出`);
}
writeFileSync(outFile, JSON.stringify(vectors) + "\n", "utf8");
console.log(`wrote ${outFile} (${JSON.stringify(vectors).length} bytes)`);