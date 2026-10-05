#include "testlib.h"
#include "bigreal.hpp"
#include "numerics.hpp"

#include <cstdint>
#include <string>
#include <vector>

using namespace agm_decimal;

static const Real PI = Real::pi();
static int inputCount(int task) {
    return task == 6 || task == 7 || task == 8 ? 2 : 1;
}
static int outputCount(int task) { return task == 7 ? 8 : task == 9 ? 2 : 1; }
static constexpr int TASKS = 9;
static const long long BASES[] = {0,160,1500,1200,6200,9800,30000,6000,30000,4000};

static Real agmK(const Real &k) {
    Real a = Real::one(), b = sqrtR(Real::one() - k * k);
    for (int i = 0; i < 14; ++i) { Real na = (a + b).divInt(2); Real nb = sqrtR(a * b); a = na; b = nb; }
    return PI * inv(a).divInt(2);
}
static Real agmE(const Real &k) {
    Real a = Real::one(), b = sqrtR(Real::one() - k * k), sum = (k * k).divInt(2);
    for (int n = 1; n <= 14; ++n) {
        Real c = (a - b).divInt(2);
        Real p = Real::one(); for (int j = 1; j < n; ++j) p = p * Real(2);
        sum = sum + p * c * c;
        Real na = (a + b).divInt(2); Real nb = sqrtR(a * b); a = na; b = nb;
    }
    return agmK(k) * (Real::one() - sum);
}
static Real jacobiSn(const Real &k, const Real &u) {
    Real K = agmK(k), kp = sqrtR(Real::one() - k * k), Kp = agmK(kp);
    Real q = expR(-(PI * Kp * inv(K))), v = PI * u * inv(K * Real(2));
    Real q14 = sqrtR(sqrtR(q)), qn2 = Real::one(), qn = Real::one(), qnsq = Real::one();
    Real t1, t2, t3 = Real::one(), t4 = Real::one();
    for (int n = 0; n <= 18; ++n) {
        Real h = q14 * qn2, sign = (n & 1) ? Real(-1) : Real::one();
        t1 = t1 + Real(2) * sign * h * sinR(Real(2*n+1) * v);
        t2 = t2 + Real(2) * h;
        if (n >= 1) {
            t3 = t3 + Real(2) * qnsq;
            t4 = t4 + Real(2) * sign * qnsq * cosR(Real(2*n) * v);
        }
        qn2 = qn2 * qn * qn * q * q;
        qnsq = qnsq * qn * qn * q;
        qn = qn * q;
    }
    return t3 * t1 * inv(t2 * t4);
}
static Real cbrtR(const Real &x) {
    Real y = Real::decimal("1.5"), two = Real(2), third = Real::decimal("0.3333333333333333333333333333333333333333333333333333333333333333");
    for (int i = 0; i < 14; ++i) y = (two * y + x * inv(y * y)) * third;
    return y;
}
static Real atanR(const Real &x) {
    Real y = x;
    for (int i = 0; i < 14; ++i) { Real sy = sinR(y), cy = cosR(y); y = y - (sy - x * cy) * cy; }
    return y;
}
static std::vector<Real> oracle(int task, const std::vector<Real> &x) {
    switch (task) {
    case 1: return {inv(x[0])};
    case 2: return {cbrtR(x[0])};
    case 3: return {atanR(x[0])};
    case 4: return {agmK(x[0])};
    case 5: return {agmE(x[0])};
    case 6: return {jacobiSn(x[0], x[1])};
    case 7: return momentsOracle(x[0],x[1]);
    case 8: return {thirdKindOracle(x[0],x[1])};
    case 9: return gammaOracle(x[0]);
    default: return {};
    }
}
#include "checker_core.hpp"
