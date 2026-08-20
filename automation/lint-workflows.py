#!/usr/bin/env python3
"""Run `bash -n` over every shell `run:` block in every workflow and action.

WHY THIS EXISTS
A YAML file parses perfectly happily with an unterminated quote inside a `run:`
block. The shell only finds out when the step executes — and in this repo a step
that dies takes every step after it with it, because a plain `if:` implies
`success()`. One stray quote in the middle of the chain meant the weekly Ledger
review email silently never arrived, every week, with a green YAML check.

Run it from anywhere: `python3 automation/lint-workflows.py`.
Enforced by .github/workflows/workflow-lint.yml on any change under .github/.
"""
import glob
import os
import re
import subprocess
import sys
import tempfile

import yaml

# Repo root, not the caller's cwd. The globs used to be cwd-relative, so running
# this from anywhere else printed a confident "ALL OK" after checking nothing.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATTERNS = [
    '.github/workflows/*.yml', '.github/workflows/*.yaml',
    '.github/actions/**/action.yml', '.github/actions/**/action.yaml',
]

# Steps in another language are not ours to parse. Checking a pwsh or python
# step with `bash -n` reports a syntax error in correct code, and the documented
# response to a red linter is to "go fix the workflow".
SHELLS_WE_CHECK = {'bash', 'sh', ''}

# `bash -n` returns 0 for an unterminated heredoc and only warns on stderr —
# which is exactly the class of bug this file exists to catch.
FATAL_WARNINGS = ('here-document',)


def steps_of(doc):
    """(job label, step) for every step in a workflow or a composite action."""
    for name, job in (doc.get('jobs') or {}).items():
        default = (((job.get('defaults') or {}).get('run')) or {}).get('shell', '')
        top = (((doc.get('defaults') or {}).get('run')) or {}).get('shell', '')
        for i, step in enumerate(job.get('steps') or []):
            yield f'{name}[{i}]', step, step.get('shell', default or top)
    runs = doc.get('runs') or {}
    if runs.get('using') == 'composite':
        for i, step in enumerate(runs.get('steps') or []):
            yield f'composite[{i}]', step, step.get('shell', '')


def main():
    files, bad, checked = [], 0, 0
    for pattern in PATTERNS:
        files += glob.glob(os.path.join(ROOT, pattern), recursive=True)

    if not files:
        print(f'no workflow or action files found under {ROOT}', file=sys.stderr)
        return 1

    for path in sorted(set(files)):
        rel = os.path.relpath(path, ROOT)
        try:
            doc = yaml.safe_load(open(path, encoding='utf-8'))
        except yaml.YAMLError as exc:
            bad += 1
            print(f'FAIL {rel}: not valid YAML\n    {exc}')
            continue
        if not isinstance(doc, dict):
            continue
        for where, step, shell in steps_of(doc):
            script = step.get('run')
            if not script:
                continue
            # Parenthesised deliberately: written as a bare conditional
            # expression this binds as `X if shell else ('' not in SET)`, which
            # skips every step that explicitly says `shell: bash` — the ones
            # most worth checking.
            name = (shell.split()[0] if shell else '')
            if name not in SHELLS_WE_CHECK:
                continue
            # GitHub substitutes ${{ }} before bash sees the script. Replace each
            # with a bare word so bash checks the shell, not the expression.
            probe = re.sub(r'\$\{\{.*?\}\}', 'X', script, flags=re.S)
            with tempfile.NamedTemporaryFile('w', suffix='.sh', delete=False) as tmp:
                tmp.write(probe)
                tmp_path = tmp.name
            try:
                res = subprocess.run(['bash', '-n', tmp_path], capture_output=True, text=True)
            finally:
                os.unlink(tmp_path)
            checked += 1
            err = res.stderr.strip().replace(tmp_path, '<step>')
            fatal = res.returncode != 0 or any(w in res.stderr for w in FATAL_WARNINGS)
            if fatal:
                bad += 1
                print(f'FAIL {rel} :: {where} :: {step.get("name") or "(unnamed)"}')
                print(f'    {err}')

    print(f'{checked} shell step(s) in {len(set(files))} file(s): '
          f'{"ALL OK" if not bad else f"{bad} BROKEN"}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
