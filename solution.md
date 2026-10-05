# 出题人解析：连续数学计算图

## 参考提交和任务拆分

std.cpp 是参考提交程序，包含 graph_generator.cpp；二者编译后行为相同：只读任务编号，输出最终 DAG。生成阶段允许任意普通 C++ 控制流和高精度计算；输出的机器只有题面列出的节点。

原 T1 的连续任务 1--6 保留编号。原任务 7--10 分离到 ../T2，重新编号为 1--4。T1 的新任务 7--9 分别是八个参数积分矩、第三类完全椭圆积分、Gamma/log Gamma。

生成器使用 bigreal.hpp 在生成阶段计算高精度常数，因此不需要第三方库或外部常数文件。numerics.hpp 提供 Legendre 根、权重和归一化 Bernoulli 系数的生成。不能用 double/long double 打印最终常数；它们只能给离线 Newton 提供初值。

## 共同工具：倒数子图

展开

$$r_{i+1}=r_i(2-zr_i).$$

令 e_i=1-zr_i，则 e_{i+1}=e_i^2。给定整个输入域上有效的种子和固定轮数，便得到没有除法节点的倒数。常数除法在生成阶段完成，然后输出为乘法节点。

Builder 对文本相同的常数去重。图中的复用不额外收费，多个输出必须共用一张图。

## 任务 1--3

倒数：x 属于 [1,2]，种子 3/8，初始误差绝对值至多 5/8；10 轮误差小于 (5/8)^1024。

立方根：从 y=3/2 展开 10 轮

$$y_{\rm new}=\frac{2y+x/y^2}{3}.$$

每轮 y^2 的倒数使用种子 1/4，12 轮。初值一次更新后在根的上方，之后递减到根；所有 y 位于 [1,59/27]，故倒数初始相对误差绝对值至多 3/4。最坏端点和随机输入由验题脚本覆盖。

反正切：解 sin(y)-x cos(y)=0，使用

$$y_{\rm new}=y-(\sin y-x\cos y)\cos y.$$

这不是原方程的精确 Newton 步；它在目标根处具有正确的一阶修正，因此局部二次收敛。若根为 alpha=arctan(x)、误差为 e，修正项为 sin(e) cos(e)-x sin(e)^2。从 y=x 出发，|e|<=1-pi/4<0.215；Taylor 界给出 |e_new|<=1.15|e|^2，且误差继续留在该区间。std 展开 10 轮。

## 任务 4--6：AGM 和 theta 函数

令 a_0=1，b_0=sqrt(1-k^2)，展开 10 轮

$$a_{i+1}=(a_i+b_i)/2,\qquad b_{i+1}=\sqrt{a_i b_i}.$$

由 AGM 定理，

$$K(k)=\frac{\pi}{2\operatorname{AGM}(1,\sqrt{1-k^2})}.$$

第二类积分同时维护 c_0=k、c_{i+1}=(a_i-b_i)/2：

$$E(k)=K(k)\left(1-\frac{k^2}{2}
-\sum_{i=0}^{\infty}2^i c_{i+1}^2\right).$$

注意代码中第 i 轮差分项的系数是 2^i；初始化的 k^2/2 单独处理。用迭代比率 t=(a-b)/(a+b) 可得到 t_new=O(t^2)，从而迅速压低余项。

任务 6 计算 K=K(k)、Kc=K(sqrt(1-k^2))，再令

$$q=e^{-\pi Kc/K},\qquad v=\pi u/(2K).$$

利用

$$\operatorname{sn}(u,k)=
\frac{\vartheta_3(0,q)\vartheta_1(v,q)}
{\vartheta_2(0,q)\vartheta_4(v,q)},$$

其中

