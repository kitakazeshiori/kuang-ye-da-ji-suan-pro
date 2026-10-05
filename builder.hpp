#pragma once
#include <iostream>
#include <map>
#include <string>
#include <vector>

struct Builder {
    std::vector<std::string> g;
    std::map<std::string, int> constants;
    int add(const std::string &s) { g.push_back(s); return int(g.size()); }
    int I() { return add("I"); }
    int C(const std::string &s) {
        auto it = constants.find(s);
        if (it != constants.end()) return it->second;
        return constants[s] = add("C " + s);
    }
    int add2(int a, int b) { return add("+ " + std::to_string(a) + " " + std::to_string(b)); }
    int neg(int a) { return add("- " + std::to_string(a)); }
    int mul(int a, int b) { return add("* " + std::to_string(a) + " " + std::to_string(b)); }
    int sin(int a) { return add("S " + std::to_string(a)); }
    int cos(int a) { return add("T " + std::to_string(a)); }
    int exp(int a) { return add("E " + std::to_string(a)); }
    int root(int a) { return add("Q " + std::to_string(a)); }
    int sub(int a, int b) { return add2(a, neg(b)); }
    int scale(int a, const std::string &s) { return mul(a, C(s)); }
    int inv(int z, const std::string &seed, int rounds) {
        int r = C(seed), two = C("2");
        for (int i = 0; i < rounds; ++i) r = mul(r, sub(two, mul(z, r)));
        return r;
    }
    void output(const std::vector<int> &ids) const {
        std::cout << g.size() << '\n';
        for (const auto &s : g) std::cout << s << '\n';
        std::cout << "OUT " << ids.size();
        for (int id : ids) std::cout << ' ' << id;
        std::cout << '\n';
    }
};
