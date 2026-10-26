"""Narrow independent PDF dictionary syntax reader for the R29 fixture corpus.

Consumes every byte. Uses PDF's exact whitespace and delimiter sets; it never
reuses the product regex or its sanitized dictionary representation.
"""
import re

WS=set(b'\x00\t\n\f\r ')
DELIMS=set(b'()<>[]{}/%')

def dictionary(blob):
    i=0
    def skip():
        nonlocal i
        while i<len(blob):
            if blob[i] in WS:i+=1
            elif blob[i]==37:
                while i<len(blob) and blob[i] not in (10,13):i+=1
            else:break
    def atom():
        nonlocal i
        start=i
        while i<len(blob) and blob[i] not in WS and blob[i] not in DELIMS:i+=1
        if i==start:raise ValueError(f'unexpected delimiter at byte {i}: {blob[i:i+1]!r}')
        return blob[start:i]
    def value():
        nonlocal i
        skip()
        if blob[i:i+2]==b'<<':
            i+=2;fields={}
            while True:
                skip()
                if blob[i:i+2]==b'>>':i+=2;return ('DICT',fields)
                if blob[i:i+1]!=b'/':raise ValueError(f'expected dictionary key at byte {i}')
                key=value()[1]
                if key in fields:raise ValueError('duplicate key '+repr(key))
                fields[key]=value()
        if blob[i:i+1]==b'[':
            i+=1;items=[]
            while True:
                skip()
                if blob[i:i+1]==b']':i+=1;return ('ARRAY',items)
                items.append(value())
        if blob[i:i+1]==b'(':
            i+=1;depth=1
            while i<len(blob) and depth:
                ch=blob[i];i+=1
                if ch==92:i+=1
                elif ch==40:depth+=1
                elif ch==41:depth-=1
            if depth:raise ValueError('unterminated literal string')
            return ('STRING',None)
        if blob[i:i+1]==b'<':
            i+=1
            while i<len(blob) and blob[i]!=62:
                if blob[i] not in WS and blob[i] not in b'0123456789abcdefABCDEF':raise ValueError('invalid hex string')
                i+=1
            if i>=len(blob):raise ValueError('unterminated hex string')
            i+=1;return ('STRING',None)
        if blob[i:i+1]==b'/':
            i+=1;start=i
            while i<len(blob) and blob[i] not in WS and blob[i] not in DELIMS:i+=1
            return ('NAME',blob[start:i])
        t=atom()
        if re.fullmatch(rb'[+-]?\d+',t):
            saved=i;skip()
            match=re.match(rb'(\d+)[\x00\t\n\f\r ]+R(?=[\x00\t\n\f\r ()<>\[\]{}/%]|$)',blob[i:])
            if t.isdigit() and match:i+=len(match[0]);return ('REF',(int(t),int(match[1])))
            i=saved;return ('INT',int(t))
        if re.fullmatch(rb'[+-]?(?:\d+\.\d*|\.\d+)',t):return ('REAL',float(t))
        if t in (b'true',b'false'):return ('BOOL',t==b'true')
        if t==b'null':return ('NULL',None)
        raise ValueError('invalid object token '+repr(t))
    result=value();skip()
    if i!=len(blob):raise ValueError(f'unconsumed byte at {i}')
    if result[0]!='DICT':raise ValueError('dictionary required')
    return result[1]

if __name__=='__main__':
    import base64
    import json
    import os
    from pathlib import Path
    root=Path.cwd().resolve()
    assert root.is_relative_to(Path(os.environ['TEMP']).resolve()) and 'mindx-round31-' in str(root)
    e=root/'docs/audits/round-31/evidence'
    media=json.loads((e/'native-media-results.json').read_text(encoding='utf-8'))
    results=[]
    for c in media['results']:
        if not c['id'].startswith('R29-01-pdf-'):continue
        blob=base64.b64decode(c['fixtureBase64'])
        length='-length-' in c['id']
        marker=b'4 0 obj\n' if length else b'2 0 obj\n'
        raw=blob.split(marker,1)[1].split(b'\nstream' if length else b'\nendobj',1)[0]
        try:
            fields=dictionary(raw);number=fields[b'Length' if length else b'Count']
            accepts=number==('INT',8 if length else 1);detail={'numberKind':number[0],'numberValue':repr(number[1])}
        except (ValueError,IndexError,KeyError) as error:accepts=False;detail={'error':str(error)}
        results.append({'id':c['id'],'pass':accepts==(c['expected']=='PARSED'),'wouldAccept':accepts,'expected':c['expected'],'rawHex':raw.hex(),**detail})
    assert len(results)==54
    summary={'total':len(results),'passed':sum(r['pass'] for r in results),'failed':sum(not r['pass'] for r in results),
        'method':'Unchanged independent raw-byte R30 dictionary reader, fresh executable wrapper over all 54 R29 dictionary expectations; exact PDF whitespace/delimiters and full consumption. No product parser reused.', 'results':results}
    (e/'pdf-dict-oracle-results.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k!='results'}))
    raise SystemExit(bool(summary['failed']))
