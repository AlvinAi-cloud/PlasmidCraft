import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fixturePage,chromium} from './ui-browser.mjs';
import {serializeProject} from '../viewer/project.mjs';
import {reverseComplement} from '../viewer/core.mjs';
const browser=await chromium.launch({headless:true});
const out=process.env.PLASMIDCRAFT_TEST_OUTPUT||'test-results/primer-duplex-draft';
await fs.mkdir(out,{recursive:true});
try {
 const page=await fixturePage(browser,{viewport:{width:1480,height:1000},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.PLASMIDCRAFT_URL||'http://127.0.0.1:4317');
 const sequence='GCTAGCTAGGCTACGATCGACTGACGTTGCAAGCTTAGGCTACGATCGTACGGCATTCAGTGACCTAGCTAGCATCGACTGACGATCGTAGCTAGCTGACTAGCGATCGTACGATCGTAGCTAGCTAGCAT';
 const start=22,end=48,arm=sequence.slice(start,end);
 const variants=[
  ['01-mismatches','Primer substitutions',{annealing:arm.slice(0,7)+'AAA'+arm.slice(10),tail:''}],
  ['02-insertion','Primer insertion',{annealing:arm.slice(0,12)+'GATCTA'+arm.slice(12),tail:''}],
  ['03-tails','Primer 5′ tails',{annealing:arm,tail:'GGTCTCGTCGAC'}],
 ];
 for(const [file,name,v] of variants.filter(v=>!process.env.PLASMIDCRAFT_TAILS_ONLY || v[0]==="03-tails")){
  const r={name,description:'Synthetic display example for visual review.',sequence,topology:'linear',features:[],primers:[{id:'f',name:'Forward primer',sequence:v.tail+v.annealing,annealingSequence:v.annealing,tailSequence:v.tail,description:'Manual selection binding: visual example',sites:[{strand:1,segments:[{start,end}]}]},{id:'r',name:'Reverse primer',sequence:v.tail+reverseComplement(v.annealing),annealingSequence:reverseComplement(v.annealing),tailSequence:v.tail,description:'Manual selection binding: visual example',sites:[{strand:-1,segments:[{start:70,end:96}]}]}]};
  // The reverse example uses the reverse complement of its own template region.
  const reverseArm=reverseComplement(sequence.slice(70,96));
  const altered=file==='01-mismatches'?reverseArm.slice(0,7)+'AAA'+reverseArm.slice(10):file==='02-insertion'?reverseArm.slice(0,12)+'GATCTA'+reverseArm.slice(12):reverseArm;
  r.primers[1].annealingSequence=altered;r.primers[1].sequence=v.tail+altered;
  await page.locator('#file-input').setInputFiles({name:file+'.pcraft',mimeType:'application/json',buffer:Buffer.from(serializeProject(r))});
  await page.waitForFunction(name=>document.querySelector('#document-name').textContent===name,name);
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await page.locator('.sequence-primer-track').first().waitFor();
  if(file==='01-mismatches')assert.ok(await page.locator('.primer-unpaired-outline').count()>0);
  if(file==='02-insertion')assert.ok(await page.locator('.primer-insertion-marker').count()>0);
  if(file==='03-tails')assert.ok(await page.locator('.primer-tail-duplex').count()>0);
  assert.doesNotMatch(await page.locator('.sequence-primer-track').allTextContents().then(x=>x.join(' ')), /on this line|5′ tail:/);
  assert.equal(await page.locator('.primer-start-label').count(),2);
  const forwardLabel=await page.locator('[data-primer="f"] .primer-start-label').boundingBox();
  const reverseLabel=await page.locator('[data-primer="r"] .primer-start-label').boundingBox();
  const forwardMatch=await page.locator('[data-primer="f"] .primer-aligned-base.match').first().boundingBox();
  const reverseMatch=await page.locator('[data-primer="r"] .primer-aligned-base.match').first().boundingBox();
  const forwardDna=await page.locator('[data-primer="f"]').locator('..').locator('.reference-track .base').first().boundingBox();
  const reverseDna=await page.locator('[data-primer="r"]').locator('..').locator('.complement-track .base').first().boundingBox();
  const forwardGap=forwardDna.y-forwardMatch.y-forwardMatch.height;
  const reverseGap=reverseMatch.y-reverseDna.y-reverseDna.height;
  assert.ok(Math.abs(forwardGap-reverseGap)<=1, `DNA gaps should match: forward=${forwardGap}, reverse=${reverseGap}`);
  assert.ok(forwardLabel.y < forwardMatch.y && reverseLabel.y > reverseMatch.y,'Names mirror around DNA');
  if(file==='03-tails') {
   const fTail=await page.locator('[data-primer="f"] .primer-tail-duplex > span').boundingBox();
   const fBase=await page.locator('[data-primer="f"] .primer-aligned-base').first().boundingBox();
   assert.ok(Math.abs(fTail.x+fTail.width-fBase.x)<1,'Forward tail joins binding start');
   const rTail=await page.locator('[data-primer="r"] .primer-tail-duplex > span').boundingBox();
   const rBase=await page.locator('[data-primer="r"] .primer-aligned-base').first().boundingBox();
   assert.ok(Math.abs(rTail.x-rBase.x-rBase.width)<1,'Reverse tail joins binding start');
   assert.ok(rTail.y>=rBase.y+rBase.height,'Reverse tail is below binding row');
  }
  await page.locator("#toast").waitFor({state:"hidden"});
  await page.screenshot({path:`${out}/${file}.png`});
  await fs.writeFile(`${out}/${file}.pcraft`,serializeProject(r));
 }
 assert.deepEqual(errors,[]);
 console.log('3 duplex preview examples rendered without page errors; mismatch, insertion and tail structures verified.');
} finally {await browser.close();}
