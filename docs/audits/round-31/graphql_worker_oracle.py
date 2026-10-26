"""Independent Python scanner/parser for 88 worker fixtures; no product parser reuse.

This narrow oracle checks operation, bound values, string kinds and response field.
It does not validate an unavailable LMS schema. No network or browser is used.
"""
import json
import os
from pathlib import Path
import re

def block_value(raw):
    lines=re.split(r'\r\n|\r|\n',raw)
    common=None
    for line in lines[1:]:
        indent=0
        while indent<len(line) and line[indent] in ' \t':indent+=1
        if indent<len(line):common=indent if common is None else min(common,indent)
    if common is not None:
        lines=[lines[0]]+[line[common:] for line in lines[1:]]
    while lines and not lines[0].strip(' \t'):lines.pop(0)
    while lines and not lines[-1].strip(' \t'):lines.pop()
    return '\n'.join(lines)

def lex(text):
    tokens=[];i=0
    while i<len(text):
        c=text[i]
        if c in ' \t\r\n,\ufeff':i+=1;continue
        if c=='#':
            while i<len(text) and text[i] not in '\r\n':i+=1
            continue
        if text.startswith('"""',i):
            i+=3;raw='';closed=False
            while i<len(text):
                if text.startswith('\\"""',i):raw+='"""';i+=4;continue
                if text.startswith('"""',i):i+=3;closed=True;break
                raw+=text[i];i+=1
            if not closed:raise ValueError('unterminated block string')
            tokens.append(('STRING',block_value(raw)));continue
        if c=='"':
            start=i;i+=1;closed=False
            while i<len(text):
                if text[i]=='\\':i+=2;continue
                if text[i]=='"':i+=1;closed=True;break
                i+=1
            if not closed:raise ValueError('unterminated quoted string')
            tokens.append(('STRING',json.loads(text[start:i])));continue
        m=re.match(r'[_A-Za-z][_0-9A-Za-z]*',text[i:])
        if m:tokens.append(('NAME',m[0]));i+=len(m[0]);continue
        m=re.match(r'-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?',text[i:])
        if m:tokens.append(('NUMBER',json.loads(m[0])));i+=len(m[0]);continue
        if c not in '{}():[]!$=@':raise ValueError('invalid character '+repr(c))
        tokens.append(('SYMBOL',c));i+=1
    return tokens

class Parser:
    def __init__(self,text):self.ts=lex(text);self.i=0
    def peek(self,value):return self.i<len(self.ts) and self.ts[self.i][1]==value
    def take(self,value=None):
        if self.i>=len(self.ts):raise ValueError('unexpected end')
        t=self.ts[self.i];self.i+=1
        if value is not None and t[1]!=value:raise ValueError('expected '+value)
        return t
    def name(self):
        t=self.take()
        if t[0]!='NAME':raise ValueError('name expected')
        return t[1]
    def value(self):
        if self.peek('$'):self.take('$');return ('VARIABLE',self.name())
        if self.peek('{'):
            self.take('{');d={}
            while not self.peek('}'):
                key=self.name();self.take(':')
                if key in d:raise ValueError('duplicate input key')
                d[key]=self.value()
            self.take('}');return ('OBJECT',d)
        if self.peek('['):
            self.take('[');items=[]
            while not self.peek(']'):items.append(self.value())
            self.take(']');return ('ARRAY',items)
        k,v=self.take()
        if k not in ['NAME','STRING','NUMBER']:raise ValueError('invalid value')
        return ('ENUM' if k=='NAME' else k,v)
    def args(self):
        d={}
        if not self.peek('('):return d
        self.take('(')
        while not self.peek(')'):
            key=self.name();self.take(':')
            if key in d:raise ValueError('duplicate argument')
            d[key]=self.value()
        self.take(')');return d
    def fields(self):
        self.take('{');out=[]
        while not self.peek('}'):
            field=self.name();alias=None
            if self.peek(':'):self.take(':');alias=field;field=self.name()
            args=self.args()
            while self.peek('@'):self.take('@');self.name();self.args()
            selection=self.fields() if self.peek('{') else []
            out.append({'field':field,'alias':alias,'args':args,'selection':selection})
        self.take('}');return out
    def operations(self):
        out=[]
        while self.i<len(self.ts):
            kind=self.name();name=self.name()
            if kind not in ['mutation','query','subscription']:raise ValueError('invalid operation kind')
            if self.peek('('):
                self.take('(');depth=1
                while depth:
                    k,v=self.take()
                    if k=='SYMBOL' and v=='(':depth+=1
                    if k=='SYMBOL' and v==')':depth-=1
            out.append({'kind':kind,'name':name,'fields':self.fields()})
        return out

