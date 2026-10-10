"""Parse an APV v2 run: pass / fail / N/A per cell, with observed markers."""
import json, sys
def load(path):
    d = json.load(open(path)); res = {}
    def walk(s):
        for sp in s.get('specs', []):
            for t in sp['tests']:
                r = t['results'][-1] if t['results'] else {}
                ann = t.get('annotations', []) + r.get('annotations', [])
                obs = [a.get('description') for a in ann if a.get('type') == 'observed']
                na = [a.get('description') for a in ann if a.get('type') == 'na']
                st = r.get('status')
                verdict = 'pass' if st == 'passed' else ('na' if st == 'skipped' and na else 'fail')
                import re; err = re.sub(r'\x1b\[[0-9;]*m', '', (r.get('error') or {}).get('message', ''))
                res[sp['title'].split()[0]] = dict(verdict=verdict, status=st, observed=obs[-1] if obs else None,
                    na=na[-1] if na else None, title=sp['title'], error=err.split('\n')[0][:160])
        for c in s.get('suites', []): walk(c)
    for s in d['suites']: walk(s)
    return res
if __name__ == '__main__':
    r = load(sys.argv[1])
    c = {k: sum(1 for v in r.values() if v['verdict'] == k) for k in ('pass', 'fail', 'na')}
    print(len(r), 'cells', c['pass'], 'pass', c['fail'], 'fail', c['na'], 'N/A',
          f"({c['pass']}/{len(r)-c['na']} applicable)")
    full = len(sys.argv) > 2
    for k, v in sorted(r.items()):
        if v['verdict'] != 'pass' or full:
            print(f"  {k} {v['verdict'].upper():4} obs={v['observed']} {v['title']}", ('| ' + v['na']) if v['na'] else '', ('| ' + v['error']) if v['verdict']=='fail' else '')
