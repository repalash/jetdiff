#!/usr/bin/env python3
"""One offline pack (.zip) per repository of a snapshot recorded with record-snapshot.cjs --repos.

    python3 tools/make-pack.py snap/<name> <out dir> [max MB per zip, default 80]

A larger repository is split into parts (<name>-1of2.zip ...) that each hold the whole index: import all of them.
A pack of a private repository holds its code."""
import json, os, sys, urllib.parse, zipfile

src, out = sys.argv[1], sys.argv[2]
max_bytes = float(sys.argv[3] if len(sys.argv) > 3 else 80) * 1e6
os.makedirs(out, exist_ok=True)
index = json.load(open(os.path.join(src, 'index.json')))
repos = json.load(open(os.path.join(src, 'repos.json')))
for r in repos:
    owner, repo = r['owner'], r['repo']
    path = f'/repos/{owner}/{repo}/'
    q = f'repo:{owner}/{repo}'
    sub = {k: v for k, v in index.items() if k.startswith(path) or q in urllib.parse.unquote(k)}
    name = f'{owner}-{repo}'
    files = sorted({v['file'] for v in sub.values()})
    # parts by (uncompressed) size: about 3:1 compression for this text, so aim at 2.5x the limit per part
    parts, cur, size = [], [], 0
    for f in files:
        n = os.path.getsize(os.path.join(src, f))
        if cur and size + n > max_bytes * 2.5:
            parts.append(cur); cur, size = [], 0
        cur.append(f); size += n
    parts.append(cur)
    for i, part in enumerate(parts):
        suffix = f'-{i + 1}of{len(parts)}' if len(parts) > 1 else ''
        zpath = os.path.join(out, f'{name}{suffix}.zip')
        with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            z.writestr(f'{name}/index.json', json.dumps(sub))
            z.writestr(f'{name}/repos.json', json.dumps([r]))
            for f in part:
                z.write(os.path.join(src, f), f'{name}/{f}')
        print(f'{zpath}: {len(r["prs"])} PRs, {len(part)} of {len(files)} files, {os.path.getsize(zpath) / 1e6:.1f} MB')
