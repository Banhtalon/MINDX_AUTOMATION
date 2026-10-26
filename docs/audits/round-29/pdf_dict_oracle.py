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
