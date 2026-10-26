"""Independent xref and stream-boundary corroboration, not PDF rendering."""
import base64
import io
import json
import os
from pathlib import Path
import pypdf
root=Path.cwd().resolve()
assert root.is_relative_to(Path(os.environ['TEMP']).resolve()) and 'mindx-round28-' in str(root)
out=root/'docs/audits/round-28/evidence'
data=json.loads((out/'native-media-results.json').read_text(encoding='utf-8'))
results=[]
for c in data['results']:
    if '-pdf-' not in c['id']:continue
    item={'id':c['id'],'expected':c['expected'],'productStatus':c['parseStatus']}
    blob=base64.b64decode(c['fixtureBase64'])
    # Read a standalone dictionary so pypdf cannot silently drop /Length or repair the stream.
    if c['id'].startswith('R28-') and b'4 0 obj\n<< /Length ' in blob:
        direct=blob.split(b'4 0 obj\n',1)[1].split(b'\nstream',1)[0]
        try:
            obj=pypdf.generic.read_object(io.BytesIO(direct+b'\n'),None)
            length=obj.raw_get('/Length')
            item['independentLength']={'type':type(length).__name__,'value':repr(length)}
        except Exception as e:
            item['independentDictionaryError']={'type':type(e).__name__,'error':str(e)}
    try:
        reader=pypdf.PdfReader(io.BytesIO(base64.b64decode(c['fixtureBase64'])),strict=True)
        ref=reader.trailer.raw_get('/Root')
        item.update({'rootReference':repr(ref),'rootDeclaredInXref':ref.idnum in reader.xref.get(ref.generation,{}),
                     'xrefObjectsBeforeResolution':{str(g):sorted(es) for g,es in reader.xref.items()}})
        if 'stream-' in c['id']:
            stream=pypdf.generic.IndirectObject(4,0,reader).get_object()
            payload=stream.get_data()
            item.update({'actualStreamBytes':len(payload),'streamContainsEarlyEndstream':b'endstream' in payload,
                         'streamContainsFakeCatalog9':b'9 0 obj' in payload})
        catalog=ref.get_object()
        item['resolvedRoot']=repr(catalog)
        pages=catalog['/Pages'].get_object() if catalog else None
        if pages:
            count=pages.raw_get('/Count')
            item['independentCount']={'type':type(count).__name__,'value':repr(count)}
        item['rawKids']=[{'type':type(k).__name__,'value':repr(k)} for k in pages.raw_get('/Kids')] if pages else []
        if 'kids-foreign-scalar' in c['id']:
            assert any(x['type']=='NumberObject' for x in item['rawKids'])
        item['strictRootResolutionSucceeded']=catalog is not None
    except Exception as e:
        item.update({'strictRootResolutionSucceeded':False,'errorType':type(e).__name__,'error':str(e)})
    results.append(item)
summary={'method':'pypdf strict=True; authoritative trailer Root, xref before recovery, actual stream bytes using Length, direct Kids types. Recovery behavior recorded; not rendering or full PDF conformance.',
         'version':pypdf.__version__,'sourceRoot':str(root),'results':results}
(out/'pdf-oracle-results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=True,indent=2))
