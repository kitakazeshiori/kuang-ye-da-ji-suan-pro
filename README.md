# 旷野大计算 pro

把 LGR 的两道计算图题——**连续数学计算图**（T1）与**连续电路计算离散数学**（T2）——做成一个可以在浏览器里拖拽搭图、按加权节点数 W 计分给星的**可视化计算图编辑器 / 闯关游戏**。

纯静态站点、零构建步骤，直接部署到 GitHub Pages。**所有关卡默认解锁**，可以自由跳关、任意导入导出，方便试玩和出题。

## 关卡

16 个任务 + 沙盒，按难度排序：

| # | 关卡 | 来源 | 分值 | 基准 B | 输入 / 输出 |
|---:|---|---|---:|---:|---:|
| — | 沙盒 | — | — | 自由 | 自由 |
| 1 | 求和 | 自制热身 | 0 | 3 | 2 / 1 |
| 2 | 取反 | 自制热身 | 0 | 2 | 1 / 1 |
| 3 | 相乘 | 自制热身 | 0 | 6 | 2 / 1 |
| 4 | 取整 | T2 · 任务 1 | 5 | 1 | 1 / 1 |
| 5 | 倒数 | T1 · 任务 1 | 5 | 160 | 1 / 1 |
| 6 | 立方根 | T1 · 任务 2 | 6 | 1500 | 1 / 1 |
| 7 | 反正切 | T1 · 任务 3 | 6 | 1200 | 1 / 1 |
| 8 | 第一类完全椭圆积分 | T1 · 任务 4 | 10 | 6200 | 1 / 1 |
| 9 | 第二类完全椭圆积分 | T1 · 任务 5 | 10 | 9800 | 1 / 1 |
| 10 | Jacobi 正弦 | T1 · 任务 6 | 15 | 30000 | 2 / 1 |
| 11 | 四次势的八个矩 | T1 · 任务 7 | 16 | 6000 | 2 / 8 |
| 12 | 第三类完全椭圆积分 | T1 · 任务 8 | 18 | 30000 | 2 / 1 |
| 13 | Gamma 与 log Gamma | T1 · 任务 9 | 14 | 4000 | 1 / 2 |
| 14 | 取模 | T2 · 任务 2 | 25 | 30000 | 2 / 1 |
| 15 | 最大公约数 | T2 · 任务 3 | 35 | 160000 | 2 / 1 |
| 16 | 素性判定 | T2 · 任务 4 | 35 | 160000 | 1 / 1 |

T1 九关与 T2 四关各计 100 分；热身关只给星不给分。T2 的四关按难度拆开插入：取整几乎等于直连（放在热身后），取模 / 最大公约数 / 素性判定比 T1 更难（放在最后）。

星级只看加权节点数 W：`W ≤ B` 三星、`W ≤ 1.5B` 两星、`W < 2B` 一星、`W ≥ 2B` 不通关。

## 玩法与界面

- **无限画布**：拖动或滚轮平移，Ctrl + 滚轮缩放（1%–600%），`F` 适应内容。
- **工具箱拖拽**：左栏列出 10 种节点（`in / const / add / neg / mul / sin / cos / exp / sqrt / out`），直接拖进画布，**松手处即落点**；单击则放在视图中央。节点标签用英文居中显示。
- **nandgame 式连线**：输入端口在顶边、输出端口在底边；从输出端拖到输入端连线，把已连的输入端拖走即断开，拖到空白处松手可现场新建节点并自动接线。节点右侧小三角点开是 `delete` 菜单。
- **高精度数位矩阵**：整数位在上、小数位在下，中间一条分割线。像 Hex Editor 一样按位编辑——单击或拖动选中，输入数字覆盖当前位并右移，`Backspace`/`Delete`/剪切让后续数字整体左移（不是补 0），粘贴整体右移；支持 `Ctrl+A/C/X/V` 与方向键，小数位完整显示 72 位。
- **看谁都能看**：单击任意节点（含 `in` / `out` / 中间节点），左侧数值面板会显示它的精确值，便于查看计算中间结果；**只有输入节点与常数节点可编辑**，其余只读。
- **剩余权重**：顶栏实时显示 `B − W`，为负时变红。
- **题面与帮助**：右上角「题面」打开可拖动、可关闭的悬浮窗，只展示**当前关卡**的输入输出与题目（内置 KaTeX）；所有关卡共用的机器规格与限制放在「？」帮助里。
- **运行检查**：先校验结构（悬空端口、成环、输入输出数量、常数范围、官方上限），再做数值评测，给出通过组数与最大相对误差。
- **编辑体验**：撤销 / 重做、复制 / 粘贴、框选、网格吸附、localStorage 自动保存。

