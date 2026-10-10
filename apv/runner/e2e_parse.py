import json,sys,re
d=json.load(open(sys.argv[1]))
def w(s):
    for sp in s.get('specs',[]):
        for t in sp['tests']:
            r=t['results'][-1] if t['results'] else {}
            errs=[re.sub(r'\x1b\[[0-9;]*m','',e.get('message','')) for e in r.get('errors',[])]
            print('##',sp['title'],'->',r.get('status'))
            for e in errs: print('   ', e[:400].replace('\n',' | '))
    for c in s.get('suites',[]): w(c)
for s in d['suites']: w(s)
