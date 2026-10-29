import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSequenceCode } from "../viewer/ai-compute-engine.mjs";
import { validateComputation, computationInput } from "../viewer/ai-custom-tools.mjs";
import { ConnectedWorkspace } from "../viewer/ai-tools.mjs";
import { replaceGene } from "../viewer/gene-replacement.mjs";
import { featureSequence, reverseComplement } from "../viewer/core.mjs";

const feature = (id, start, end, strand = 1, type = "CDS") => ({ id, name: id, strand, type, color: "#79a995", segments: [{ start, end }], qualifiers: {} });
const record = (strand = 1) => ({ name: "vector", sequence: "CCGG" + (strand === 1 ? "ATGAAATAA" : reverseComplement("ATGAAATAA")) + "GGCCATGCCCTAA", topology: "circular", features: [feature("old gene", 4, 13, strand),feature("other",17,26)], primers: [], comments: [], warnings: [] });

test("custom algorithms execute in an isolated interpreter and return JSON tables", async () => {
  const input = { document: record() };
  const result = await evaluateSequenceCode(`const s=input.document.sequence; const rows=[]; for(let i=0;i<s.length-2;i++) if(s.slice(i,i+3)==='ATG') rows.push([i+1]); return {reports:[{title:'Custom ATG scan',columns:['Position'],rows}]};`, input);
  assert.deepEqual(validateComputation(result).reports[0].rows, [[5],[18]]);
  const globals = await evaluateSequenceCode(`return ['fetch','window','document','process','require','__TAURI__'].map(n=>typeof globalThis[n]);`,{});
  assert.deepEqual(globals, Array(6).fill("undefined"));
});
test("custom loops, excessive allocations and invalid output are bounded", async () => {
  await assert.rejects(evaluateSequenceCode("while(true){}",{}, { timeoutMs: 20 }), /interrupt|failed/i);
  await assert.rejects(evaluateSequenceCode("return 'X'.repeat(100000000);",{}), /failed|memory/i);
  await assert.rejects(evaluateSequenceCode("return undefined;",{}), /JSON|failed/);
  await assert.rejects(evaluateSequenceCode("return Promise.resolve({});",{}), /synchronous|failed/);
  assert.throws(()=>validateComputation({documents:[{...record(),features:[feature('bad',0,2000)]}]}), /coordinates/);
  assert.throws(()=>validateComputation({reports:[{columns:['a'],rows:[[1,2]]}]}), /columns/);
});
test("computation input excludes document history, paths and account data", () => {
  const w = new ConnectedWorkspace({...record(),sourceFile:'/private/path',apiKey:'secret',aiConversations:[{text:'private history'}]});
  const input = computationInput(w);
  assert.doesNotMatch(JSON.stringify(input), /secret|private history|private.path/);
  assert.equal(input.document.sequence, record().sequence);
});
test("gene swaps preserve vector DNA, remap neighbors and verify both orientations", () => {
  for (const strand of [1,-1]) {
    const source = record(strand), before = structuredClone(source);
    source.features.push(feature('internal tag',7,10,strand,'misc_feature'));
    const replacement = 'ATGGGTCCCTAA';
    const result = replaceGene(source,'old gene',{geneName:'new gene',sequence:replacement});
    assert.equal(result.record.sequence,'CCGG'+(strand===1?replacement:reverseComplement(replacement))+'GGCCATGCCCTAA');
    assert.equal(featureSequence(result.record,result.feature),replacement);
    assert.equal(result.feature.strand,strand);
    assert.equal(result.record.features.find(f=>f.id==='other').segments[0].start,20);
    assert.equal(result.record.features.some(f=>f.id==='internal tag'),false);
    assert.equal(source.sequence,before.sequence);
    assert.equal(source.features[0].name,'old gene');
  }
});
test("connected gene swaps use only explicitly attached replacement templates", () => {
  const source = record(), template = {...record(),id:'insert',name:'new gene template'};
  template.sequence='ATGGGGTAA'; template.features=[feature('replacement',0,9)];
  const w = new ConnectedWorkspace(source,{templates:[template]});
  w.run('replace_gene',{featureId:'old gene',sourceTemplate:'insert',sourceFeatureId:'replacement'});
  const result=w.finish()[0];
  assert.equal(result.features.find(f=>f.id==='old gene').name,'replacement');
  assert.equal(result.sequence,'CCGGATGGGGTAAGGCCATGCCCTAA');
  assert.equal(source.features[0].name,'old gene');
  assert.throws(()=>new ConnectedWorkspace(source).run('replace_gene',{featureId:'old gene',sourceTemplate:'insert',sourceFeatureId:'replacement'}), /attached/);
});
test("cloud computations validate all results before staging and obey DNA sharing", async () => {
  let input;
  const source=record();
  const w=new ConnectedWorkspace(source,{cloudCompute:async args=>{input=args.input; return {result:{documents:[{...source,name:'cloud variant'}],reports:[{title:'Summary',text:'ATGAAATAA'}]},code:'print(1)'};}});
  const result=await w.runAsync('cloud_compute',{task:'Test computation'});
  assert.equal(result.execution,'cloud');
  assert.equal(result.reports,undefined);
  assert.equal(result.context.document.sequence,undefined);
  assert.equal(input.document.sequence,source.sequence);
  assert.equal(w.outputs[0].text,'ATGAAATAA');
  assert.equal(w.finish()[0].name,'cloud variant');
  const broken=new ConnectedWorkspace(source,{cloudCompute:async()=>({result:{documents:[{...source,name:'valid'}, {...source,name:'bad',features:[feature('bad',0,2000)]}]}})});
  await assert.rejects(broken.runAsync('cloud_compute',{task:'Invalid result'}), /coordinates/);
  assert.equal(broken.finish().length,0);
  await assert.rejects(new ConnectedWorkspace(source).runAsync('cloud_compute',{task:'Unavailable'}), /requires/);
});
