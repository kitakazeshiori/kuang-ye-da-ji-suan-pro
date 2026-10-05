"""Build and check all reference DAGs; --independent also checks against mpmath."""
import argparse
from contextlib import nullcontext
from pathlib import Path
import subprocess
import tempfile
import time


def run(command, **kwargs):
    result = subprocess.run(command, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{command}: exit {result.returncode}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--independent", action="store_true")
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--build", type=Path, help="retain build outputs for inspection")
    parser.add_argument("--reuse", action="store_true", help="use existing binaries with --build")
    args = parser.parse_args()
    directory = args.directory.resolve()
    continuous = (directory / "numerics.hpp").exists()
    tasks = 9 if continuous else 4
    if args.reuse and not args.build: parser.error("--reuse requires --build")
    with (nullcontext(str(args.build.resolve())) if args.build else tempfile.TemporaryDirectory(prefix="circuit_verify_")) as temp:
        build = Path(temp)
        build.mkdir(parents=True,exist_ok=True)
        for source in ["std", "checker", "test_generator"] + (["oracle_probe"] if args.independent and continuous else []):
            if not args.reuse:
                run(["g++", "-std=c++17", "-O2", str(directory / f"{source}.cpp"), "-o", str(build / f"{source}.exe")])
        answer = build / "answer.txt"
        answer.write_text("OK\n", encoding="ascii")
        for task in range(1, tasks + 1):
            graph = run([str(build / "std.exe")], input=f"{task}\n")
            data = run([str(build / "test_generator.exe")], input=f"{task}\n")
            graph_path = build / f"task{task}.graph"
            data_path = build / f"task{task}.in"
            graph_path.write_text(graph, encoding="ascii")
            data_path.write_text(data, encoding="ascii")
            start = time.monotonic()
            result = subprocess.run([str(build / "checker.exe"), str(data_path), str(graph_path), str(answer)], capture_output=True, text=True)
            if result.returncode != 7 or not result.stderr.startswith("points 1.0 "):
                raise RuntimeError(f"task {task}: {result.stdout}\n{result.stderr}")
            print(f"{directory.name} task {task}: {result.stderr.strip()} ({time.monotonic()-start:.2f}s)", flush=True)
            if args.independent and continuous:
                independent(build, task, data)
        if continuous:
            reject_bad_outputs(build)


def independent(build, task, data):
    import mpmath as mp
    mp.mp.dps = 90
    rows = data.splitlines()[2:]
    selected = list(dict.fromkeys([rows[0], rows[len(rows)//2], rows[-1]]))
    results = run([str(build / "oracle_probe.exe")], input=f"{task}\n{len(selected)}\n" + "\n".join(selected) + "\n").splitlines()
    for row, actual in zip(selected, results):
        x = list(map(mp.mpf, row.split()[1:]))
        if task == 1: expected = [1/x[0]]
        elif task == 2: expected = [mp.root(x[0], 3)]
        elif task == 3: expected = [mp.atan(x[0])]
        elif task == 4: expected = [mp.ellipk(x[0]**2)]
        elif task == 5: expected = [mp.ellipe(x[0]**2)]
        elif task == 6: expected = [mp.ellipfun("sn", x[1], x[0]**2)]
        elif task == 7: expected = [mp.quad(lambda t: t**r * mp.exp(-t**4-x[0]*t**2-x[1]*t), [-1, 0, 1]) for r in range(8)]
        elif task == 8: expected = [mp.ellippi(x[1], x[0]**2)]
        else: expected = [mp.gamma(x[0]), mp.loggamma(x[0])]
        actual = list(map(mp.mpf, actual.split()))
        if len(actual) != len(expected): raise RuntimeError("probe arity mismatch")
        for a, e in zip(actual, expected):
            if abs(a-e) > mp.mpf("1e-48")*max(1, abs(e)):
                raise RuntimeError(f"independent task {task}, input {row}: error {mp.nstr(abs(a-e), 12)}")
    print(f"  mpmath: {len(selected)} independent cases passed", flush=True)


def reject_bad_outputs(build):
    (build / "invalid.in").write_text("1\n1\n1 1\n", encoding="ascii")
    for graph in ["2\nI\nC 1000001\nOUT 1 1\n", "2\nI\nC xyz\nOUT 1 1\n", "2\nI\nC 1e999\nOUT 1 1\n", "1\n+ 1 1\nOUT 1 1\n", "1\nI\nOUT 2 1 1\n", "1\nI\nOUT 1 1\nextra\n"]:
        (build / "invalid.graph").write_text(graph, encoding="ascii")
        result = subprocess.run([str(build / "checker.exe"), str(build / "invalid.in"), str(build / "invalid.graph"), str(build / "answer.txt")], capture_output=True, text=True)
        if result.returncode == 7: raise RuntimeError(f"checker accepted invalid graph: {graph}")
    print("  malformed graph rejection: 6 cases passed", flush=True)


if __name__ == "__main__":
    main()
