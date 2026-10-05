# 连续数学计算图

原 T1 的连续任务 1--6 保留；原离散任务 7--10 已拆分到 [T2](../T2/README.md)，编号改为 1--4。本目录新增三个需要离线数学计算和 DAG 生成的任务：

| 编号 | 任务 | std 主要构造 | 输出数 | std 加权大小 |
|---|---|---|---:|---:|
| 1 | 倒数 | Newton | 1 | 103 |
| 2 | 立方根 | 嵌套 Newton | 1 | 1375 |
| 3 | 反正切 | 二次收敛迭代 | 1 | 301 |
| 4 | 第一类椭圆积分 | AGM | 1 | 343 |
| 5 | 第二类椭圆积分 | AGM 修正和 | 1 | 511 |
| 6 | Jacobi sn | AGM + theta 展开 | 1 | 2351 |
| 7 | 四次势八个积分矩 | 96 点 Gauss 求积 + 分部积分递推 | 8 | 4273 |
| 8 | 第三类椭圆积分 | Carlson 倍增 + 截断系数卷积 | 1 | 16080 |
| 9 | Gamma/log Gamma | 平移 + Stirling + 对数级数 | 2 | 1210 |

## 文件

- [problem.md](problem.md)：完整题面、分值、评分基准和机器范围。
- [solution.md](solution.md)：公式推导、截断误差、生成器组织方式及评测方法。
- [std.cpp](std.cpp)：参考提交入口，只读取任务编号。
- [graph_generator.cpp](graph_generator.cpp)：九项参考 DAG 构造；可单独编译。
- [builder.hpp](builder.hpp)：节点构建、常数去重及输出。
- [numerics.hpp](numerics.hpp)：离线常数计算及 checker 参考算法。
- [checker.cpp](checker.cpp)、[checker_core.hpp](checker_core.hpp)：testlib special judge。
- [bigreal.hpp](bigreal.hpp)：自包含 72 位小数，无 Boost/GMP/MPFR 依赖。
- [test_generator.cpp](test_generator.cpp)：端点、近端点、对称参数和固定种子随机数据。
- [verify.py](verify.py)、[oracle_probe.cpp](oracle_probe.cpp)：验题与独立高精度核对工具。

## 编译和验题

在本目录执行：

~~~powershell
g++ -std=c++17 -O2 std.cpp -o std.exe
g++ -std=c++17 -O2 checker.cpp -o checker.exe
g++ -std=c++17 -O2 test_generator.cpp -o test_generator.exe
python verify.py
~~~

verify.py 不依赖第三方 Python 库。可选的独立验证需要 mpmath：

~~~powershell
python verify.py --independent
~~~

保留可检查的二进制、九张图及测试输入：

~~~powershell
python verify.py --independent --build build
~~~

生成 build/taskT.graph 与 build/taskT.in，并用 checker 执行。标准 testlib 调用顺序：

~~~text
checker.exe <input> <contestant-output> <answer>
~~~

answer 文件只需存在，内容不参与判断。checker 返回任务得分系数，平台负责乘任务分值并取整。

## 当前验证

九张 std 图均在随附测试上通过并取得系数 1.0；每项三个代表输入的 oracle 与 90 位 mpmath 结果按 10^-48 阈值核对通过；六项非法图拒绝测试通过。这不是对全部实数输入的枚举，统一截断误差分析见解析。

在当前机器上，新增三项完整回归约分别为 0.2、1.5、0.2 秒；T2 的大型离散电路较慢，因此统一建议将 checker 时限单独设为 60 秒。正式比赛仍需在目标机器校准时限和评分基准。
## 可视化编辑器 / 游戏网站

本目录还附了一个可部署到 GitHub Pages 或 Cloudflare Pages 的静态站点 `site/`：把本题做成带无限画布、nandgame 式拉线、按加权节点数 W 计分给星、九个任务逐个解锁闯关，以及浏览器端高精度数值评测的可视化计算图编辑器。运行方式、部署步骤与后续路线见 [site/README.md](site/README.md)。