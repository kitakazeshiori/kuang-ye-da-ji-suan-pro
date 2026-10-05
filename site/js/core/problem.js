// 题面内容（含 LaTeX）：「题面」悬浮面板只展示**当前关卡**的题目与限制，用 KaTeX 渲染。
// 文案与仓库根目录 problem.md 保持一致。

export const PROBLEM_TITLE = "连续数学计算图";

// 各关卡的题目正文（不含标题，标题由面板头部给出）；warm* 是自制的热身关，floor/mod/gcd/prime 来自 T2《连续电路计算离散数学》。
export const PROBLEM_TASKS = {
  warm1: String.raw`<p>按顺序输入 \(a,b\)（\(-1\le a,b\le 1\)），输出 \(a+b\)。</p>`,
  warm2: String.raw`<p>输入 \(a\)（\(-1\le a\le 1\)），输出 \(-a\)。</p>`,
  warm3: String.raw`<p>按顺序输入 \(a,b\)（\(-1\le a,b\le 1\)），输出 \(a\cdot b\)。</p>`,  task1: String.raw`<p>输入 \(x\)，\(1\le x\le 2\)，输出 \(1/x\)。</p>`,
  task2: String.raw`<p>输入 \(x\)，\(1\le x\le 8\)，输出实数立方根。</p>`,
  task3: String.raw`<p>输入 \(x\)，\(-1\le x\le 1\)，输出主值 \(\arctan(x)\)。</p>`,
  task4: String.raw`<p>输入 \(k\)，\(0.2\le k\le 0.9\)，输出</p>
$$K(k)=\int_0^{\pi/2}(1-k^2\sin^2\theta)^{-1/2}\,d\theta.$$`,
  task5: String.raw`<p>输入 \(k\)，\(0.2\le k\le 0.9\)，输出</p>
$$E(k)=\int_0^{\pi/2}(1-k^2\sin^2\theta)^{1/2}\,d\theta.$$`,
  task6: String.raw`<p>按顺序输入 \(k,u\)（\(0.2\le k\le 0.9\)，\(-1\le u\le 1\)）。输出满足</p>
$$u=\int_0^{\arcsin(\operatorname{sn}(u,k))}(1-k^2\sin^2\theta)^{-1/2}\,d\theta$$
<p>且 \(\operatorname{sn}(0,k)=0\) 的唯一实数函数值。</p>`,
  task7: String.raw`<p>按顺序输入 \(a,b\)（\(-2\le a\le 2\)，\(-1\le b\le 1\)）。按 \(r=0,1,\dots,7\) 的顺序输出</p>
$$I_r(a,b)=\int_{-1}^{1}t^r\exp(-t^4-at^2-bt)\,dt.$$
<p>八个答案必须由同一张图产生。</p>`,
  task8: String.raw`<p>按顺序输入 \(k,n\)（\(0.2\le k\le 0.9\)，\(-0.5\le n\le 0.5\)）。输出</p>
$$\Pi(n,k)=\int_0^{\pi/2}\frac{d\theta}{(1-n\sin^2\theta)\sqrt{1-k^2\sin^2\theta}}.$$`,
  task9: String.raw`<p>输入 \(x\)，\(1\le x\le 2\)。按顺序输出 \(\Gamma(x)\) 与 \(\ln\Gamma(x)\)，其中</p>
$$\Gamma(x)=\int_0^\infty t^{x-1}e^{-t}\,dt.$$
<p>\(\ln\) 为自然对数；机器没有对数节点。</p>`,
  floor: String.raw`<p>输入整数 \(n\)（\(0\le n\le 63\)），输出 \(\lfloor n\rfloor\)。</p>`,
  mod: String.raw`<p>按顺序输入整数 \(x,m\)（\(0\le x\le255\)，\(2\le m\le31\)），输出 \(x\bmod m\)。</p>`,
  gcd: String.raw`<p>按顺序输入整数 \(a,b\)（\(1\le a,b\le63\)），输出 \(\gcd(a,b)\)。任意中间节点都必须有定义，即使某轮计算得到零余数。</p>`,
  prime: String.raw`<p>输入整数 \(n\)（\(2\le n\le127\)）。若 \(n\) 为素数输出 \(1\)，否则输出 \(0\)。</p>`,};

export const PROBLEM_SANDBOX =
  "<p>沙盒是自由搭建模式：没有输入 / 输出数量约束，也没有基准 B，方便试验子图或导入现成计算图。</p>";

export function problemForLevel(key) {
  return PROBLEM_TASKS[key] || PROBLEM_SANDBOX;
}

// 所有关卡共用的机器规格与限制：只在右上角「？」帮助面板里展示，题面悬浮窗不再重复。
export const PROBLEM_LIMITS = String.raw`
<p><b>数值判定。</b>实数用随题提供的自包含 72 位十进制定点实现；加减乘按规则截断，初等函数由其近似计算。输出 \(z\) 与标准答案 \(y\) 满足下式即为正确，多输出逐项判定，任一项错误该任务即不得分：</p>
$$|z-y|\le10^{-45}\max(1,|y|)$$
<p><b>规模与实现范围。</b>每张图最多 180000 个节点、500000 条节点引用；OUT 的输出引用不计入该限制和权重。所有节点都会执行，包括未被引用的节点。中间值绝对值不得超过 \(10^{60}\)；S/T 参数绝对值小于 \(10^6\)；E 参数绝对值小于 100；Q 参数非负。常数文本最大 256 字符，采用普通十进制或科学计数法，十进制指数绝对值不超过 300。</p>
<p><b>输出格式。</b>节点从 1 编号，必须按拓扑序输出且只引用更小的编号。第一行是节点数 \(N\)，随后 \(N\) 行依次建立节点 1 至 \(N\)，最后一行是 <code>OUT k</code> 与 k 个节点编号。</p>
`;