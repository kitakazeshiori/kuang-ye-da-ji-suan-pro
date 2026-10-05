#pragma once

// A small, self-contained fixed-point decimal type for the checker.
// It deliberately has no dependency on Boost, GMP, MPFR, or a platform ABI.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace agm_decimal {

static constexpr uint32_t BASE = 1000000000U;
static constexpr int BASE_DIGITS = 9;
static constexpr int SCALE_LIMBS = 8; // 72 decimal places

struct BigInt {
    bool neg = false;
    std::vector<uint32_t> d;

    BigInt() = default;
    explicit BigInt(int64_t x) { assign(x); }

    void assign(int64_t x) {
        neg = x < 0;
        uint64_t u = neg ? uint64_t(-(x + 1)) + 1 : uint64_t(x);
        d.clear();
        while (u) { d.push_back(uint32_t(u % BASE)); u /= BASE; }
        trim();
    }
    void trim() {
        while (!d.empty() && d.back() == 0) d.pop_back();
        if (d.empty()) neg = false;
    }
    bool zero() const { return d.empty(); }
    int digits10() const { return int(d.size()) * BASE_DIGITS; }

    static int cmpAbs(const BigInt &a, const BigInt &b) {
        if (a.d.size() != b.d.size()) return a.d.size() < b.d.size() ? -1 : 1;
        for (size_t i = a.d.size(); i-- > 0;) if (a.d[i] != b.d[i]) return a.d[i] < b.d[i] ? -1 : 1;
        return 0;
    }
    static BigInt addAbs(const BigInt &a, const BigInt &b) {
        BigInt r; uint64_t carry = 0; size_t n = std::max(a.d.size(), b.d.size());
        r.d.resize(n);
        for (size_t i = 0; i < n; ++i) {
            uint64_t x = carry + (i < a.d.size() ? a.d[i] : 0) + (i < b.d.size() ? b.d[i] : 0);
            r.d[i] = uint32_t(x % BASE); carry = x / BASE;
        }
        if (carry) r.d.push_back(uint32_t(carry));
        return r;
    }
    static BigInt subAbs(const BigInt &a, const BigInt &b) {
        BigInt r; int64_t borrow = 0; r.d.resize(a.d.size());
        for (size_t i = 0; i < a.d.size(); ++i) {
            int64_t x = int64_t(a.d[i]) - (i < b.d.size() ? b.d[i] : 0) - borrow;
            if (x < 0) { x += BASE; borrow = 1; } else borrow = 0;
            r.d[i] = uint32_t(x);
        }
        r.trim(); return r;
    }
    friend BigInt operator-(BigInt a) { if (!a.zero()) a.neg = !a.neg; return a; }
    friend BigInt operator+(const BigInt &a, const BigInt &b) {
        BigInt r;
        if (a.neg == b.neg) { r = addAbs(a, b); r.neg = a.neg; }
        else if (cmpAbs(a, b) >= 0) { r = subAbs(a, b); r.neg = a.neg; }
        else { r = subAbs(b, a); r.neg = b.neg; }
        r.trim(); return r;
    }
    friend BigInt operator-(const BigInt &a, const BigInt &b) { return a + (-b); }
    friend bool operator==(const BigInt &a, const BigInt &b) { return a.neg == b.neg && a.d == b.d; }
    friend bool operator<(const BigInt &a, const BigInt &b) {
        if (a.neg != b.neg) return a.neg;
        int c = cmpAbs(a, b); return a.neg ? c > 0 : c < 0;
    }
    friend BigInt operator*(const BigInt &a, const BigInt &b) {
        if (a.zero() || b.zero()) return BigInt();
        BigInt r; r.neg = a.neg != b.neg; r.d.assign(a.d.size() + b.d.size(), 0);
        for (size_t i = 0; i < a.d.size(); ++i) {
            uint64_t carry = 0;
            for (size_t j = 0; j < b.d.size() || carry; ++j) {
                uint64_t cur = r.d[i + j] + uint64_t(a.d[i]) * (j < b.d.size() ? b.d[j] : 0) + carry;
                r.d[i + j] = uint32_t(cur % BASE); carry = cur / BASE;
            }
        }
        r.trim(); return r;
    }
    BigInt mulSmall(uint64_t m) const {
        BigInt r; r.neg = neg; uint64_t carry = 0; r.d.resize(d.size());
        for (size_t i = 0; i < d.size(); ++i) {
            uint64_t x = uint64_t(d[i]) * m + carry;
            r.d[i] = uint32_t(x % BASE); carry = x / BASE;
        }
        while (carry) { r.d.push_back(uint32_t(carry % BASE)); carry /= BASE; }
        r.trim(); return r;
    }
    BigInt divSmall(uint64_t m) const {
        BigInt r; r.neg = neg; uint64_t rem = 0; r.d.resize(d.size());
        for (size_t i = d.size(); i-- > 0;) {
            uint64_t cur = rem * BASE + d[i];
            r.d[i] = uint32_t(cur / m); rem = cur % m;
        }
        r.trim(); return r;
    }
    BigInt shiftDown(int limbs) const {
        BigInt r = *this;
        if (limbs >= int(r.d.size())) { r.d.clear(); r.neg = false; }
        else r.d.erase(r.d.begin(), r.d.begin() + limbs);
        r.trim(); return r;
    }
    static BigInt fromDigits(const std::string &s) {
        BigInt r;
        for (char c : s) if (c >= '0' && c <= '9') r = r.mulSmall(10) + BigInt(c - '0');
        return r;
    }
};

