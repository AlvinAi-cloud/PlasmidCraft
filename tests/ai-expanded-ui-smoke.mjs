import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { exportGenbank } from "../viewer/core.mjs";
const source = {
  name: "Gene swap vector", description: "Synthetic vector", sequence: "CCGGATGAAATAAGGCCATGCCCTAA", topology: "circular",
  features: [
    { id:"old",name:"Old gene",type:"CDS",strand:1,segments:[{start:4,end:13}],qualifiers:{} },
    { id:"other",name:"Other gene",type:"CDS",strand:1,segments:[{start:17,end:26}],qualifiers:{} },
    { id:"bind",name:"Binding annotation",type:"primer_bind",strand:1,segments:[{start:7,end:10}],qualifiers:{} },
  ],
  primers:[{id:"p",name:"Retained oligo",sequence:"AAA",annotationId:"bind",sites:[{strand:1,segments:[{start:7,end:10}]}]}],
};
const browser=await chromium.launch({headless:true});
const errors=[];
let checks=0;
async function load(page, name="vector.pcraft") {
  await page.locator('#file-input').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(serializeProject(source))});
  await page.waitForFunction(()=>document.querySelector('#document-name').textContent==='Gene swap vector');
}
try {
  const bulk=await fixturePage(browser,{viewport:{width:1440,height:1000},acceptDownloads:true});
  bulk.on('pageerror', e=>errors.push(e.message));
  await bulk.goto(process.env.PLASMIDCRAFT_URL||'http://127.0.0.1:4317');
  await load(bulk);
  await bulk.locator('#view-tabs [data-view="features"]').click();
  assert.equal(await bulk.locator('[data-action="bulk-clear"] + button').textContent(),'Remove selected features');
  assert.equal(await bulk.locator('#bulk-remove-button').isDisabled(),true);
  await bulk.locator('[data-bulk-feature="old"]').check();
  await bulk.locator('[data-bulk-feature="bind"]').check();
  await bulk.locator('#table-filter').fill('Other');
  await bulk.locator('#bulk-remove-button').click();
  assert.equal(await bulk.locator('#feature-count').textContent(),'1');
  await bulk.locator('#undo-button').click();
  assert.equal(await bulk.locator('#feature-count').textContent(),'3');
  await bulk.locator('#redo-button').click();
  const waiting=bulk.waitForEvent('download');
  await bulk.locator('#save-project-button').click();
  const saved=parseProject(await fs.readFile(await (await waiting).path(),'utf8'));
  assert.equal(saved.sequence,source.sequence);
  assert.deepEqual(saved.features.map(f=>f.id),['other']);
  assert.equal(saved.primers[0].sequence,'AAA');
  assert.equal(saved.primers[0].annotationId,undefined);
  checks+=2;
  await bulk.close();

  const page=await fixturePage(browser,{viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.mock={replies:[],requests:[],cloud:[],saved:[],openText:null};
    window.__TAURI_INTERNALS__={};
    window.__TAURI__={
      core:{invoke:async(cmd,args)=>{
        if(cmd==='chatgpt_status')return {accounts:[]};
        if(cmd==='ai_restore_saved')return {provider:'openai',endpoint:'https://api.openai.com/v1',model:'mock-model',remembered:true};
        if(cmd==='ai_request') { window.mock.requests.push(args); return {status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(window.mock.replies.shift()||{message:'Done',operations:[],continue:false})}]}]}; }
        if(cmd==='ai_compute') {window.mock.cloud.push(args); return {result:{reports:[{title:'Cloud result',columns:['Result'],rows:[[42]],text:'Python calculation'}]},code:'result=42'};}
        if(cmd==='save_file_atomic') {window.mock.saved.push(new TextDecoder().decode(args));return;}
      }},
      dialog:{open:async()=>window.mock.openText?'/selected/result.gb':null,save:async()=>'/selected/export',confirm:async()=>false},
      fs:{stat:async()=>({size:100}),readFile:async()=>new TextEncoder().encode(window.mock.openText||'')},
      window:{getCurrentWindow:()=>({setTitle:async()=>{},onCloseRequested:async()=>()=>{}})},
      event:{listen:async(_,fn)=>{window.menu=action=>fn({payload:action});return()=>{};}},
      clipboardManager:{writeText:async text=>{window.mock.clipboard=text;}},
    };
  });
  await page.goto(process.env.PLASMIDCRAFT_URL||'http://127.0.0.1:4317');
  await load(page);
  const originalId=await page.locator('#document-tabs .active').getAttribute('data-document');
  assert.equal(await page.locator('.inspector-tool + #ai-assistant-button').count(),1);
  await page.locator('#ai-assistant-button').click();
  assert.equal(await page.locator('#ai-cloud-fallback').count(),0);
  assert.doesNotMatch(await page.locator('#ai-panel').textContent(),/Computations run locally first|Custom calculations run on this computer/);
  async function run(operations, text='Do this task', more=[]) {
    await page.waitForSelector('[data-ai="send"]:not([disabled])');
    await page.evaluate(replies=>{window.mock.replies=replies;},[{message:'Applying requested operation',operations,continue:false},...more]);
    await page.locator('#ai-goal').fill(text);
    await page.locator('[data-ai="send"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-ai="cancel"]').disabled);
  }
  await run([{tool:'replace_gene',arguments:{featureId:'old',geneName:'New gene',sequence:'ATGGGTCCCTAA'}}],'Replace Old gene with the supplied new DNA');
  assert.equal(await page.locator('#ai-error').textContent(),'',await page.locator('#ai-operations').textContent());
  assert.match(await page.locator('#document-name').textContent(),/AI_design/);
  assert.match(await page.locator('#ai-operations').textContent(),/Replaced Old gene with New gene/);
  assert.equal(await page.getByRole('button',{name:'New gene 12 bp',exact:true}).count(),1);
  await page.locator(`#document-tabs [data-document="${originalId}"]`).click();
  assert.equal(await page.getByRole('button',{name:'Old gene 9 bp',exact:true}).count(),1);
  checks++;
  const copyOp={tool:'copy_document',arguments:{name:'Once only'}};
  await run([copyOp],'Make one copy',[{message:'Checking completed copy',operations:[copyOp],continue:false},{message:'The copy was created once',operations:[],continue:false}]);
  assert.equal(await page.locator('.ai-operation.completed').count(),1);
  assert.equal(await page.locator('#document-tabs [data-document]').filter({hasText:'Once only'}).count(),1);
  await page.locator(`#document-tabs [data-document="${originalId}"]`).click();
  checks++;
  await run([{tool:'run_code',arguments:{code:"const s=input.document.sequence; const gc=[...s].filter(b=>b==='G'||b==='C').length; return {reports:[{title:'Custom GC count',columns:['GC bases','Length'],rows:[[gc,s.length]]}]};"}}],'Count GC with a custom algorithm');
  assert.match(await page.locator('#ai-operations').textContent(),/Custom GC count/);
  assert.equal(await page.locator('.ai-report-table td').nth(1).textContent(),'26');
  assert.equal(await page.evaluate(()=>window.mock.cloud.length),0);
  await page.getByRole('button',{name:'Export table CSV…',exact:true}).click();
  assert.match(await page.evaluate(()=>window.mock.saved.at(-1)),/GC bases.*Length/);
  checks++;
  await run([{tool:'run_code',arguments:{code:'throw Error("Need Python library for this analysis");'}}],'Use local first and cloud if necessary',[{message:'Using cloud after the local computation failed',operations:[{tool:'cloud_compute',arguments:{task:'Compute the requested Python-library analysis'}}],continue:false}]);
  assert.equal(await page.evaluate(()=>window.mock.cloud.length),1);
  assert.match(await page.locator('#ai-operations').textContent(),/Cloud result/);
  assert.match(await page.locator('#ai-operations').textContent(),/custom cloud computation/);
  checks++;
  await page.locator('#ai-dna').uncheck();
  await run([{tool:'cloud_compute',arguments:{task:'No DNA consent'}}],'Analyze without sharing',[{message:'DNA sharing is needed for cloud computation',operations:[],continue:false}]);
  assert.equal(await page.evaluate(()=>window.mock.cloud.length),1);
  checks++;
  await page.waitForSelector('[data-ai="send"]:not([disabled])');
  await page.evaluate(()=>{window.mock.replies=[{message:'Computing',operations:[{tool:'run_code',arguments:{code:'while(true){}'}}],continue:false}];});
  await page.locator('#ai-goal').fill('Long computation to stop');
  await page.locator('[data-ai="send"]').click();
  await page.locator('[data-ai="cancel"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-ai="cancel"]').disabled);
  assert.match(await page.locator('#ai-operations').textContent(),/Stopped/);
  checks++;
  await page.locator('[data-ai="navigate-external"]').click();
  await page.locator('[data-ai="export-ai-file"]').click();
  assert.match(await page.evaluate(()=>window.mock.saved.at(-1)),/^LOCUS/);
  await page.locator('[data-ai="copy-file-prompt"]').click();
  assert.match(await page.evaluate(()=>window.mock.clipboard),/downloadable GenBank/);
  await page.evaluate(text=>{window.mock.openText=text;},exportGenbank({...source,name:'Website result'}));
  await page.locator('[data-ai="import-ai-file"]').click();
  await page.waitForFunction(()=>document.querySelector('#document-name').textContent==='Website_result_AI_import');
  assert.equal(await page.locator(`#document-tabs [data-document="${originalId}"]`).count(),1);
  checks++;
  assert.deepEqual(errors,[]);
  console.log(`${checks} expanded AI/bulk-removal UI checks passed: batch Undo, primer preservation, gene swap, isolated computation, reports/CSV, local-first cloud recovery, DNA consent, Stop and account-file handoff.`);
} finally { await browser.close(); }
