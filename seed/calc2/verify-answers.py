"""Check the actual worksheet and answer LaTeX, rather than a second answer list.

Requires sympy==1.14.0 and antlr4-python3-runtime==4.11.1.
Run from any directory: python seed/calc2/verify-answers.py [--output evidence.json]
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

import sympy as sp
from sympy.parsing.latex import parse_latex

ROOT = Path(__file__).resolve().parent
x = sp.Symbol("x", real=True)
t = sp.Symbol("t", positive=True)

# Each substitution parametrizes an entire connected open domain interval.
# These are domain declarations only; expressions come directly from Markdown.
DOMAINS = {
    (1, 1): [("R", x)],
    (1, 2): [("x>0", t)],
    (1, 3): [("R", x)],
    (2, 1): [("R", x)],
    (2, 2): [("R", x)],
    (2, 3): [("R", x)],
    (3, 1): [("-4<x<0", -4 * t / (1 + t)), ("0<x<4", 4 * t / (1 + t))],
    (3, 2): [("-5<x<5", -5 + 10 * t / (1 + t))],
    (3, 3): [("R", x)],
    (3, 4): [("x>3", 3 + t)],
    (3, 5): [("R", x)],
    (4, 1): [("x<-2", -2 - t), ("-2<x<1", -2 + 3*t/(1+t)), ("x>1", 1+t)],
    (4, 2): [("x<-1", -1-t), ("-1<x<0", -1+t/(1+t)), ("x>0", t)],
    (4, 3): [("x<-1", -1-t), ("-1<x<0", -1+t/(1+t)), ("x>0", t)],
}


def parse(latex):
    # Sizing commands are presentation only; ANTLR's strict grammar rejects
    # \left|...\right| around a fraction, but parses the equivalent |...|.
    latex = latex.replace(r"\left", "").replace(r"\right", "")
    expr = parse_latex(latex, strict=True)
    return expr.xreplace({s: {"x": x, "e": sp.E}.get(s.name, s) for s in expr.free_symbols})


def displays_by_problem(text, heading):
    result = {}
    for match in re.finditer(rf"^{heading} Problem (\d+)\n(.*?)(?=^#{heading[1:]} |\Z)", text, re.M | re.S):
        formula = re.search(r"\$\$(.*?)\$\$", match[2], re.S)
        if not formula:
            raise ValueError(f"Missing formula for problem {match[1]}")
        result[int(match[1])] = formula[1].strip()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    answer_text = (ROOT / "answers.md").read_text()
    answers = {}
    for match in re.finditer(r"^## Worksheet (\d+)\n(.*?)(?=^## Worksheet |\Z)", answer_text, re.M | re.S):
        for problem, latex in displays_by_problem(match[2], "###").items():
            answers[(int(match[1]), problem)] = latex
    if set(answers) != set(DOMAINS):
        raise ValueError("Answer labels do not match the declared worksheet domains")
    records = []
    hashes = {"answers.md": hashlib.sha256((ROOT / "answers.md").read_bytes()).hexdigest()}
    for unit in range(1, 5):
        path = ROOT / f"unit-{unit}/worksheet-{unit}.md"
        hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
        problems = displays_by_problem(path.read_text(), "##")
        expected = {p for u, p in answers if u == unit}
        if set(problems) != expected:
            raise ValueError(f"Worksheet {unit} problems and answers differ")
        for number, latex in problems.items():
            # The interval after a comma is prose in math mode, not the integral.
            integral = parse(latex.split(r",\qquad")[0])
            if not isinstance(integral, sp.Integral) or integral.limits != ((x,),):
                raise ValueError(f"Not an indefinite integral in x: {latex}")
            answer_latex = answers[(unit, number)]
            if not answer_latex.endswith("+C"):
                raise ValueError("Every answer must carry +C")
            answer = parse(answer_latex[:-2])
            if answer.free_symbols - {x}:
                raise ValueError(f"Unexpected symbols in {answer_latex}")
            derivative = sp.diff(answer, x)
            checks = []
            for label, substitution in DOMAINS[(unit, number)]:
                residual = sp.trigsimp(sp.simplify((derivative - integral.function).subs(x, substitution).doit()))
                if residual != 0:
                    raise AssertionError(f"Worksheet {unit} problem {number}, {label}: residual {residual}")
                checks.append({"domain": label, "derivative_minus_integrand": "0"})
            records.append({"worksheet": unit, "problem": number, "integralLatex": latex,
                            "answerLatex": answer_latex, "checks": checks})
            print(f"PASS Worksheet {unit} problem {number}: " + ", ".join(c["domain"] for c in checks))
    evidence = {"method": "Strict LaTeX parsing of Markdown; exact symbolic differentiation on every domain interval",
                "sympy": sp.__version__, "antlr4_python3_runtime": "4.11.1",
                "sourceSha256": hashes, "results": records}
    if args.output:
        args.output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(f"Verified {len(records)} answers; all symbolic residuals are exactly zero.")


if __name__ == "__main__":
    main()
