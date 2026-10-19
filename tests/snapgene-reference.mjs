/** Optional independent interoperability check. Requires Biopython and PLASMIDCRAFT_PYTHON. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseGenbank, featureSequence } from "../viewer/core.mjs";
import { snapgeneExport } from "../viewer/snapgene-export.mjs";
const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "plasmidcraft-dna-reference-"),
  ),
  expected = [];
async function add(record) {
  const file = path.join(folder, expected.length + ".dna");
  await fs.writeFile(file, snapgeneExport(record).bytes);
  expected.push({
    file,
    sequence: record.sequence,
    topology: record.topology,
    features: record.features.map((f) => ({
      name: f.name,
      type: f.type,
      strand: f.strand,
      dna: featureSequence(record, f),
      note: f.qualifiers.note,
    })),
    primers: (record.primers || []).flatMap((p) =>
      p.sites.map((s) => ({
        name: p.name,
        dna: featureSequence(record, s),
        strand: s.strand,
      })),
    ),
  });
}
try {
  for (const file of await fs.readdir(
    new URL("../data/common-features/source-records/", import.meta.url),
  )) {
    const [record] = parseGenbank(
      await fs.readFile(
        new URL(
          "../data/common-features/source-records/" + file,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    record.features = record.features.filter(
      (f) =>
        f.segments.length &&
        !/[<>]|\border\s*\(/i.test(f.originalLocation || ""),
    );
    record.primers = [];
    await add(record);
  }
  const sequence = "ACGTAGCATTCGATGCAAGTCCGATCGTTAGC";
  for (let origin = 0; origin < sequence.length; origin++)
    for (const strand of [1, -1]) {
      const segments =
        origin + 12 <= sequence.length
          ? [{ start: origin, end: origin + 12 }]
          : [
              { start: origin, end: sequence.length },
              { start: 0, end: origin + 12 - sequence.length },
            ];
      await add({
        name: "Synthetic",
        description: "Synthetic & XML",
        sequence,
        topology: "circular",
        features: [
          {
            id: "f",
            name: "Synthetic feature",
            type: "misc_feature",
            strand,
            segments,
            qualifiers: { note: ["first & second", "two values"] },
            color: "#123456",
          },
        ],
        primers: [
          {
            id: "p",
            name: "Synthetic primer",
            sequence: "GGATCCACGTAGCA",
            sites: [{ strand, segments }],
          },
        ],
        comments: [],
        warnings: [],
      });
    }
  await fs.writeFile(
    path.join(folder, "expected.json"),
    JSON.stringify(expected),
  );
  const result = spawnSync(
    process.env.PLASMIDCRAFT_PYTHON || "python3",
    [
      "-c",
      `import json,sys
from Bio import SeqIO
expected=json.load(open(sys.argv[1]))
features=primers=0
for e in expected:
 r=SeqIO.read(e['file'],'snapgene')
 assert str(r.seq)==e['sequence']
 assert r.annotations['topology']==e['topology']
 assert len(r.features)==len(e['features'])+len(e['primers'])
 for f,x in zip(r.features,e['features']):
  assert f.type==x['type'],(e['file'],x['name'])
  assert x['name'] in f.qualifiers['label']
  assert str(f.extract(r.seq))==x['dna'],(e['file'],x['name'],f.location)
  if x['strand']!=0: assert f.location.strand==x['strand']
  if x.get('note'): assert f.qualifiers['note']==x['note']
  features+=1
 for f,x in zip(r.features[len(e['features']):],e['primers']):
  assert f.type=='primer_bind'
  assert x['name'] in f.qualifiers['label']
  # Biopython 1.86 leaves reverse origin-spanning primer parts in genomic order.
  # Check its independently decoded intervals/strand, then restore biological part order.
  parts=list(f.location.parts)
  if x['strand']==-1 and len(parts)>1: parts.reverse()
  assert ''.join(str(p.extract(r.seq)) for p in parts)==x['dna'],(e['file'],x['name'],f.location)
  assert f.location.strand==x['strand']
  primers+=1
print(f'Biopython independently read {len(expected)} exported DNA files: {features} features and {primers} primer sites match sequence, topology and biological orientation.')`,
      path.join(folder, "expected.json"),
    ],
    { encoding: "utf8", env: process.env },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) process.exitCode = 1;
} finally {
  await fs.rm(folder, { recursive: true, force: true });
}
