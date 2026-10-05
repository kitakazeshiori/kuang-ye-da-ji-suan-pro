#pragma once
#include <regex>

struct Node { char op = 0; int a = 0, b = 0; Real c; };
static int weight(char op) { return op == '*' ? 4 : (op == 'S' || op == 'T' ? 9 : (op == 'E' ? 12 : (op == 'Q' ? 7 : 1))); }
static Real readReal(InStream &stream, bool contestant) {
    std::string s = stream.readToken();
    static const std::regex syntax("[-+]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][-+]?[0-9]{1,3})?");
    if (s.size() > 256 || !std::regex_match(s,syntax))
        quitf(contestant ? _pe : _fail,"invalid decimal token");
    auto ep = s.find_first_of("eE");
    if (ep != std::string::npos && std::abs(std::stoi(s.substr(ep+1))) > 300)
        quitf(contestant ? _pe : _fail,"decimal exponent out of range");
    return Real::decimal(s);
}
int main(int argc, char **argv) {
    registerTestlibCmd(argc,argv);
    int task = inf.readInt(1,TASKS), cases = inf.readInt(1,1000), nin = inputCount(task);
    std::vector<std::vector<Real>> tests;
    for (int tc = 0; tc < cases; ++tc) {
        if (inf.readInt() != nin) quitf(_fail,"wrong input arity in jury file");
        std::vector<Real> row;
        for (int j = 0; j < nin; ++j) row.push_back(readReal(inf,false));
        tests.push_back(row);
    }
    if (!inf.seekEof()) quitf(_fail,"extra jury input");
    int n = ouf.readInt(1,180000), inputs = 0, references = 0; long long W = 0;
    std::vector<Node> nodes(n+1);
    for (int i = 1; i <= n; ++i) {
        std::string op = ouf.readToken();
        if (op == "I") { nodes[i].op = 'I'; ++inputs; }
        else if (op == "C") {
            nodes[i].op = 'C'; nodes[i].c = readReal(ouf,true);
            if (Real(1000000) < nodes[i].c.abs()) quitf(_wa,"constant exceeds 1e6");
        } else if (op == "+" || op == "*") {
            if (i == 1) quitf(_wa,"node 1 cannot reference another node");
            nodes[i].op = op[0]; nodes[i].a = ouf.readInt(1,i-1); nodes[i].b = ouf.readInt(1,i-1); references += 2;
        } else if (op == "-" || op == "S" || op == "T" || op == "E" || op == "Q") {
            if (i == 1) quitf(_wa,"node 1 cannot reference another node");
            nodes[i].op = op[0]; nodes[i].a = ouf.readInt(1,i-1); ++references;
        } else quitf(_pe,"unknown instruction at node %d",i);
        W += weight(nodes[i].op);
    }
    if (references > 300000) quitf(_wa,"too many references");
    if (inputs != nin) quitf(_wa,"expected %d input nodes, found %d",nin,inputs);
    if (ouf.readToken() != "OUT") quitf(_pe,"missing OUT section");
    if (ouf.readInt(1,8) != outputCount(task)) quitf(_wa,"wrong output arity");
    std::vector<int> outputs(outputCount(task));
    for (int &id : outputs) id = ouf.readInt(1,n);
    if (!ouf.seekEof()) quitf(_pe,"extra data after OUT section");
    const Real tol = Real::decimal("1e-45"), maxValue = Real::decimal("1e60");
    for (int tc = 0; tc < cases; ++tc) {
        std::vector<Real> value(n+1); int p = 0;
        for (int i = 1; i <= n; ++i) {
            const Node &v = nodes[i];
            if (v.op == 'I') value[i] = tests[tc][p++];
            else if (v.op == 'C') value[i] = v.c;
            else if (v.op == '+') value[i] = value[v.a]+value[v.b];
            else if (v.op == '-') value[i] = -value[v.a];
            else if (v.op == '*') value[i] = value[v.a]*value[v.b];
            else if (v.op == 'S' || v.op == 'T') {
                if (!(value[v.a].abs() < Real(1000000))) quitf(_wa,"trigonometric argument out of range");
                value[i] = v.op == 'S' ? sinR(value[v.a]) : cosR(value[v.a]);
            } else if (v.op == 'E') {
                if (!(value[v.a].abs() < Real(100))) quitf(_wa,"exponential argument out of range");
                value[i] = expR(value[v.a]);
            } else if (v.op == 'Q') {
                if (value[v.a].negative()) quitf(_wa,"negative square-root argument");
                value[i] = sqrtR(value[v.a]);
            }
            if (maxValue < value[i].abs()) quitf(_wa,"oversized value at test %d node %d",tc+1,i);
        }
        auto want = oracle(task,tests[tc]);
        if (want.size() != outputs.size()) quitf(_fail,"oracle output arity mismatch");
        for (size_t j = 0; j < outputs.size(); ++j) {
            Real error = (value[outputs[j]]-want[j]).abs(), scale = want[j].abs();
            if (scale < Real::one()) scale = Real::one();
            if (tol*scale < error) quitf(_wa,"test %d output %d error %.5Le",tc+1,int(j+1),error.ld());
        }
    }
    long long base = BASES[task];
    long double factor = W <= base ? 1.0L : (W < 2*base ? (long double)(2*base-W)/base : 0.0L);
    quitp(double(factor),"accepted: weighted nodes=%lld",W);
}
