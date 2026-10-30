// Independent Round 1 probes. Reuse only the supplied UI boot/fixture, then
// replace its assertions and strengthen the save/version response contract.
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const original = fs.readFileSync('scripts/test-streamline-v340-s5.ts', 'utf8');
const imports = original.slice(0, original.indexOf('async function runTests()'))
  .replaceAll('"../src/', '"../../../../src/');
let boot = original.slice(original.indexOf('  const compiledAppCss ='), original.indexOf('    await page.setContent(html'));
boot = boot.replace('const page = await context.newPage()', 'let page = await context.newPage()');
const wrapper = String.raw`
    const originalFetch = window.fetch;
    window.__conflicts = [];
    window.__savedBodies = [];
    window.__versions = {};
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const body = init && init.body ? JSON.parse(init.body) : {};
      const response = await originalFetch(input, init);
      const data = await response.json();
      let status = response.status;
      if (window.__mode === 'versions') {
        if (url.includes('/capture-screenshots')) {
          data.records.forEach(r => {r.draftVersion = 2; r.thumbnailPath += '.new.png'; window.__versions[r.studentId] = 2;});
        }
        if (url.endsWith('/save-draft')) {
          const current = window.__versions[body.studentId] || 1;
          window.__savedBodies.push(body);
          if (body.expectedVersion !== current) {
            window.__conflicts.push({studentId:body.studentId, expectedVersion:body.expectedVersion, currentVersion:current});
            status = 409; data.success = false; data.error = 'Phiên bản bản nháp đã thay đổi';
          } else {data.sessionDraft = {draftVersion:current};}
        }
      }
      if (window.__mode === 'part1fail' && url.endsWith('/save-draft')) {
        status = 409; data.success = false; data.error = 'AUDIT: lưu nháp Sản phẩm thất bại';
      }
      if (window.__mode === 'partialDemo' && url.includes('/session14-eval?')) {
        data.records[0].demoTotalScore = 4.5;
      }
      if (window.__mode === 'allSubmitted' && url.includes('/spck/list')) {
        for (const rec of data.records || []) {
          const sessions = JSON.parse(rec.sessionResultsJson);
          sessions['13'] = JSON.parse(JSON.stringify(JSON.parse(buildScannedRecord(rec.classId, 'STU_01', 'A').sessionResultsJson)['13']));
          rec.sessionResultsJson = JSON.stringify(sessions);
        }
      }
      if (window.__mode === 'SB' || window.__mode === 'App' || window.__mode === 'JSB-no-html') {
        const ext = window.__mode === 'SB' ? '.sb3' : window.__mode === 'App' ? '.py' : '.js';
        for (const rec of data.records || []) {
          if (rec.attachmentsJson) rec.attachmentsJson = JSON.stringify(['D:/audit/project' + ext]);
        }
        for (const item of data.scanResult?.items || []) item.packageData.attachments = ['D:/audit/project' + ext];
        if (window.__mode === 'App') {
          for (const cls of data.classes || []) {cls.classId = cls.classId.replace('JSB15','PTA15'); cls.className = cls.className.replace('Web JSB15','App PTA15');}
        }
      }
      return new Response(JSON.stringify(data), {status});
    };
`;
boot = boot.replace('  </script>\n  <script>${bundleCode}', wrapper + '\n  </script>\n  <script>${bundleCode}');
const checks = String.raw`
    const observations: any[] = [];
    const fresh = async (mode: string) => {
      await page.close();
      page = await context.newPage();
      let scenarioHtml = html.replace('window.__apiCalls = [];', 'window.__mode = ' + JSON.stringify(mode) + '; window.__apiCalls = [];');
      if (mode === 'App') scenarioHtml = scenarioHtml.replaceAll('VT-C4K-JSB15','VT-C4K-PTA15').replaceAll('Lớp Web JSB15','Lớp App PTA15');
      await page.setContent(scenarioHtml, {waitUntil:'networkidle'});
      await page.locator('[data-testid="s5b-auto-run-tools-checkbox"]').waitFor();
      await page.waitForFunction(() => document.body.innerText.includes('Đang chọn:'));
    };
    const calls = () => page.evaluate(() => (window as any).__apiCalls);
    const settle = async () => {
      await page.waitForFunction(() => !document.querySelector('[data-testid="s5b-auto-prep-progress"]'));
      await page.waitForTimeout(120);
    };
    const open14 = async () => {
      await page.locator('button:has-text("Buổi 14")').first().click();
      await page.locator('text=File chấm điểm BGK').first().waitFor();
      await page.waitForTimeout(150);
    };
    const combo = () => page.locator('button:has-text("🚀 Nộp Buổi 14 đầy đủ")');
    await fresh('versions');
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await settle();
    const versionResult = await page.evaluate(() => ({conflicts:(window as any).__conflicts, calls:(window as any).__apiCalls.map((c:any)=>c.url), saved:(window as any).__savedBodies}));
    assert.equal(versionResult.conflicts.length, 2);
    assert.equal(versionResult.calls.includes('/api/spck/deploy-web'), false);
    assert.equal(versionResult.calls.includes('/api/spck/upload-drive'), false);
    observations.push({id:'P01', defect:true, description:'Sau chụp ảnh version=2, cả Web và Drive dùng lại expectedVersion=1 và bị chặn trước API công cụ', ...versionResult});

    await fresh('partialDemo');
    await open14();
    const partialCalls = await calls();
    assert.equal(partialCalls.some((c:any)=>c.url.includes('/import-demo-scores')), false);
    observations.push({id:'P02', defect:true, description:'Một học viên có Demo>0, học viên còn lại=0: không tự đọc Demo', calls:partialCalls.map((c:any)=>c.url)});

    await fresh('allSubmitted');
    const allText = await page.locator('#root').innerText();
    const selected = await page.locator('text=Đang chọn:').first().innerText();
    assert.ok(selected.includes('2/2'), selected);
    observations.push({id:'P03', defect:true, description:'Cả lớp đã nộp Buổi 13 nhưng vẫn tự chọn 2/2', selected, submittedLabels:(allText.match(/Đã nộp ✓/g)||[]).length});

    await fresh('part1fail');
    await open14();
    await page.evaluate(() => {(window as any).__apiCalls=[];});
    await combo().click();
    await page.waitForFunction(() => document.body.innerText.includes('Hoàn tất nộp Buổi 14 đầy đủ'));
    const failText = await page.locator('#root').innerText();
    const failCalls = await calls();
    assert.equal(failCalls.some((c:any)=>c.url==='/api/spck/upload-lms'), false);
    assert.equal(await page.locator('button:has-text("Thử lại riêng phần Sản phẩm")').count(), 0);
    assert.ok(failText.includes('0/2 bài thành công'));
    observations.push({id:'P04', defect:true, description:'Lưu nháp phần Sản phẩm lỗi 409: phần Đánh giá vẫn chạy, banner hoàn tất, không có retry Sản phẩm', calls:failCalls, status:failText.slice(failText.indexOf('Hoàn tất'),failText.indexOf('Hoàn tất')+400)});
    await page.screenshot({path:path.join(ROOT,'docs/audits/v340/s5b-round1/P04.png'),fullPage:true});

    await fresh('normal');
    await open14();
    await page.evaluate(() => {(window as any).__simulateS14EvalStudentFail=true;});
    await combo().click();
    await page.locator('button:has-text("Thử lại riêng phần Đánh giá")').waitFor();
    await page.evaluate(() => {(window as any).__simulateS14EvalStudentFail=false; (window as any).__apiCalls=[];});
    await page.locator('button:has-text("Thử lại riêng phần Đánh giá")').click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('Thử lại riêng phần Đánh giá')));
    const retryText = await page.locator('#root').innerText();
    assert.ok(retryText.includes('Đã lưu & xác minh 1 học viên (0 cần thử lại)'));
    observations.push({id:'P05', defect:true, description:'Đánh giá: lần đầu 1 thành công + retry 1 thành công, tổng hiển thị chỉ 1 thay vì 2', status:retryText.match(/Đã lưu & xác minh[^\n]+/)?.[0], retryCalls:await calls()});

    await fresh('SB');
    await page.locator('select').first().selectOption('VT-C4K-SB28');
    await page.waitForFunction(() => (document.querySelector('select') as HTMLSelectElement)?.value === 'VT-C4K-SB28');
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await settle();
    const sbCalls = (await calls()).filter((c:any)=> /\/(scan|capture-screenshots|deploy-web|upload-drive)$/.test(c.url));
    assert.deepEqual(sbCalls.map((c:any)=>c.url), ['/api/spck/scan','/api/spck/capture-screenshots','/api/spck/upload-drive']);
    observations.push({id:'P06', defect:false, description:'SB .sb3: đúng thứ tự Quét -> Chụp -> Drive', calls:sbCalls});

    await fresh('App');
    await page.locator('button:has-text("Quét & Khớp HV")').click();
    await settle();
    const appCalls = (await calls()).filter((c:any)=> /\/(scan|capture-screenshots|deploy-web|upload-drive)$/.test(c.url));
    assert.deepEqual(appCalls.map((c:any)=>c.url), ['/api/spck/scan','/api/spck/capture-screenshots','/api/spck/upload-drive']);
    observations.push({id:'P07', defect:true, description:'App/Python PTA15 .py: chạy thêm Chụp trước Drive, khác ma trận yêu cầu hiện tại (nhưng khớp ý App/Game trong kế hoạch duyệt)', calls:appCalls});

    fs.writeFileSync(path.join(ROOT,'docs/audits/v340/s5b-round1/observations.json'),JSON.stringify(observations,null,2));
    console.log(JSON.stringify(observations.map(({id,defect,description})=>({id,defect,description})),null,2));
    await context.close();
  } finally {
    await browser.close();
    fs.rmSync(tempBuildDir, {recursive:true,force:true});
  }
}
runTests().catch(err=>{console.error(err);process.exitCode=1;});
`;
fs.writeFileSync(path.join(__dirname,'independent-probe.ts'), '// @ts-nocheck -- independent audit artifact\n'+imports+'\nasync function runTests() {\n'+boot+checks);
