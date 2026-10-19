"""Independent codon identity/objective verification. Optional Biopython only."""
import json,sys,math,Bio
from Bio.Seq import Seq
from Bio.Data import CodonTable
with open(sys.argv[1]) as f: data=json.load(f)
tables={t['id']:t['counts'] for t in data['tables']}
code=CodonTable.unambiguous_dna_by_id[1]
aa=dict(code.forward_table)
for c in code.stop_codons: aa[c]='*'
groups={x:[c for c,v in aa.items() if v==x] for x in set(aa.values())}
for case in data['cases']:
    assert str(Seq(case['sequence']).translate())==case['protein']+'*'
    counts=[tables[case['first']],tables[case['second']]]
    weights=[case['weight'],1-case['weight']]
    sums=[0.,0.]
    for i,residue in enumerate(case['protein']+'*'):
        choices=groups[residue]
        normalized=[{c:t[c]/max(t[x] for x in choices) for c in choices} for t in counts]
        objective=lambda c:sum(w*math.log(t[c]) for w,t in zip(weights,normalized))
        selected=case['sequence'][i*3:i*3+3]
        assert abs(objective(selected)-max(map(objective,choices)))<1e-12
        if residue!='*':
            for j in (0,1): sums[j]+=math.log(normalized[j][selected])
    expected=[math.exp(s/len(case['protein'])) for s in sums]
    for i in (0,1): assert abs(expected[i]-case['scores']['hosts'][i]['score'])<1e-12
    assert abs(math.prod(x**w for x,w in zip(expected,weights))-case['scores']['combined'])<1e-12
for case in data['cds']:
    def protein(record):
        feature=record['features'][0]
        dna=''.join(record['sequence'][s['start']:s['end']] for s in feature['segments'])
        if feature['strand']==-1: dna=str(Seq(dna).reverse_complement())
        return str(Seq(dna).translate(table=11,cds=True))
    assert protein(case['source'])==protein(case['record'])
    assert case['source']['sequence'][7:11]==case['record']['sequence'][7:11]
print(f"Biopython {Bio.__version__}: {len(data['cases'])} dual-host designs independently verified for translation, per-codon joint optimality, host/combined scores and stops; {len(data['cds'])} joined/strand CDSs retain protein and intervening DNA.")
