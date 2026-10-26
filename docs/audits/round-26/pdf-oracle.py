"""Corroborate PDF syntax and authoritative Root through pypdf, in TEMP only."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import traceback
import warnings
import pypdf
root=Path.cwd().resolve()
assert root.is_relative_to(Path(os.environ['TEMP']).resolve()) and 'mindx-round26-' in str(root)
out=root/'docs/audits/round-26/evidence'
data=json.loads((out/'native-media-results.json').read_text(encoding='utf-8'))
results=[]
for c in data['results']:
    if '-pdf-' not in c['id']:
        continue
    item={'id':c['id'],'expected':c['expected'],'productStatus':c['parseStatus']}
    try:
        reader=pypdf.PdfReader(io.BytesIO(base64.b64decode(c['fixtureBase64'])),strict=True)
        rootref=reader.trailer.raw_get('/Root')
        item['rootReference']=repr(rootref)
        item['rootDeclaredInXref']=rootref.idnum in reader.xref.get(rootref.generation,{})
        item['xrefObjectsBeforeResolution']={str(gen):sorted(entries.keys()) for gen,entries in reader.xref.items()}
        catalog=rootref.get_object()
        item['resolvedRoot']=repr(catalog)
        item['pageCount']=len(reader.pages)
        item['pageParentsPresent']=['/Parent' in page for page in reader.pages]
        item['strictReadSucceeded']=True
    except Exception as e:
        item.update({'strictReadSucceeded':False,'errorType':type(e).__name__,'error':str(e)})
    results.append(item)
summary={'method':'pypdf strict=True, exact fixture bytes, resolve authoritative trailer /Root and enumerate pages; not a rendering engine',
    'version':pypdf.__version__,'sourceRoot':str(root),'results':results}
(out/'pdf-oracle-results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
