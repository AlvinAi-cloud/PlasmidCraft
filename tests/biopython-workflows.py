"""Independent numerical and sequence checks; optional Biopython, not a runtime dependency."""
import json
import sys
import Bio
from Bio import Align, Restriction
from Bio.Seq import Seq
from Bio.SeqUtils import MeltingTemp as mt

with open(sys.argv[1]) as handle:
    data = json.load(handle)

for case in data['temperatures']:
    sequence = case['sequence']
    expected = mt.Tm_NN(sequence, nn_table=mt.DNA_NN3,
        dnac1=case['concentrationNm'], dnac2=case['concentrationNm'],
        selfcomp=sequence == str(Seq(sequence).reverse_complement()),
        Na=case['sodiumMm'], Mg=0, dNTPs=0, saltcorr=5)
    assert abs(expected-case['tm']) < 1e-9, (case, expected)

aligner = Align.PairwiseAligner()
aligner.mode = 'local'
aligner.match_score = 2
aligner.mismatch_score = -3
aligner.open_gap_score = -5
aligner.extend_gap_score = -1
aligner.wildcard = 'N'
for case in data['alignments']:
    expected = aligner.score(case['reference'], case['query'])
    assert expected == case['score'], (case, expected)

for case in data['digests']:
    enzyme = getattr(Restriction, case['enzyme'])
    source = Seq(case['sequence'])
    linear = case['topology'] == 'linear'
    assert -enzyme.ovhg == case['delta'], case
    expected = sorted(str(fragment) for fragment in enzyme.catalyse(source, linear=linear))
    assert sorted(case['forward']) == expected, (case['enzyme'], case['topology'], expected, case['forward'])
    # Derive the other strand's cuts from Biopython's independently supplied cut positions.
    cuts = sorted(position-1 for position in enzyme.search(source, linear=linear))
    length = len(source)
    edges = [0]+cuts+[length] if linear else cuts+[cuts[0]+length]
    opposite = []
    for i in range(len(edges)-1):
        start, end = edges[i], edges[i+1]
        bottom_start = start+(case['delta'] if not linear or i else 0)
        bottom_end = end+(case['delta'] if not linear or i<len(edges)-2 else 0)
        if linear:
            fragment = source[bottom_start:bottom_end]
        else:
            shifted = bottom_start % length
            fragment = (source+source)[shifted:shifted+bottom_end-bottom_start]
        opposite.append(str(fragment.reverse_complement()))
    assert sorted(case['reverse']) == sorted(opposite), (case['enzyme'], case['topology'], opposite, case['reverse'])

for case in data['pcr']:
    expected = case['fTail']+case['f']+case['middle']+str(Seq(case['r']).reverse_complement())+str(Seq(case['rTail']).reverse_complement())
    assert case['product'] == expected, case

large = data['large']
assert large['seeded'] and large['strand'] == -1 and large['start'] == 74123, large
assert aligner.score(large['reference'], str(Seq(large['query']).reverse_complement())) == large['score']

for case in data.get('cloningDesigns', []):
    plan = case['plan']
    regions = []
    for part in case['parts']:
        source = Seq(part['source']['sequence'])
        start, end = part['start'], part['end']
        region = source[start:end] if start < end else source[start:]+source[:end]
        regions.append(region.reverse_complement() if part['reverse'] else region)
    assert plan['record']['sequence'] == str(sum(regions, Seq('')))
    enzyme = getattr(Restriction, plan['options']['enzyme']) if plan['method'] == 'golden' else None
    width = -enzyme.ovhg if enzyme else 0
    for i, reaction in enumerate(plan['reactions']):
        f, r = reaction['primers']
        core = regions[i][width:]
        assert str(core).startswith(f['annealingSequence'])
        assert str(core).endswith(str(Seq(r['annealingSequence']).reverse_complement()))
        expected_pcr = Seq(f['tailSequence'])+core+Seq(r['tailSequence']).reverse_complement()
        assert reaction['pcr']['sequence'] == str(expected_pcr)
        for n, primer in enumerate(reaction['primers']):
            for site in primer['sites']:
                source = Seq(case['parts'][i]['source']['sequence'])
                bound = sum([source[s['start']:s['end']] for s in site['segments']], Seq(''))
                if site['strand'] == -1:
                    bound = bound.reverse_complement()
                assert str(bound) == primer['annealingSequence']
            expected_tm = mt.Tm_NN(primer['annealingSequence'], nn_table=mt.DNA_NN3,
                dnac1=250, dnac2=250, selfcomp=Seq(primer['annealingSequence']) == Seq(primer['annealingSequence']).reverse_complement(), Na=50, saltcorr=5)
            assert abs(expected_tm-reaction['properties'][n]['tm']) < 1e-9
        if enzyme:
            assert len(enzyme.search(expected_pcr, linear=True)) == 2
            fragments = list(enzyme.catalyse(expected_pcr, linear=True))
            assert str(regions[i]) in [str(fragment) for fragment in fragments]
            assert reaction['digest']['sequence'] == str(regions[i])
    if enzyme:
        assert not enzyme.search(Seq(plan['record']['sequence']), linear=False)
    else:
        overlap = plan['options']['overlap']
        products = [Seq(r['pcr']['sequence']) for r in plan['reactions']]
        for i, product in enumerate(products):
            assert product[-overlap:] == products[(i+1) % len(products)][:overlap]
        assembled = products[0] + sum([p[overlap:] for p in products[1:]], Seq(''))
        assembled = assembled[:-overlap]
        shift = overlap//2
        assert str(assembled[shift:]+assembled[:shift]) == plan['record']['sequence']
print(f"Biopython {Bio.__version__}: {len(data['temperatures'])} nearest-neighbor Tm values, "
      f"{len(data['alignments'])} affine local-alignment scores, {len(data['digests'])} double-strand digest cases, "
      f"{len(data['pcr'])} tailed PCR products, one 100-kb seeded reverse-read placement, "
      f"and {len(data.get('cloningDesigns', []))} independently checked cloning designs passed.")