def comparable(s):
    return re.sub(r'\n{3,}','\n\n',re.sub(r'[ \t]+',' ',s.replace('\r\n','\n'))).strip() if isinstance(s,str) else None
def judge(c,cid,sid):
    ops=Parser(c['request']['query']).operations()
    selected=[o for o in ops if o['name']==c['request'].get('operationName')]
    if len(selected)!=1 or len(selected[0]['fields'])!=1:return 0,{'reason':'operation/root selection'}
    op=selected[0];field=op['fields'][0];refs=[]
    def resolve(node):
        k,v=node
        if k=='VARIABLE':refs.append(v);return c['request'].get('variables',{}).get(v)
        if k=='OBJECT':return {a:resolve(b) for a,b in v.items()}
        if k=='ARRAY':return [resolve(a) for a in v]
        return v
    args={k:resolve(v) for k,v in field['args'].items()}
    payload=args.get('input',args)
    if isinstance(payload,dict) and 'envelope' in payload:payload=payload['envelope']
    correct=isinstance(payload,dict) and all(payload.get(k)==v for k,v in {'classId':cid,'sessionId':sid,'studentId':'S1','submissionId':'SUB1','decision':'GRADE','score':80}.items()) and comparable(payload.get('feedback'))==comparable(c['feedback'])
    enum=field['args'].get('feedback',(None,None))[0]=='ENUM'
    response=c.get('response',{});data=response.get('data') or {}
    response_ok=isinstance(data,dict) and (field['alias'] or field['field']) in data and not response.get('errors')
    verified=int(op['kind']=='mutation' and field['field']=='saveHomeworkGrade' and correct and not enum and response_ok)
    return verified,{'kind':op['kind'],'field':field['field'],'alias':field['alias'],'referencedVariables':refs,'resolvedArguments':args,'enumFeedback':enum,'correctPayload':bool(correct),'responseFieldMatches':response_ok}

def main():
    root=Path.cwd().resolve()
    assert root.is_relative_to(Path(os.environ['TEMP']).resolve()) and 'mindx-round31-' in str(root)
    e=root/'docs/audits/round-31/evidence'
    cases=json.loads((e/'worker-cases.json').read_text(encoding='utf-8'))
    native=json.loads((e/'native-worker-results.json').read_text(encoding='utf-8'))
    observed={r['id']:r for r in native['results']};results=[]
    for c in cases['results']:
        try:value,details=judge(c,cases['classId'],cases['sessionId'])
        except (ValueError,IndexError,KeyError,TypeError) as error:value=0;details={'syntaxRejected':True,'error':str(error)}
        actual=observed[c['id']]['verified']
        results.append({'id':c['id'],'pass':value==c['expected']==actual,'expectedVerified':c['expected'],'independentVerified':value,'nativeVerified':actual,**details})
    assert len(results)==88 and len({r['id'] for r in results})==88
    summary={'total':len(results),'passed':sum(r['pass'] for r in results),'failed':sum(not r['pass'] for r in results),
        'method':'Independent Python token scanner, recursive fixture parser, GraphQL BlockStringValue steps, bound arguments and selected response field compared with direct product-module observations. No product parser or JS oracle imported; no LMS schema validation.', 'results':results}
    (e/'graphql-worker-oracle-results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k!='results'}));return bool(summary['failed'])
if __name__=='__main__':raise SystemExit(main())
