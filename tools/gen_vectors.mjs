// 离线生成评测参考值：调用 build/oracle_probe.exe（题面自带的 C++ oracle），
// 把 9 个任务的官方测试输入与高精度参考输出固化到 site/data/vectors.json。
//
// 用法：node tools/gen_vectors.mjs
// 需要先编译 oracle_probe（见 verify.py / README）。参考值只在前端评测时对照，
// 与 bigreal.hpp 的数值语义保持一致。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "build", process.platform === "win32" ? "oracle_probe.exe" : "oracle_probe");
const outFile = join(root, "site", "data", "vectors.json");

const OUT_COUNT = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 8, 8: 1, 9: 2 };

const result = {};
// 保留热身关等非 taskN 条目（由 tools/gen_warmup_vectors.mjs 生成），避免被覆盖。
try {
  const prev = JSON.parse(readFileSync(outFile, "utf8"));
  for (const k of Object.keys(prev)) if (!/^task\d+$/.test(k)) result[k] = prev[k];
} catch {}
for (let task = 1; task <= 9; task++) {
  const inFile = join(root, "build", `task${task}.in`);
  const text = readFileSync(inFile, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (Number(lines[0]) !== task) throw new Error(`task${task}.in 头部任务号不符`);
  const caseCount = Number(lines[1]);
  const rows = lines.slice(2, 2 + caseCount).map((l) => l.trim().split(/\s+/));
  if (rows.length !== caseCount) throw new Error(`task${task}.in 测试组数不符`);
  const nin = Number(rows[0][0]);
  for (const r of rows) {
    if (Number(r[0]) !== nin || r.length !== nin + 1) throw new Error(`task${task}.in 输入元数不一致`);
  }

  const stdout = execFileSync(exe, { input: text, encoding: "utf8" });
  const outLines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (outLines.length !== caseCount) throw new Error(`oracle 输出组数 ${outLines.length} != ${caseCount}`);

  const cases = rows.map((r, i) => {
    const expected = outLines[i].trim().split(/\s+/);
    if (expected.length !== OUT_COUNT[task]) throw new Error(`task${task} 第 ${i} 组输出个数 ${expected.length} != ${OUT_COUNT[task]}`);
    return { inputs: r.slice(1, 1 + nin), expected };
  });
  result[`task${task}`] = { inputs: nin, outputs: OUT_COUNT[task], cases };
  console.log(`task${task}: ${cases.length} 组, ${nin} 入 ${OUT_COUNT[task]} 出`);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(result) + "\n", "utf8");
console.log(`wrote ${outFile} (${JSON.stringify(result).length} bytes)`);