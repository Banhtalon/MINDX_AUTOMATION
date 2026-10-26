"""Corroborate PDF empty Names using pypdf and the independent raw dictionary reader."""
import base64
import io
import json
import os
from pathlib import Path
import pypdf
from pdf_dict_oracle import dictionary
root=Path.cwd().resolve()
assert root.is_relative_to(Path(os.environ['TEMP']).resolve()) and 'mindx-round30-' in str(root)
e=root/'docs/audits/round-30/evidence'
data=json.loads((e/'pdf-name-results.json').read_text(encoding='utf-8'))
results=[]
for c in data['results']:
    raw=base64.b64decode(c['rawDictionaryBase64'])
    class Context:
        strict=True
    obj=pypdf.generic.read_object(io.BytesIO(raw+b'\n'),Context())
    independent=dictionary(raw)
    empty='empty-name' in c['id']
    array='array-' in c['id']
    actual=obj['/Other'][0] if array else obj['/Other']['/Value']
    expected='/' if empty else '/Nonempty'
    assert isinstance(actual,pypdf.generic.NameObject) and str(actual)==expected,(c['id'],actual)
    check=independent[b'Other'][1][0] if array else independent[b'Other'][1][b'Value']
    assert check==('NAME',b'' if empty else b'Nonempty'),(c['id'],check)
    reader=pypdf.PdfReader(io.BytesIO(base64.b64decode(c['fixtureBase64'])),strict=True)
    assert len(reader.pages)==1
    results.append({'id':c['id'],'pass':True,'pypdfNameType':type(actual).__name__,'pypdfNameValue':str(actual),
        'independentNameBytesHex':check[1].hex(),'pages':len(reader.pages),'r29Success':c['r29Success'],'currentStatus':c['currentStatus']})
summary={'total':len(results),'passed':len(results),'failed':0,'version':pypdf.__version__,
    'method':'pypdf strict standalone dictionary, strict complete PDF page resolution, and independent raw-byte dictionary reader; NameObject slash is a legal empty Name per PDF 32000-1 7.3.5.', 'results':results}
(e/'pdf-name-oracle-results.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary))
