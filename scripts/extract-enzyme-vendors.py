"""Developer extraction: source-directory (neb-web.txt, thermo.html, fastdigest.html), output-JSON. See data/restriction-enzymes/README.md."""
import re,json,html,sys
from pathlib import Path
base=Path(sys.argv[1])
rows=[]
text=(base/'neb-web.txt').read_text()
for piece in re.split(r'L\d+: ',text):
    if ' | ' not in piece: continue
    notation, names = piece.split(' | ',1)
    if not re.fullmatch(r'[ACGTRYSWKMBDHVN()0-9/\-none]+',notation.strip()): continue
    for name in re.findall(r'†([^]+)',names):
        name=re.sub(r'[®{}^\s]','',name)
        name=name.replace('WarmStart','')
        rows.append(dict(name=name,notation=notation.strip(),vendor='NEB',source='neb'))
text=(base/'thermo.html').read_text()
for piece in re.split(r'<div class="item [^"]+">',text)[1:]:
    name=re.search(r'<h2><a>(.*?)</a></h2>',piece)
    site=re.search(r'<div class="cutsite"><code>(.*?)</code>',piece)
    if name and site:
        rows.append(dict(name=html.unescape(name[1]),notation=html.unescape(re.sub('<[^>]+>','',site[1])),vendor='Thermo Fisher',source='thermo-conventional'))
# FastDigest product records use the conventional specificity. Preserve each
# actual product name and verify that all listed products have a base entry.
names=re.findall(r">FastDigest ([A-Za-z0-9]+)</a>",(base/'fastdigest.html').read_text())
known={r['name']:r for r in rows if r['vendor']=='Thermo Fisher'}
extra={'BmsI':'GCATC(5/9)','AasI':'GACNNNN/NNGTC','CsiI':'A/CCWGGT','PteI':'G/CGCGC','FokI':'GGATG(9/13)','RruI':'TCG/CGA','KflI':'GG/GWCCC','SaqAI':'T/TAA','BfoI':'RGCGC/Y','PspFI':'CCCAG/C'}
for name,notation in extra.items():
    known[name]=dict(name=name,notation=notation,vendor='Thermo Fisher',source='thermo-fastdigest')
    rows.append(known[name])
missing=[]
for name in dict.fromkeys(names):
    if name not in known: missing.append(name);continue
    rows.append(dict(known[name],name='FastDigest '+name,source='thermo-fastdigest'))
# Do not create duplicate enzyme definitions for FastDigest formulations.
for r in rows:
    if r['name'].startswith('FastDigest '): r['productName']=r['name'];r['name']=r['name'][11:]
    r['notation']=r['notation'].replace('m6','').replace('m5','').replace(' ','').replace('\u00a0','')
    if r['name']=='I-SceI': r['notation']='TAGGGATAACAGGGTAAT(-9/-13)'
for n,site in [('FspEI','CC(12/16)'),('LpnPI','CCDG(10/14)'),('McrBC','RC')]:
    rows.append(dict(name=n,notation=site,vendor='NEB',source='neb-epigenetics'))
out=Path(sys.argv[2]);out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(rows,indent=2)+'\n')
print('Rows',len(rows),'NEB',len([r for r in rows if r['vendor']=='NEB']),'Thermo conventional',len(known),'FD',len(set(names)),'FD missing',missing)
