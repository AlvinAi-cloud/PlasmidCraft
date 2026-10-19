"""Optional independent genetic-code and exhaustive small-sequence ORF check."""
import json
import sys
import Bio
from Bio.Seq import Seq
from Bio.Data import CodonTable

data = json.load(open(sys.argv[1]))
for item in data['translations']:
    table = CodonTable.unambiguous_dna_by_id[item['code']]
    expected = 'M' if item['initiator'] and item['dna'] in table.start_codons else str(Seq(item['dna']).translate(table=item['code']))
    assert item['protein'] == expected, item

for case in data['cases']:
    sequence = case['record']['sequence']
    total = len(sequence)
    options = case['options']
    table = CodonTable.unambiguous_dna_by_id[options['code']]
    expected = {}
    # Enumerate each possible start independently, walking forward to its first stop.
    for strand in [1, -1]:
        oriented = sequence if strand == 1 else str(Seq(sequence).reverse_complement())
        scan = oriented * (2 if case['record']['topology'] == 'circular' else 1)
        for start in range(total):
            if scan[start:start+3] not in table.start_codons:
                continue
            for stop in range(start+3, min(len(scan), start+total)-2, 3):
                codon = scan[stop:stop+3]
                if set(codon) - set('ACGT'):
                    break
                if codon in table.stop_codons:
                    length = stop+3-start
                    key = (strand, start) if options['nested'] else (strand, stop % total)
                    candidate = (strand, start, length)
                    if key not in expected or length > expected[key][2]:
                        expected[key] = candidate
                    break
    actual = [(orf['strand'], orf['orientedStart'], orf['length']) for orf in case['orfs']]
    assert sorted(actual) == sorted(expected.values()), (case, sorted(expected.values()))
    for orf in case['orfs']:
        dna = ''.join(sequence[part['start']:part['end']] for part in orf['segments'])
        if orf['strand'] == -1:
            dna = str(Seq(dna).reverse_complement())
        assert str(Seq(dna).translate(table=options['code'], cds=True)) == orf['protein'], (case, orf)

print(f"Biopython {Bio.__version__}: {len(data['translations'])} codon/initiation checks and {len(data['cases'])} exhaustive ORF comparisons passed.")
