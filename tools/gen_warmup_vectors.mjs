// 热身关的参考值：这三关只用到加法 / 取反 / 乘法，定点语义就是 bigreal 的精确定义，
// 因此直接用 bigreal.js 算出期望值，合并进 site/data/vectors.json。
// 官方九关的参考值仍然由 tools/gen_vectors.mjs 调 build/oracle_probe.exe 生成。
//
// 用法：node tools/gen_warmup_vectors.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS } from "../site/js/core/levels.js";
import { parseDecimal } from "../site/js/core/bigreal.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "site", "data", "vectors.json");

// 每个热身关的期望输出（输入按 probes 顺序）。
const FORMULA = {
  warm1: (a, b) => a.add(b),
  warm2: (a) => a.neg(),
  warm3: (a, b) => a.mul(b),
};

const vectors = JSON.parse(readFileSync(outFile, "utf8"));
for (const task of TASKS) {
  const f = FORMULA[task.key];
  if (!f) continue;
  const cases = task.probes.map((probe) => ({
    inputs: probe.map(String),
    expected: [f(...probe.map((x) => parseDecimal(String(x)))).toString()],
  }));
  vectors[task.key] = { inputs: task.inputs, outputs: task.outputs, cases };
  console.log(`${task.key}: ${cases.length} 组, ${task.inputs} 入 ${task.outputs} 出`);
}
writeFileSync(outFile, JSON.stringify(vectors) + "\n", "utf8");
console.log(`wrote ${outFile} (${JSON.stringify(vectors).length} bytes)`);