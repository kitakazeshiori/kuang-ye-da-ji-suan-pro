#include <cstdint>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

int main() {
    int task;
    if (!(std::cin >> task) || task < 1 || task > 9) return 1;
    std::vector<std::vector<std::string>> cases;
    auto one = [&](std::initializer_list<const char*> a) {
        std::vector<std::string> v; for (const char *s : a) v.emplace_back(s); cases.push_back(v);
    };
    if (task == 1) {
        one({"1"}); one({"1.5"}); one({"2"}); one({"1.234567890123"});
    } else if (task == 2) {
        one({"1"}); one({"2"}); one({"8"}); one({"3.375"});
    } else if (task == 3) {
        one({"-1"}); one({"-0.5"}); one({"0"}); one({"0.5"}); one({"1"});
    } else if (task == 4 || task == 5) {
        one({"0.2"}); one({"0.3"}); one({"0.5"}); one({"0.9"});
    } else if (task == 6) {
        one({"0.2", "-1"}); one({"0.2", "0"}); one({"0.5", "1"});
        one({"0.9", "-1"}); one({"0.9", "1"});
    } else if (task == 7) {
        for (int a : {-2,-1,0,1,2}) for (int b : {-1,0,1})
            cases.push_back({std::to_string(a),std::to_string(b)});
        one({"-1.99999999999999999999999999999999999999999999999999","0.99999999999999999999999999999999999999999999999999"});
        one({"0.3","1e-50"});
    } else if (task == 8) {
        for (const char *k : {"0.2","0.5","0.9"}) for (const char *n : {"-0.5","0","0.5"}) one({k,n});
        one({"0.89999999999999999999999999999999999999999999999999","0.49999999999999999999999999999999999999999999999999"});
        one({"0.7","1e-50"});
    } else if (task == 9) {
        one({"1"}); one({"1.5"}); one({"2"}); one({"1.4616321449683623412626595423257213284681962040064"});
        one({"1.00000000000000000000000000000000000000000000000001"});
        one({"1.99999999999999999999999999999999999999999999999999"});
    }
    uint32_t state = 123456789u + task;
    auto random = [&] { state = state*1664525u+1013904223u; return double(state)/4294967296.0; };
    auto decimal = [](double x) { std::ostringstream os; os << std::fixed << std::setprecision(16) << x; return os.str(); };
    for (int i = 0; i < 12; ++i) {
        if (task == 1) cases.push_back({decimal(1+random())});
        else if (task == 2) cases.push_back({decimal(1+7*random())});
        else if (task == 3) cases.push_back({decimal(2*random()-1)});
        else if (task == 4 || task == 5) cases.push_back({decimal(0.2+0.7*random())});
        else if (task == 6) cases.push_back({decimal(0.2+0.7*random()),decimal(2*random()-1)});
        else if (task == 7) cases.push_back({decimal(4*random()-2),decimal(2*random()-1)});
        else if (task == 8) cases.push_back({decimal(0.2+0.7*random()),decimal(random()-0.5)});
        else cases.push_back({decimal(1+random())});
    }
    std::cout << task << '\n' << cases.size() << '\n';
    for (const auto &v : cases) {
        std::cout << v.size();
        for (const auto &s : v) std::cout << ' ' << s;
        std::cout << '\n';
    }
    return 0;
}