$$\vartheta_1(v,q)=2\sum_{n\ge0}(-1)^nq^{(n+1/2)^2}\sin((2n+1)v),$$
$$\vartheta_2(0,q)=2\sum_{n\ge0}q^{(n+1/2)^2},$$
$$\vartheta_3(0,q)=1+2\sum_{n\ge1}q^{n^2},$$
$$\vartheta_4(v,q)=1+2\sum_{n\ge1}(-1)^nq^{n^2}\cos(2nv).$$

q<0.11。std 保留 n<=12，下一项远小于所需误差；q^(1/4) 用两次平方根，整数幂采用共享递推。分母在题面区间内有统一正下界。

## 任务 7：八个积分矩

### 从八次求积缩减到三次

记 F(t)=exp(-t^4-at^2-bt)，则

$$\frac{d}{dt}(t^r F(t))
=(rt^{r-1}-4t^{r+3}-2at^{r+1}-bt^r)F(t).$$

积分边界项为

$$B_r=e^{-1-a-b}-(-1)^r e^{-1-a+b}.$$

所以

$$I_{r+3}=\frac{rI_{r-1}-2aI_{r+1}-bI_r-B_r}{4}.$$

r=0 时不读取 I_{-1}，第一项直接为零。直接计算 I_0,I_1,I_2，再用 r=0,...,4 恢复 I_3,...,I_7。边界指数只有两个，全部复用。

### 离线构造 Gauss--Legendre 规则

N=96；求 P_N 的 96 个根 t_j，并生成

