import assert from 'node:assert/strict';
import {fixturePage,chromium} from './ui-browser.mjs';
import {serializeProject} from '../viewer/project.mjs';
const browser=await chromium.launch({headless:true});
try {
  const page=await fixturePage(browser,{viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.PLASMIDCRAFT_URL||'http://127.0.0.1:4317');
  const record={name:'Imported duplex',sequence:'AACCGGTTACGT',topology:'linear',features:[],primers:[
    {id:'f',name:'Short saved anchor',sequence:'AATCGGTTACGT',sites:[{strand:1,segments:[{start:6,end:12}]}]},
    {id:'g',name:'Imported insertion',sequence:'AACCATGGTTACGT',annealingSequence:'AACCATGGTTACGT',tailSequence:'',sites:[{strand:1,segments:[{start:0,end:12}]}]},
  ]};
  await page.locator('#file-input').setInputFiles({name:'duplex.pcraft',mimeType:'application/json',buffer:Buffer.from(serializeProject(record))});
  await page.waitForFunction(()=>document.querySelector('#document-name').textContent==='Imported duplex');
  await page.locator('#view-tabs [data-view="sequence"]').click();
  const track=page.locator('.sequence-primer-track[data-primer="f"]');
  assert.equal(await track.locator('.primer-aligned-base').count(),12);
  assert.equal(await track.locator('.mismatch').textContent(),'T');
  assert.match(await track.getAttribute('title'),/comparison beyond saved binding span/);
  const mismatch=await track.locator('.mismatch').boundingBox();
  const match=await track.locator('.match').first().boundingBox();
  assert.ok(mismatch.y < match.y,'Mismatch is raised above paired bases');
  assert.ok(await page.locator('[data-primer="g"] .primer-insertion-marker').count()>0);
  assert.deepEqual(errors,[]);
  console.log('3 primer duplex UI checks passed: imported anchor extension, visible raised substitution and imported insertion.');
} finally {await browser.close();}
