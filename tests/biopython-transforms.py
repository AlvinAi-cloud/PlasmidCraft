"""Independent check of emitted products against Biopython's native SnapGene parser."""
import json
import sys
from pathlib import Path
from Bio import SeqIO
import Bio

folder=Path(sys.argv[1])
checks=0
products=0
skipped=[]
for case in json.loads((folder/'manifest.json').read_text()):
    # PlasmidCraft normalizes IUPAC DNA to uppercase on import.
    try:
        source=SeqIO.read(case['source'],'snapgene').upper()
    except ValueError as error:
        if Path(case['source']).name!='looped_feature.dna' or str(error)!='Missing feature location':
            raise
        skipped.append(case['product'])
        continue
    product=SeqIO.read(folder/case['product'],'genbank')
    kind=case['operation']
    source_features={f.qualifiers.get('label',[''])[0]:f for f in source.features if f.type!='primer_bind'}
    product_features={f.qualifiers.get('label',[''])[0]:f for f in product.features if f.type!='primer_bind'}
    if kind=='reverse':
        expected=source.reverse_complement()
        assert product.seq==expected.seq, case
        expected_features={f.qualifiers.get('label',[''])[0]:f for f in expected.features}
        for name, feature in product_features.items():
            reference=expected_features[name]
            assert feature.extract(product.seq)==reference.extract(expected.seq),(case,name,'biological sequence')
            actual_parts=[(int(p.start),int(p.end),p.strand) for p in feature.location.parts]
            expected_parts=[(int(p.start),int(p.end),p.strand) for p in reference.location.parts]
            assert actual_parts==expected_parts,(case,name,'coordinates',actual_parts,expected_parts)
            checks+=1
    elif kind=='rotate':
        at=case['origin']
        assert product.seq==source.seq[at:]+source.seq[:at],case
        for name, feature in product_features.items():
            assert feature.extract(product.seq)==source_features[name].extract(source.seq),(case,name)
            checks+=1
    elif kind=='extract':
        expected=source[case['start']:case['end']]
        assert product.seq==expected.seq,case
        # Biopython slicing keeps only wholly contained features; compare that shared subset.
        for reference in expected.features:
            if reference.type=='primer_bind':
                continue
            name=reference.qualifiers.get('label',[''])[0]
            actual=product_features[name]
            assert actual.extract(product.seq)==reference.extract(expected.seq),(case,name)
            assert str(actual.location)==str(reference.location),(case,name,'coordinates')
            checks+=1
    elif kind=='insert':
        at=case['position']
        assert str(product.seq)==str(source.seq[:at])+'NNN'+str(source.seq[at:]),case
        for name, feature in source_features.items():
            # Features strictly on one side have a direct, independent coordinate-shift expectation.
            if int(feature.location.end)<=at:
                expected=feature.location
            elif int(feature.location.start)>=at:
                expected=feature.location+3
            else:
                continue
            actual=product_features[name]
            assert str(actual.location)==str(expected),(case,name,'coordinates')
            assert actual.extract(product.seq)==feature.extract(source.seq),(case,name,'biological sequence')
            checks+=1
    checks+=1
    products+=1
print(f"{products} real-file transformation products and {checks} independent sequence/feature checks passed with Biopython {Bio.__version__}.")
if skipped:
    print(f"{len(skipped)} products skipped: Biopython rejects looped_feature.dna (Missing feature location).")
