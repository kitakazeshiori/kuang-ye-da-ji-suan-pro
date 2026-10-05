// Validation utility, not a contestant-facing program.
#define main checker_main
#include "checker.cpp"
#undef main
#include <iostream>
int main() {
    disableFinalizeGuard();
    int task, count; if (!(std::cin >> task >> count)) return 1;
    for (int i = 0; i < count; ++i) {
        int nin; std::cin >> nin; std::vector<Real> row;
        for (int j = 0; j < nin; ++j) { std::string s; std::cin >> s; row.push_back(Real::decimal(s)); }
        for (const Real &y : oracle(task,row)) std::cout << y.str() << ' ';
        std::cout << '\n';
    }
}
