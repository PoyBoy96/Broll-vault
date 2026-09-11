"""Inspect only tracked files. Optional private terms are supplied locally, never committed."""
import os
from pathlib import Path
import re
import subprocess
import sys

files = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
private_terms = [term.strip().casefold() for term in os.getenv('VAULT_PRIVATE_TERMS', '').split(';') if term.strip()]
patterns = [
    re.compile(r'(?i)[a-z]:[\\/](?:users|github|projects)[\\/][^\s"\']+'),
    re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}'),
    re.compile(r'github_pat_[A-Za-z0-9_]{30,}'),
    re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(r'AKIA[0-9A-Z]{16}'),
]
failures = []
for name in files:
    if not name:
        continue
    p = Path(name)
    if p.suffix.lower() in ('.sqlite', '.sqlite3', '.db', '.csv', '.tsv', '.log', '.pfx', '.pem', '.key') or p.name.startswith('.env'):
        failures.append(f'{name}: workstation data/credential file')
        continue
    data = p.read_bytes()
    if b'\0' in data:
        if p.suffix != '.woff2':
            failures.append(f'{name}: unexpected binary; inspect before publishing')
        continue
    text = data.decode('utf-8', errors='replace')
    if any(term in text.casefold() for term in private_terms) or any(pattern.search(text) for pattern in patterns):
        failures.append(f'{name}: possible private value (value omitted)')
if failures:
    print('\n'.join(failures))
    sys.exit(1)
print(f'Publication scan passed for {sum(bool(f) for f in files)} tracked files.')