struct Real {
    BigInt v; // v * 10^(-72)
    Real() = default;
    explicit Real(int64_t x) { v = BigInt(x).mulSmall(1); for (int i = 0; i < SCALE_LIMBS; ++i) v = v.mulSmall(BASE); }

    static Real decimal(std::string s) {
        Real r; bool neg = false;
        if (!s.empty() && (s[0] == '+' || s[0] == '-')) { neg = s[0] == '-'; s.erase(s.begin()); }
        int exponent = 0; size_t ep = s.find_first_of("eE");
        if (ep != std::string::npos) { exponent = std::stoi(s.substr(ep + 1)); s.resize(ep); }
        size_t dot = s.find('.'); int frac = dot == std::string::npos ? 0 : int(s.size() - dot - 1);
        std::string digits = s; if (dot != std::string::npos) digits.erase(dot, 1);
        while (digits.size() > 1 && digits[0] == '0') digits.erase(digits.begin());
        BigInt x = BigInt::fromDigits(digits.empty() ? "0" : digits);
        int power = SCALE_LIMBS * BASE_DIGITS - frac + exponent;
        if (power >= 0) for (int i = 0; i < power; ++i) x = x.mulSmall(10);
        else for (int i = 0; i < -power; ++i) x = x.divSmall(10);
        x.neg = neg && !x.zero(); r.v = x; return r;
    }
    static Real fromLongDouble(long double x) {
        std::ostringstream os; os << std::setprecision(30) << std::scientific << x;
        return decimal(os.str());
    }
    long double ld() const {
        long double x = 0;
        for (size_t i = v.d.size(); i-- > 0;) x = x * BASE + v.d[i];
        if (v.neg) x = -x;
        return x * std::pow(10.0L, -72.0L);
    }
    std::string str() const {
        if (v.zero()) return "0";
        std::ostringstream os;
        os << v.d.back();
        for (size_t i = v.d.size() - 1; i-- > 0;) os << std::setw(9) << std::setfill('0') << v.d[i];
        std::string s = os.str();
        if (s.size() <= 72) s.insert(0, 73 - s.size(), '0');
        s.insert(s.size() - 72, 1, '.');
        if (v.neg) s.insert(s.begin(), '-');
        return s;
    }
    bool isZero() const { return v.zero(); }
    bool negative() const { return v.neg && !v.zero(); }
    friend Real operator-(Real a) { a.v = -a.v; return a; }
    friend Real operator+(const Real &a, const Real &b) { Real r; r.v = a.v + b.v; return r; }
    friend Real operator-(const Real &a, const Real &b) { Real r; r.v = a.v - b.v; return r; }
    friend Real operator*(const Real &a, const Real &b) { Real r; r.v = (a.v * b.v).shiftDown(SCALE_LIMBS); return r; }
    friend bool operator<(const Real &a, const Real &b) { return a.v < b.v; }
    friend bool operator==(const Real &a, const Real &b) { return a.v == b.v; }
    Real divInt(uint64_t d) const { Real r; r.v = v.divSmall(d); return r; }
    Real abs() const { Real r = *this; r.v.neg = false; return r; }
    static Real one() { return decimal("1"); }
    static Real pi() { return decimal("3.141592653589793238462643383279502884197169399375105820974944592307816406"); }
};

inline Real inv(const Real &x) {
    if (x.isZero()) return Real::decimal("1e80");
    Real r = Real::fromLongDouble(1.0L / x.ld());
    Real two = Real::decimal("2");
    for (int i = 0; i < 5; ++i) r = r * (two - x * r);
    return r;
}
inline Real sqrtR(const Real &x) {
    if (x.isZero()) return Real();
    Real y = Real::fromLongDouble(std::sqrt(std::max((long double)0, x.ld())));
    if (y.isZero()) y = Real::one();
    Real half = Real::decimal("0.5");
    for (int i = 0; i < 6; ++i) y = (y + x * inv(y)) * half;
    return y;
}
inline Real expR(const Real &x) {
    Real y = x.divInt(16), term = Real::one(), sum = Real::one();
    for (int n = 1; n <= 150; ++n) { term = term * y; term = term.divInt(n); sum = sum + term; }
    for (int i = 0; i < 4; ++i) sum = sum * sum;
    return sum;
}
inline Real sinR(const Real &x) {
    Real y = x; long double z = y.ld();
    long long k = llround(z / (2.0L * acosl(-1.0L)));
    if (std::llabs(k) < 1000000) y = y - Real::pi().divInt(1) * Real::decimal(std::to_string(2 * k));
    Real x2 = y * y, term = y, sum = y;
    for (int n = 1; n <= 100; ++n) { term = term * x2; term = term.divInt(uint64_t(2*n) * uint64_t(2*n+1)); sum = (n & 1) ? sum - term : sum + term; }
    return sum;
}
inline Real cosR(const Real &x) {
    Real y = x; long double z = y.ld();
    long long k = llround(z / (2.0L * acosl(-1.0L)));
    if (std::llabs(k) < 1000000) y = y - Real::pi() * Real::decimal(std::to_string(2 * k));
    Real x2 = y * y, term = Real::one(), sum = term;
    for (int n = 1; n <= 100; ++n) { term = term * x2; term = term.divInt(uint64_t(2*n-1) * uint64_t(2*n)); sum = (n & 1) ? sum - term : sum + term; }
    return sum;
}

} // namespace agm_decimal
