#!/usr/bin/env python3
"""Synchronize release metadata, extension version, and README release notes."""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def prepare():
    r=json.loads((ROOT/'release.json').read_text())
    if not re.fullmatch(r'\d+\.\d+\.\d+',r['version']) or type(r['build']) is not int or r['build'] < 1:
        raise ValueError('Expected a semantic version and positive integer build')
    if not r['changes'] or not all(isinstance(c,str) and c.strip() for c in r['changes']):
        raise ValueError('Release notes must contain actual user-facing changes')
    p=ROOT/'manifest.json';m=json.loads(p.read_text());m['version']=r['version'];p.write_text(json.dumps(m,indent=2)+'\n')
    p=ROOT/'README.md';s=p.read_text();start='<!-- release:start -->';end='<!-- release:end -->'
    if s.count(start)!=1 or s.count(end)!=1: raise ValueError('Missing README release markers')
    entry=f"{start}\n### Latest release: {r['version']}\n\n"+'\n'.join('- '+c for c in r['changes'])+f'\n{end}'
    p.write_text(s[:s.index(start)]+entry+s[s.index(end)+len(end):])
if __name__=='__main__': prepare()