$$w_j=\frac{2}{(1-t_j^2)P_N'(t_j)^2}.$$

Legendre 递推和导数为

$$(m+1)P_{m+1}=(2m+1)tP_m-mP_{m-1},$$
$$P_N'(t)=N(tP_N-P_{N-1})/(t^2-1).$$

用余弦给出 long double 初值，随后以 72 位小数展开 8 轮离线 Newton；只求一半根，再利用对称性。数值常数使用 Real::str() 输出全部 72 位小数。

最终图中，每个节点 t_j 只计算一次 exp(-t_j^4-at_j^2-bt_j)，随后通过三个常数权重累加到前三个矩。八个矩共用指数节点。

### 统一误差界

取 Bernstein 椭圆参数 rho=2，则 |t|<=1.25。在该椭圆上，对 r=0,1,2，

$$|t^r e^{-t^4-at^2-bt}|
\le1.25^2 e^{1.25^4+2(1.25)^2+1.25}<1500.$$

Chebyshev 截断到次数 d 的一致误差不超过 2M rho^(-d)/(rho-1)。Gauss 规则对 d=191 精确，且权重为正、权重和为 2，因此积分与求积之差不超过

$$8M\,2^{-191}<4\cdot10^{-54}.$$

这只是精确节点和权重下的求积误差。生成常数误差、节点截断及初等函数误差另行计入；当前实现保留到 72 位，验题还会独立核对最终输出。

递推五次中，|a|<=2、|b|<=1、r<=4，误差满足

$$|\epsilon_{r+3}|
\le(r|\epsilon_{r-1}|+4|\epsilon_{r+1}|+|\epsilon_r|+|\epsilon_{B_r}|)/4.$$

粗略按每轮三倍放大也只增加有限因子，远低于 10^-45。

### checker 的独立算法

展开 F(t)=sum c_n t^n：

$$c_0=1,\qquad
nc_n=-bc_{n-1}-2ac_{n-2}-4c_{n-4},$$

负下标视为零。逐项积分：

$$I_r=\sum_{n+r\text{ 为偶数}}\frac{2c_n}{n+r+1}.$$

checker 取 n<=400。圆 |t|=2 上 |F(t)|<=e^26，由 Cauchy 系数界可控制尾项为 O(e^26 2^-400)，小于 10^-108。这与 std 的 Gauss 求积和矩递推不同。

## 任务 8：第三类完全椭圆积分

### 化为 Carlson 对称积分

定义

$$R_F(x,y,z)=\frac12\int_0^\infty
\frac{dt}{\sqrt{(t+x)(t+y)(t+z)}},$$

$$R_J(x,y,z,p)=\frac32\int_0^\infty
\frac{dt}{(t+p)\sqrt{(t+x)(t+y)(t+z)}}.$$

令 t=cot^2(theta)，把 (t+1)/(t+1-n) 拆成 1+n/(t+1-n)，得到

$$\Pi(n,k)=R_F(0,1-k^2,1)+\frac n3R_J(0,1-k^2,1,1-n).$$

### 倍增和修正项

记 sx=sqrt(x)、sy=sqrt(y)、sz=sqrt(z)，以及

$$\lambda=s_xs_y+s_ys_z+s_zs_x,$$
$$x'=(x+\lambda)/4,\quad y'=(y+\lambda)/4,\quad
z'=(z+\lambda)/4,\quad p'=(p+\lambda)/4.$$

Carlson duplication 恒等式给出

$$R_F(x,y,z)=R_F(x',y',z'),$$
$$R_J(x,y,z,p)=3R_C(\alpha,\beta)+\frac14R_J(x',y',z',p'),$$

其中

$$\alpha=[p(s_x+s_y+s_z)+s_xs_ys_z]^2,\qquad
\beta=p(p+\lambda)^2,$$

且 R_C(alpha,beta)=R_F(alpha,beta,beta)。累计第 j 轮修正项时乘以 3*4^(-j)，终端 RJ 乘以 4^(-16)。

### R_C 的一元展开

设 d=1-alpha/beta，c_j=binom(2j,j)/4^j，则

$$R_C(\alpha,\beta)
=\beta^{-1/2}\sum_{j\ge0}\frac{c_jd^j}{2j+1}.$$

std 取 j=0,...,95，用 Horner 展开。第一轮令 s=sqrt(1-k^2)，有

$$\alpha/\beta=p(s+1)^2/(p+s)^2.$$

在题面矩形域上求极值可得 |d|<1/4。又有

$$\beta-\alpha=(p-x)(p-y)(p-z),$$

每次倍增使右边缩小为 1/64。第一轮之后 x>=0.108、y>=0.156、z>=0.358、p>=0.233，因此下一轮 beta>0.14；之后所有参数至少为 0.108，可得后续 beta>0.02。结合初始差值绝对值小于 1，后续仍有 |d|<1/4。

因 c_j<=1，96 项的尾和小于 (1/4)^96/(1-1/4)；考虑 beta^(-1/2) 和全部修正项，误差仍小于 10^-56。

倒数 beta 使用种子 1/16，18 轮；sqrt(beta) 的倒数使用种子 1/4，16 轮。beta 始终处于 (0.02,16)，种子均有效。

### 通用终端展开，而非手写长公式

16 轮后取 A=(x+y+z+p)/4，定义 d_x=1-x/A，其他同理。参数差每轮除以 4，A>0.108，因此全部偏差绝对值小于 4*10^-9。

在辅助变量 v 上生成系数：

$$H(v)=\prod_{d\in\{d_x,d_y,d_z\}}(1-dv)^{-1/2}
=\sum h_jv^j,$$
$$J(v)=H(v)/(1-d_pv)=\sum \widetilde h_jv^j.$$

通过截断多项式卷积，只生成次数 0--7。积分变量代换后，

$$R_F=A^{-1/2}\sum_{j\ge0}\frac{h_j}{2j+1},$$
$$R_J=A^{-3/2}\sum_{j\ge0}\frac{3\widetilde h_j}{2j+3}.$$

第二式在 j=0 时系数权重为 1，程序使用 3/(2j+3)。

截断后的尾项由 (1-e v)^(-2.5) 的系数主控，e<4*10^-9；从次数 8 开始的误差小于 10^-62。生成器实际上把“辅助多项式的系数运算”编译为真实输入上的 DAG，这是本任务的主要构造内容。

### checker 的独立算法

checker 对原始 theta 积分做 192 点 Gauss--Legendre 求积。取 rho=1.5，复 theta 的虚部绝对值小于 0.328；|sin(theta)|<=cosh(0.328)，两个分母均远离零。被积函数在该椭圆解析且有统一上界，192 点求积误差小于 10^-64。

因此 checker 没有调用 Carlson 倍增算法，不会因相同递推错误而接受 std。

## 任务 9：Gamma 与 log Gamma

### 平移与归一化乘积

设 z=x+32，利用

$$\log\Gamma(x)=\log\Gamma(z)-\log(32!)-\log P,$$
$$P=\prod_{j=0}^{31}\frac{x+j}{j+1}.$$

输入域上 1<=P<=33，避免生成巨大阶乘乘积的运行时中间值。log(32!) 是生成阶段计算的常数，实际用 sum(log(j),j=1,...,32) 求出。不能直接对 32! 运行当前定点 log Newton：其中 exp(-y) 约为 10^-36，固定 72 位小数会损失约 36 位相对精度，达不到本题精度要求。

### Stirling 展开与 Bernoulli 系数

$$\log\Gamma(z)=(z-\tfrac12)\log z-z+\tfrac12\log(2\pi)
+\sum_{r=1}^{32}\frac{B_{2r}}{2r(2r-1)z^{2r-1}}+R.$$

对于正实 z，余项绝对值不超过首个省略项：

$$|R|\le\frac{|B_{66}|}{66\cdot65\cdot33^{65}}<1.1\cdot10^{-62}.$$

离线用递推

$$B_0=1,\qquad
B_m=-\frac1{m+1}\sum_{j=0}^{m-1}\binom{m+1}{j}B_j$$

生成系数。为了满足常数上限并保持定点精度，输出

$$c_r=\frac{B_{2r}}{2r(2r-1)32^{2r-1}},\qquad u=32/z.$$

修正和为 u*(c_1+c_2u^2+...+c_32u^62)，使用 Horner。归一化通过反复 divInt(32) 完成，不能先求 32^(2r-1) 的定点倒数，否则高次倒数会截断成零。

### 没有 log 节点怎么办

对所需的 v（P 或 z/32）先取六次平方根，令

$$u=v^{1/64},\qquad w=(u-1)/(u+1).$$

于是

$$\log v=128\sum_{j\ge0}\frac{w^{2j+1}}{2j+1}.$$

有 |w|<0.028。std 取 j=0,...,21，尾项小于 4*10^-70。分母 u+1 的倒数使用种子 1/2、8 轮。

log z=log 32+log(z/32)。最后共用 log Gamma(x)，再通过一个 E 节点得到 Gamma(x)。在 x=1,2 附近，log Gamma 接近零，故必须检查绝对误差，不能只看相对误差。

checker 使用平移 48、40 项 Stirling 展开和直接高精度 logarithm Newton；首省略项小于 7*10^-84。它与 std 属于同一渐近公式，因此另用 mpmath 的 gamma/loggamma 交叉核对，不能把两个结果一致当作独立数学证明。

## 验题和实现边界

python verify.py 完成编译、九张 std 图的全量测试和非法输出拒绝测试；python verify.py --independent 额外使用 mpmath（90 位）核对每个任务的三个代表输入，阈值为 10^-48。这是实现验证，不能替代上面的全区间误差分析。

checker 检查常数上限、十进制语法、引用上限、输入输出数量以及所有节点定义域；返回任务得分系数，分值乘法由比赛平台执行。

bigreal.hpp 的 inv/sqrtR 以 long double 为初值，分别做 5/6 轮高精度 Newton，足够恢复 72 位小数范围内所需精度；exp/sin/cos 仍使用高精度 Taylor 展开。初值不参与最终常数格式化。checker 范围明确限制三角参数、指数参数及中间值，以避免越过实现边界。

满分基准不是最优电路下界。它们以当前参考图可满分为底线，并保留其他构造空间；正式比赛前应在目标机器上重新测量时间并校准。
