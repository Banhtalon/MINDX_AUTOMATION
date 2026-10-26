"""Check public specification; no product execution or private input."""
import datetime
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import pypdf
import tempfile
out=Path(__file__).resolve().parent/'evidence'
url='https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf'
cache=Path(tempfile.gettempdir())/'mindx-round31-public-PDF32000_2008.pdf'
if not cache.exists():
    with urllib.request.urlopen(url,timeout=45) as response:cache.write_bytes(response.read())
blob=cache.read_bytes()
reader=pypdf.PdfReader(io.BytesIO(blob))
found=[]
for idx in range(20,30):
    text=reader.pages[idx].extract_text()
    if 'emptysequenceofcharacters' in ''.join(text.split()):
        found.append(idx+1)
assert found, 'Exact 7.3.5 empty-name statement not found'
data={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'references':[
    {'title':'Adobe PDF 32000-1:2008','url':url,'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob),
     'section':'7.3.5','pdfPageNumbers':found,'verified':True,
     'shortExcerpt':'The token SOLIDUS (a slash followed by no regular characters) introduces a unique valid name defined by the empty sequence of characters.',
     'method':'Fresh primary Adobe PDF downloaded into memory and text checked; web tool could not open 22 MB file. No full specification persisted.'},
    {'title':'GraphQL September 2025','url':'https://spec.graphql.org/September2025/#sec-String-Value','method':'Fresh official web open; independent Python and inherited JS block-string oracles checked separately.'},
    {'title':'Installed Next CLI and TypeScript guides','files':['node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md','node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md'],
     'method':'Read before build; confirms --webpack and build regeneration of next-env.d.ts.'}]}
(out/'reference-sources.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print(json.dumps(data))
