'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { bundle, root } = require('./render-fixture.cjs');
function dependency(name) {
  try { return require(name); }
  catch (error) { if(process.env.ALBERT_QA_DEPS) return require(path.join(process.env.ALBERT_QA_DEPS,name)); throw error; }
}
const { chromium } = dependency('playwright');
const AxeBuilder = dependency('@axe-core/playwright').default;
const { PNG } = dependency('pngjs');
const capture = process.argv.includes('--update-baselines');
const report = { version:'1.3.0', generatedAt:new Date().toISOString(), scope:'Chromium self-contained fixtures from packaged HTML/CSS/JS/assets; no deployed routing or backend test.', assertions:[], accessibility:[], viewports:[], visualComparisons:[], failures:[], manualReview:['Real screen-reader listening and navigation','Gmail/Outlook/Apple Mail client rendering','Deployed routing, authentication, upload/tutor services','Actual browser zoom and user font settings'] };
let browser;let qaPage;
const results = path.join(root,'qa');fs.mkdirSync(path.join(results,'baselines'),{recursive:true});fs.mkdirSync(path.join(results,'screenshots'),{recursive:true});
const screenFolder=path.join(root,'templates/screens/exports');fs.mkdirSync(screenFolder,{recursive:true});
async function record(name, action) { try { await action();report.assertions.push({name,pass:true});console.log('PASS '+name); }catch(e){report.failures.push({name,error:e.message});report.assertions.push({name,pass:false});console.log('FAIL '+name+' '+e.message.split('\n')[0]);if(qaPage)await qaPage.evaluate(()=>document.querySelector('dialog[open]')?.close()).catch(()=>{});} }
async function load(page,file,width=1440,height=960) {console.log('LOAD '+file+' '+width);await page.setViewportSize({width,height});await page.setContent(bundle(file),{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);await page.locator('body').waitFor();await page.evaluate(()=>scrollTo(0,0));}
async function visual(page,file,fullPage=false) {
 const current=await page.screenshot({fullPage,animations:'disabled'});
 if(capture){fs.writeFileSync(file,current);report.visualComparisons.push({file:path.relative(root,file),baselineCreated:true});return;}
 if(!fs.existsSync(file)){report.failures.push({name:'visual baseline',error:'Missing '+path.relative(root,file)});return;}
 const before=PNG.sync.read(fs.readFileSync(file));const after=PNG.sync.read(current);let changed=0;
 if(before.width!==after.width||before.height!==after.height){report.failures.push({name:'visual dimensions',error:path.relative(root,file)});return;}
 for(let i=0;i<before.data.length;i+=4){let delta=0;for(let c=0;c<4;c++)delta+=Math.abs(before.data[i+c]-after.data[i+c]);if(delta>32)changed++;}
 const ratio=changed/(before.width*before.height);const pass=ratio<=.003;report.visualComparisons.push({file:path.relative(root,file),changedPixelRatio:ratio,threshold:.003,pass});
 if(!pass){const actual=path.join(results,'screenshots','actual-'+path.basename(file));fs.writeFileSync(actual,current);report.failures.push({name:'visual comparison',error:path.relative(root,file)+' '+ratio});}
}
async function audit(page,label) {console.log('AUDIT '+label);const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();report.accessibility.push({name:label,passes:r.passes.length,violations:r.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});if(r.violations.length)report.failures.push({name:'accessibility '+label,error:r.violations.map(v=>v.id).join(', ')});}
async function fit(page,label) {const data=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));report.viewports.push({name:label,...data});assert.ok(data.documentWidth<=data.width+1,`${label}: document ${data.documentWidth} wider than viewport ${data.width}`);}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.ALBERT_BROWSER||undefined,args:process.env.ALBERT_BROWSER?['--no-sandbox']:[]});
 report.browser=browser.version();const context=await browser.newContext({reducedMotion:'reduce'});const page=await context.newPage();qaPage=page;page.setDefaultTimeout(7000);page.on('pageerror',e=>report.failures.push({name:'page error',error:e.message}));
 await load(page,'reference/index.html');
 await record('Course tabs support arrow, End, and Home keys',async()=>{await page.locator('#tab-materials').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-practice').getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await page.locator('#tab-progress').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await page.locator('#tab-materials').getAttribute('aria-selected'),'true');});
 await record('Invalid submit focuses summary with three field errors',async()=>{await page.locator('#course-form button[type=submit]').click();assert.equal(await page.locator('#form-error-list li').count(),3);assert.equal(await page.evaluate(()=>document.activeElement.id),'form-errors');await page.locator('#form-error-list a').first().click();assert.equal(await page.evaluate(()=>document.activeElement.id),'course-name');});
 await record('Valid submit preserves input and gives local confirmation',async()=>{await page.locator('#course-name').fill('Algebra I');await page.locator('#course-email').fill('learner@example.com');await page.locator('#course-method').selectOption('upload');await page.locator('#course-form button[type=submit]').click();assert.ok(await page.locator('#form-errors').isHidden());assert.match(await page.locator('#form-success').innerText(),/Nothing has been saved/);});
 await record('File picker accepts supported and rejects unsupported selections',async()=>{await page.locator('#worksheet-file').setInputFiles({name:'bad.exe',mimeType:'application/octet-stream',buffer:Buffer.from('example')});assert.equal(await page.locator('#worksheet-file').getAttribute('aria-invalid'),'true');await page.locator('#worksheet-file').setInputFiles({name:'notes.pdf',mimeType:'application/pdf',buffer:Buffer.from('example PDF fixture')});assert.match(await page.locator('#file-result').innerText(),/selected locally/);});
 await record('Search, filtering, sorting, and pagination work in the DOM',async()=>{await page.locator('#worksheet-search').fill('Graphing');assert.equal(await page.locator('#worksheet-rows tr').count(),1);await page.locator('#status-filter').selectOption('Ready');assert.ok(await page.locator('#table-empty').isVisible());await page.locator('#clear-filters').click();await page.locator('#next-page').click();assert.match(await page.locator('#page-label').innerText(),/Page 2/);await page.locator('#sort-title').click();assert.equal(await page.locator('#title-sort-header').getAttribute('aria-sort'),'descending');});
 await record('Native dialog keeps keyboard focus and restores it on Escape',async()=>{await page.locator('#review-trigger').click();assert.ok(await page.locator('#review-dialog').isVisible());for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.querySelector('#review-dialog').contains(document.activeElement)));}await page.keyboard.press('Escape');assert.ok(await page.locator('#review-dialog').isHidden());assert.equal(await page.evaluate(()=>document.activeElement.id),'review-trigger');});
 await record('Dialog confirmation toast returns focus to the correct trigger',async()=>{await page.locator('#review-trigger').click();await page.locator('#review-dialog button[value=confirm]').click();await page.locator('#toast').waitFor({state:'visible'});await page.locator('#dismiss-toast').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'review-trigger');});
 await record('Optional help dismisses with Escape',async()=>{await page.locator('#help-trigger').click();assert.ok(await page.locator('#help-content').isVisible());await page.keyboard.press('Escape');assert.ok(await page.locator('#help-content').isHidden());});
 await record('Onboarding preview steps move forward and back',async()=>{await page.locator('[data-pattern=onboarding]').click();await page.locator('#onboarding-next').click();assert.match(await page.locator('#onboarding-content').innerText(),/Add the materials/);await page.locator('#onboarding-back').click();assert.match(await page.locator('#onboarding-content').innerText(),/Choose the course/);});
 await record('Hint reveals one operation and returns to waiting',async()=>{await page.locator('[data-pattern=workspace]').click();await page.locator('#show-step').click();assert.match(await page.locator('#hint-text').innerText(),/2x ÷ 2/);await page.locator('#let-try').click();assert.match(await page.locator('#hint-text').innerText(),/Take your time/);});
 await record('Reduced motion removes control transitions',async()=>{assert.equal(await page.locator('#show-step').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');});
 await load(page,'reference/index.html');await audit(page,'Reference, initial desktop');
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});await record('Reference fits '+width+' px',()=>fit(page,'reference '+width));await visual(page,path.join(results,'baselines',`reference-${width}.png`));}
 await record('Mobile section navigation opens and closes',async()=>{await page.locator('#navigation-toggle').click();assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'),'true');await page.locator('#catalog-navigation a[href="#forms"]').click();assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'),'false');});
 await audit(page,'Reference, mobile');
 for(const screen of ['dashboard','onboarding','worksheet','settings']){
  for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
   await load(page,`templates/screens/${screen}.html`,width,height);await record(`${screen} fits ${label}`,()=>fit(page,`${screen} ${label}`));await audit(page,`${screen} ${label}`);
   await visual(page,path.join(screenFolder,`${screen}-${label}.png`),true);
  }
 }
 for(const email of ['welcome','account-recovery','import-complete','support-response']){
  await load(page,`templates/emails/previews/${email}.html`,700,900);await audit(page,`Email fixture ${email}`);
  await visual(page,path.join(results,'screenshots',`email-${email}.png`),true);
 }
 fs.writeFileSync(path.join(results,'browser-report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
 console.log(JSON.stringify({assertions:report.assertions.length,failedAssertions:report.assertions.filter(x=>!x.pass).length,audits:report.accessibility.length,visualCaptures:report.visualComparisons.length,failures:report.failures},null,2));
 if(report.failures.length)process.exitCode=1;
})().catch(async error=>{console.error(error);report.failures.push({name:'suite error',error:error.message});fs.writeFileSync(path.join(results,'browser-report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();process.exitCode=1});
