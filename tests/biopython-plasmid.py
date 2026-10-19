"""Optional independent validation; Biopython is not an app dependency."""
import sys,json,Bio
from Bio.Align import PairwiseAligner
from Bio.Seq import Seq
with open(sys.argv[1]) as handle:
    data=json.load(handle)
a=PairwiseAligner(mode='global',match_score=2,mismatch_score=-3,open_gap_score=-5,extend_gap_score=-1)
for c in data['cases']:
    expected=a.score(c['reference'],c['query'])
    assert expected==c['result']['score']==c['independentFull']['score'], (c,expected)
    r=c['result']
    assert r['matches']+r['mismatches']+r['ambiguous']+r['deleted']==len(c['reference'])
    assert r['matches']+r['mismatches']+r['ambiguous']+r['inserted']==len(c['query'])
assert data['mutations']
for c in data['mutations']:
    assert Seq(c['before']).translate(table=11)==Seq(c['after']).translate(table=11)
    assert 'GGTCTC' not in c['after'] and 'GAGACC' not in c['after']
print(f"Biopython {Bio.__version__}: {len(data['cases'])} global affine scores/full-molecule coverage and {len(data['mutations'])} synonymous site removals passed. Origin proposals themselves are heuristic.")
