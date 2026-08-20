#!/usr/bin/env python3
"""Every `run:` block in every workflow, checked with `bash -n`.
A YAML file parses happily with an unterminated quote inside a run: block —
that is a shell error, and it only shows up when the step executes."""
import glob, subprocess, sys, tempfile, os, re, yaml

bad = 0
for f in sorted(glob.glob('.github/workflows/*.yml') + glob.glob('.github/actions/*/action.yml')):
    doc = yaml.safe_load(open(f))
    jobs = doc.get('jobs') or {'_composite': {'steps': (doc.get('runs') or {}).get('steps', [])}}
    for jname, job in jobs.items():
        for i, st in enumerate(job.get('steps') or []):
            script = st.get('run')
            if not script:
                continue
            # GitHub expressions are substituted before bash sees them; replace
            # them with a harmless token so bash -n checks the shell, not them.
            probe = re.sub(r'\$\{\{[^}]*\}\}', 'X', script)
            with tempfile.NamedTemporaryFile('w', suffix='.sh', delete=False) as t:
                t.write(probe)
                path = t.name
            r = subprocess.run(['bash', '-n', path], capture_output=True, text=True)
            os.unlink(path)
            if r.returncode:
                bad += 1
                print(f'FAIL {f} :: {jname} :: step {i} "{st.get("name")}"')
                print('   ', r.stderr.strip().replace(path, '<step>'))
print('shell syntax:', 'ALL OK' if not bad else f'{bad} BROKEN')
sys.exit(1 if bad else 0)
