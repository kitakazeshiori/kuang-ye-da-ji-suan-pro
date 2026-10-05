#include "builder.hpp"
#include "numerics.hpp"
using namespace agm_decimal;

static int constant(Builder &b, const Real &x) { return b.C(x.str()); }
static int scale(Builder &b, int x, const Real &c) { return b.mul(x, constant(b, c)); }
static int task1(Builder &b) { return b.inv(b.I(), "0.375", 10); }
static int task2(Builder &b) {
    int x = b.I(), y = b.C("1.5");
    for (int i = 0; i < 10; ++i)
        y = scale(b,b.add2(b.scale(y,"2"),b.mul(x,b.inv(b.mul(y,y),"0.25",12))),Real::one().divInt(3));
    return y;
}
static int task3(Builder &b) {
    int x = b.I(), y = x;
    for (int i = 0; i < 10; ++i) {
        int sy = b.sin(y), cy = b.cos(y);
        y = b.sub(y,b.mul(b.sub(sy,b.mul(x,cy)),cy));
    }
    return y;
}
static void agm(Builder &b, int k, int &a, int &sum, bool needE) {
    int kk = b.mul(k,k), cur = b.root(b.sub(b.C("1"),kk));
    a = b.C("1"); sum = needE ? b.scale(kk,"0.5") : 0;
    for (int i = 0; i < 10; ++i) {
        int oldA = a;
        if (needE) {
            int c = b.scale(b.sub(a,cur),"0.5");
            sum = b.add2(sum,b.scale(b.mul(c,c),std::to_string(1LL<<i)));
        }
        a = b.scale(b.add2(a,cur),"0.5"); cur = b.root(b.mul(oldA,cur));
    }
}
static int ellipticK(Builder &b, int k) {
    int a, sum; agm(b,k,a,sum,false);
    return scale(b,b.inv(a,"0.45",16),Real::pi().divInt(2));
}
static int task4(Builder &b) { return ellipticK(b,b.I()); }
static int task5(Builder &b) {
    int k = b.I(), a, sum; agm(b,k,a,sum,true);
    int K = scale(b,b.inv(a,"0.45",16),Real::pi().divInt(2));
    return b.mul(K,b.sub(b.C("1"),sum));
}
static int task6(Builder &b) {
    int k = b.I(), u = b.I(), K = ellipticK(b,k);
    int kp = b.root(b.sub(b.C("1"),b.mul(k,k))), Kp = ellipticK(b,kp);
    int q = b.exp(b.neg(scale(b,b.mul(Kp,b.inv(K,"0.45",16)),Real::pi())));
    int v = b.mul(scale(b,u,Real::pi()),b.inv(b.scale(K,"2"),"0.2",16));
    int q14 = b.root(b.root(q)), qn2 = b.C("1"), qn = b.C("1"), qnsq = b.C("1");
    int t1 = b.C("0"), t2 = b.C("0"), t3 = b.C("1"), t4 = b.C("1");
    for (int n = 0; n <= 12; ++n) {
        int h = b.mul(q14,qn2);
        t1 = b.add2(t1,b.scale(b.mul(h,b.sin(b.scale(v,std::to_string(2*n+1)))),n%2 ? "-2" : "2"));
        t2 = b.add2(t2,b.scale(h,"2"));
        if (n) {
            t3 = b.add2(t3,b.scale(qnsq,"2"));
            t4 = b.add2(t4,b.scale(b.mul(qnsq,b.cos(b.scale(v,std::to_string(2*n)))),n%2 ? "-2" : "2"));
        }
        int qnSq = b.mul(qn,qn);
        qn2 = b.mul(qn2,b.mul(qnSq,b.mul(q,q))); qnsq = b.mul(qnsq,b.mul(qnSq,q)); qn = b.mul(qn,q);
    }
    return b.mul(b.mul(t3,t1),b.inv(b.mul(t2,t4),"1",16));
}
static std::vector<int> task7(Builder &b) {
    int a = b.I(), beta = b.I(); std::vector<int> out(8,b.C("0"));
    for (const auto &tw : gaussLegendre(96)) {
        Real t = tw.first, w = tw.second, t2 = t*t;
        int exponent = b.sub(b.sub(constant(b,-t2*t2),scale(b,a,t2)),scale(b,beta,t));
        int e = b.exp(exponent);
        out[0] = b.add2(out[0],scale(b,e,w)); out[1] = b.add2(out[1],scale(b,e,w*t)); out[2] = b.add2(out[2],scale(b,e,w*t2));
    }
    int common = b.sub(b.C("-1"),a), ep = b.exp(b.sub(common,beta)), em = b.exp(b.add2(common,beta));
    int twoA = b.scale(a,"2");
    for (int r = 0; r <= 4; ++r) {
        int boundary = r%2 ? b.add2(ep,em) : b.sub(ep,em);
        int v = b.neg(b.add2(b.add2(b.mul(twoA,out[r+1]),b.mul(beta,out[r])),boundary));
        if (r) v = b.add2(v,b.scale(out[r-1],std::to_string(r)));
        out[r+3] = b.scale(v,"0.25");
    }
    return out;
}
static std::vector<int> convolution(Builder &b, const std::vector<int> &a, const std::vector<int> &c) {
    std::vector<int> out(a.size(),b.C("0"));
    for (size_t n = 0; n < a.size(); ++n)
        for (size_t j = 0; j <= n; ++j) out[n] = b.add2(out[n],b.mul(a[j],c[n-j]));
    return out;
}
static std::vector<int> binomialSeries(Builder &b, int d, bool geometric) {
    std::vector<int> out(8,b.C("1")); Real c = Real::one(); int power = b.C("1");
    for (int j = 1; j <= 7; ++j) {
        power = b.mul(power,d); if (!geometric) c = (c*Real(2*j-1)).divInt(2*j);
        out[j] = scale(b,power,c);
    }
    return out;
}
static int rc(Builder &b, int alpha, int beta) {
    int d = b.sub(b.C("1"),b.mul(alpha,b.inv(beta,"0.0625",18)));
    std::vector<Real> coeff(96); Real c = Real::one();
    for (int j = 0; j < 96; ++j) {
        coeff[j] = c.divInt(2*j+1); c = (c*Real(2*j+1)).divInt(2*j+2);
    }
    int sum = constant(b,coeff.back());
    for (int j = 94; j >= 0; --j) sum = b.add2(constant(b,coeff[j]),b.mul(d,sum));
    return b.mul(sum,b.inv(b.root(beta),"0.25",16));
}
static int task8(Builder &b) {
    int k = b.I(), n = b.I();
    int x = b.C("0"), y = b.sub(b.C("1"),b.mul(k,k)), z = b.C("1"), p = b.sub(b.C("1"),n);
    int correction = b.C("0"); Real factor = Real::one();
    for (int it = 0; it < 16; ++it) {
        int sx = b.root(x), sy = b.root(y), sz = b.root(z);
        int lambda = b.add2(b.add2(b.mul(sx,sy),b.mul(sy,sz)),b.mul(sz,sx));
        int ar = b.add2(b.mul(p,b.add2(b.add2(sx,sy),sz)),b.mul(b.mul(sx,sy),sz));
        int pl = b.add2(p,lambda), beta = b.mul(p,b.mul(pl,pl));
        correction = b.add2(correction,scale(b,rc(b,b.mul(ar,ar),beta),Real(3)*factor));
        x = b.scale(b.add2(x,lambda),"0.25"); y = b.scale(b.add2(y,lambda),"0.25");
        z = b.scale(b.add2(z,lambda),"0.25"); p = b.scale(pl,"0.25"); factor = factor.divInt(4);
    }
    int A = b.scale(b.add2(b.add2(x,y),b.add2(z,p)),"0.25");
    int iA = b.inv(A,"0.5",16), isqrtA = b.inv(b.root(A),"0.5",16);
    auto delta = [&](int v) { return b.sub(b.C("1"),b.mul(v,iA)); };
    auto h = convolution(b,convolution(b,binomialSeries(b,delta(x),false),binomialSeries(b,delta(y),false)),binomialSeries(b,delta(z),false));
    int rfSum = b.C("0");
    for (int j = 0; j <= 7; ++j) rfSum = b.add2(rfSum,scale(b,h[j],Real::one().divInt(2*j+1)));
    auto hj = convolution(b,h,binomialSeries(b,delta(p),true)); int rjSum = b.C("0");
    for (int j = 0; j <= 7; ++j) rjSum = b.add2(rjSum,scale(b,hj[j],Real(3).divInt(2*j+3)));
    int rf = b.mul(isqrtA,rfSum), rj = b.add2(correction,scale(b,b.mul(b.mul(iA,isqrtA),rjSum),factor));
    return b.add2(rf,scale(b,b.mul(n,rj),Real::one().divInt(3)));
}
static int logarithm(Builder &b, int v) {
    int u = v; for (int i = 0; i < 6; ++i) u = b.root(u);
    int w = b.mul(b.sub(u,b.C("1")),b.inv(b.add2(u,b.C("1")),"0.5",8));
    int w2 = b.mul(w,w), sum = constant(b,Real::one().divInt(43));
    for (int j = 20; j >= 0; --j) sum = b.add2(constant(b,Real::one().divInt(2*j+1)),b.mul(w2,sum));
    return b.scale(b.mul(w,sum),"128");
}
static std::vector<int> task9(Builder &b) {
    int x = b.I(), z = b.add2(x,b.C("32")), u = b.scale(b.inv(z,"0.015625",12),"32"), u2 = b.mul(u,u);
    auto coeff = stirlingCoefficients(32); int correction = constant(b,coeff.back());
    for (int j = 30; j >= 0; --j) correction = b.add2(constant(b,coeff[j]),b.mul(u2,correction));
    correction = b.mul(u,correction);
    int logz = b.add2(constant(b,logR(Real(32))),logarithm(b,b.scale(z,"0.03125")));
    int value = b.add2(b.sub(b.mul(b.sub(z,b.C("0.5")),logz),z),correction);
    value = b.add2(value,constant(b,logR(Real(2)*Real::pi()).divInt(2)));
    Real factorialLog; int product = b.C("1");
    for (int j = 0; j < 32; ++j) {
        factorialLog = factorialLog+logR(Real(j+1));
        product = b.mul(product,scale(b,b.add2(x,b.C(std::to_string(j))),Real::one().divInt(j+1)));
    }
    value = b.sub(b.sub(value,constant(b,factorialLog)),logarithm(b,product));
    return {b.exp(value),value};
}
int main() {
    int task; if (!(std::cin >> task) || task < 1 || task > 9) return 1;
    Builder b; std::vector<int> out;
    switch (task) {
    case 1: out = {task1(b)}; break;
    case 2: out = {task2(b)}; break;
    case 3: out = {task3(b)}; break;
    case 4: out = {task4(b)}; break;
    case 5: out = {task5(b)}; break;
    case 6: out = {task6(b)}; break;
    case 7: out = task7(b); break;
    case 8: out = {task8(b)}; break;
    case 9: out = task9(b); break;
    }
    b.output(out);
}