### 导入标准 DAG

工具栏上的导入按钮已移除，但功能仍在：打开浏览器控制台执行 `showImport()` 即可调出导入面板（导入后自动排版）。

## 本地运行

需要一个静态服务器（ES module 不能从 `file://` 加载）：

```powershell
cd site
python -m http.server 5188     # 或 npm run dev / npx serve .
```

然后打开 http://localhost:5188/ 。

## 部署

站点全部使用相对路径，发布在 `https://<user>.github.io/<repo>/` 这种子路径下也能正常工作。

### GitHub Pages

仓库自带 `.github/workflows/pages.yml`：推送到 `main` / `master` 且改动到 `site/**` 时，先跑 `node --test site/tests/`，再把 `site/` 作为 Pages 产物发布。首次需要在仓库 Settings → Pages 把 Source 设为 **GitHub Actions**。

### Cloudflare Pages

连接 Git 仓库，**Build command 留空**，**Build output directory 填 `site`**；或手动上传 `npx wrangler pages deploy site`。

## 目录结构

```text
README.md            本文件（游戏仓库说明）
PROBLEM_T1.md        原 T1 连续数学题的题面说明（本仓库根目录其余 .cpp/.hpp 为其验题包）
site/                纯静态游戏站点（部署产物，零构建）
  index.html
  css/  js/  fonts/  vendor/  data/vectors.json  tests/
tools/               题库与向量生成脚本（node tools/xxx.mjs）
.github/workflows/    Pages 部署工作流
```

## 原题与验题包

- [PROBLEM_T1.md](PROBLEM_T1.md)、[problem.md](problem.md)、[solution.md](solution.md)：T1 连续数学计算图的题面与解析。
- [graph_generator.cpp](graph_generator.cpp)、[builder.hpp](builder.hpp)、[numerics.hpp](numerics.hpp)、[bigreal.hpp](bigreal.hpp)：参考 DAG 生成器与 72 位定点实现。
- [checker.cpp](checker.cpp)、[checker_core.hpp](checker_core.hpp)、[verify.py](verify.py)：testlib special judge 与验题脚本。
- T2（连续电路计算离散数学）见 [../T2](../T2/README.md)。

## 测试与工具

```powershell
cd site
node --test tests/
```

共 48 个用例：图操作与环检测、常数与范围校验、评分系数、序列化往返、空间索引、几何与端口、关卡数据、数位矩阵编辑，以及用真实 std 图核对权重与数值。`build/` 或 `../T2/build` 不存在时，依赖官方图的用例自动跳过（CI 里就是这样）。

| 工具 | 用途 |
|---|---|
| `tools/gen_vectors.mjs` | 调 `build/oracle_probe.exe` 生成 `site/data/vectors.json` |
| `tools/gen_answers.mjs` | 读 `build/task*.graph` 生成 `ans1.txt … ans9.txt` |
| `tools/gen_warmup_vectors.mjs` | 算三个热身关的参考向量 |
| `tools/gen_discrete_vectors.mjs` | 读 `../T2/build/task*.in` 算离散四关的参考向量 |
| `tools/bench_layout.mjs` | 评估自动布局质量、调参 |

> `ans*.txt` 与 `build/` 默认不纳入版本库（避免剧透与提交二进制），需要时可自行重新生成。