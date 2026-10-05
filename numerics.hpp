#pragma once
#include "bigreal.hpp"
#include <utility>

namespace agm_decimal {

inline std::pair<Real, Real> legendre(int n, const Real &x) {
    Real p0 = Real::one(), p1 = x;
    for (int k = 2; k <= n; ++k) {
        Real p2 = (Real(2*k-1) * x * p1 - Real(k-1) * p0).divInt(k);
        p0 = p1; p1 = p2;
    }
    Real derivative = Real(n) * (x * p1 - p0) * inv(x * x - Real::one());
    return {p1, derivative};
}

inline std::vector<std::pair<Real, Real>> gaussLegendre(int n) {
    std::vector<std::pair<Real, Real>> result;
    for (int i = 0; i < n/2; ++i) {
        Real x = Real::fromLongDouble(std::cos(acosl(-1.0L) * (i + 0.75L) / (n + 0.5L)));
        for (int j = 0; j < 8; ++j) {
            auto pd = legendre(n, x);
            x = x - pd.first * inv(pd.second);
        }
        Real dp = legendre(n, x).second;
        Real w = Real(2) * inv((Real::one() - x*x) * dp*dp);
        result.push_back({x, w}); result.push_back({-x, w});
    }
    return result;
}

inline Real logR(const Real &x) {
    Real y = Real::fromLongDouble(std::log(x.ld()));
    for (int i = 0; i < 5; ++i) y = y - Real::one() + x * expR(-y);
    return y;
}

// B_m = -sum_{j<m} binom(m+1,j) B_j / (m+1).
inline std::vector<Real> stirlingCoefficients(int count) {
    std::vector<Real> bernoulli(2*count+1);
    bernoulli[0] = Real::one();
    for (int m = 1; m <= 2*count; ++m) {
        Real sum, choose = Real::one();
        for (int j = 0; j < m; ++j) {
            sum = sum + choose * bernoulli[j];
            choose = (choose * Real(m+1-j)).divInt(j+1);
        }
        bernoulli[m] = -sum.divInt(m+1);
    }
    std::vector<Real> result;
    for (int r = 1; r <= count; ++r) {
        Real c = bernoulli[2*r].divInt(uint64_t(2*r)*(2*r-1));
        for (int j = 0; j < 2*r-1; ++j) c = c.divInt(32);
        result.push_back(c);
    }
    return result;
}

inline std::vector<Real> momentsOracle(const Real &a, const Real &b) {
    const int terms = 400;
    std::vector<Real> c(terms+1), out(8);
    c[0] = Real::one();
    for (int n = 1; n <= terms; ++n) {
        Real v = -b * c[n-1];
        if (n >= 2) v = v - Real(2)*a*c[n-2];
        if (n >= 4) v = v - Real(4)*c[n-4];
        c[n] = v.divInt(n);
    }
    for (int r = 0; r < 8; ++r)
        for (int n = 0; n <= terms; ++n)
            if ((n+r)%2 == 0) out[r] = out[r] + Real(2)*c[n].divInt(n+r+1);
    return out;
}

inline Real thirdKindOracle(const Real &k, const Real &n) {
    static const auto rule = gaussLegendre(192);
    static const auto sineSquared = [] {
        std::vector<Real> result;
        for (const auto &tw : rule) {
            Real s = sinR(Real::pi().divInt(4) * (tw.first + Real::one()));
            result.push_back(s*s);
        }
        return result;
    }();
    Real sum;
    for (size_t j = 0; j < rule.size(); ++j) {
        Real s = sineSquared[j];
        sum = sum + rule[j].second * inv((Real::one()-n*s)*sqrtR(Real::one()-k*k*s));
    }
    return Real::pi().divInt(4)*sum;
}

inline std::vector<Real> gammaOracle(const Real &x) {
    // Use a different shift/order and direct logarithms in the oracle.
    static const auto coeff = stirlingCoefficients(40);
    Real z = x + Real(48), u = Real(32)*inv(z), u2 = u*u, power = u;
    Real productLog;
    for (int j = 0; j < 48; ++j) productLog = productLog + logR(x+Real(j));
    Real value = (z-Real::decimal("0.5"))*logR(z)-z+logR(Real(2)*Real::pi()).divInt(2);
    // The stored coefficients are scaled by powers of 32.
    for (int r = 1; r <= 40; ++r) {
        value = value + coeff[r-1]*power;
        power = power*u2;
    }
    value = value - productLog;
    return {expR(value), value};
}

} // namespace agm_decimal
