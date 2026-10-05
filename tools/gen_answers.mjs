// 用仓库里现成的标准图 build/taskK.graph 生成答案文件 ansK.txt（题面《提交格式》）。
// 走一遍 site 的解析 + 导出，顺带校验拓扑序与引用合法性。
// 用法：node tools/gen_answers.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromProblemText, toProblemText } from "../site/js/core/serialize.js";
import { TASKS } from "../site/js/core/levels.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const norm = (s) => s.replace(/\r\n?/g, "\n");

let bad = 0;
for (const task of TASKS) {
  const src = join(root, "build", task.key + ".graph");
  const raw = readFileSync(src, "utf8");
  const { graph, warnings } = fromProblemText(raw);
  const text = toProblemText(graph);

  const outNodes = graph.outNodes();
  const emits = graph.size - outNodes.length;
  const outs = outNodes[0].inputs.length;
  const cost = graph.cost();

  const same = norm(raw).trim() === text.trim();
  if (!same) bad++;
  const out = join(root, "ans" + task.id + ".txt");
  writeFileSync(out, text, "utf8");

  console.log(
    "ans" + task.id + ".txt  " + emits + " 节点 · " + outs + " 输出 · W=" + cost +
    (same ? "  (与源文件一致)" : "  ⚠ 与源文件不同，已按拓扑序重排") +
    (warnings.length ? "  ⚠ " + warnings.length + " 条导入告警" : "")
  );
}

console.log(bad ? "\n有 " + bad + " 个文件被重排（已写入 ans*.txt）。" : "\n九个 ans*.txt 全部与 build/task*.graph 一致。");