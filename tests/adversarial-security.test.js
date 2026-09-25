const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'adversarial-'));
const port = 6900 + Math.floor(Math.random() * 200);
const base = 'http://127.0.0.1:' + port;
const sameOrigin = base;
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js','finance-automation-server.js','auth-crypto.js','backup.js','index.html','manifest.webmanifest','service-worker.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}
fs.mkdirSync(path.join(temp, 'assets'), { recursive: true });
for (const file of ['mobile-pwa.js','curriculum-frameworks.js','education-stages.js','finance-automation.js']) {
  fs.copyFileSync(path.join(root, 'assets', file), path.join(temp, 'assets', file));
}

fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [
    { id:'school-alpha', name:'Alpha ECD', status:'active' },
    { id:'school-bravo', name:'Bravo School', status:'active' }
  ],
  users: [
    { username:'alpha-admin', pinHash:hash('AdminPass1'), name:'Alpha Admin', role:'admin', schoolId:'school-alpha', schoolName:'Alpha ECD', verificationStatus:'Active' },
    { username:'alpha-principal', pinHash:hash('PrincipalPass1'), name:'Alpha Principal', role:'principal', schoolId:'school-alpha', schoolName:'Alpha ECD', verificationStatus:'Active' },
    { username:'alpha-teacher', pinHash:hash('TeacherPass1'), name:'Alpha Teacher', role:'teacher', schoolId:'school-alpha', schoolName:'Alpha ECD', verificationStatus:'Active', assignedClasses:['Owls'] },
    { username:'alpha-parent', pinHash:hash('ParentPass1'), name:'Alpha Parent', role:'parent', schoolId:'school-alpha', schoolName:'Alpha ECD', verificationStatus:'Active', parentRelationshipStatus:'Administrator approved', linkedLearners:['Alpha Learner'] },
    { username:'bravo-admin', pinHash:hash('BravoPass1'), name:'Bravo Admin', role:'admin', schoolId:'school-bravo', schoolName:'Bravo School', verificationStatus:'Active' }
  ],
  moduleRecords:{}, posts:[], schedules:[], worksheets:[], attendance:[], badges:[], tickets:[], broadcasts:[],
  students:[{ id:'alpha-student', studentName:'Alpha Learner', className:'Owls', contactEmail:'alpha-parent', schoolId:'school-alpha', schoolName:'Alpha ECD' }],
  chatGroups:[], groupMessages:{}, directMessages:[], parentPayments:[], paymentEvents:[], paymentLedger:[], schoolBilling:{}
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd: temp,
  env: {
    ...process.env, PORT:String(port), NODE_ENV:'test', LF_REPLICA_MODE:'1', LF_TEST_ALLOW_REPLICA_WRITES:'1',
    LF_TEST_ENFORCE_ORIGIN:'1', LF_MAX_API_BODY_MB:'1', LF_API_MUTATION_RATE_LIMIT:'600', LF_API_READ_RATE_LIMIT:'3000'
  },
  stdio:['ignore','ignore','pipe']
});
let stderr=''; child.stderr.on('data', chunk => { stderr += chunk.toString(); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stop = () => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });

async function request(route, options={}) {
  const { method='GET', body, rawBody, cookie, origin, headers={} } = options;
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (cookie) requestHeaders.cookie = cookie;
  if (origin) requestHeaders.origin = origin;
  const response = await fetch(base + route, { method, headers:requestHeaders, body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined, redirect:'manual' });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie, text };
}

async function login(username,pin) {
  const result = await request('/api/login',{method:'POST',body:{username,pin}});
  assert.equal(result.response.status,200,'login should succeed for '+username);
  return result.cookie;
}

(async()=>{
  try {
    for(let i=0;i<120;i++){
      try { const r=await fetch(base+'/api/health'); if(r.ok) break; } catch {}
      if(i===119) throw new Error('Adversarial server failed to start: '+stderr);
      await wait(100);
    }

    // 1. Security headers and feature-preserving browser policy.
    const health = await request('/api/health');
    assert.equal(health.response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(health.response.headers.get('x-frame-options'),'DENY');
    assert.match(health.response.headers.get('content-security-policy')||'', /frame-ancestors 'none'/);
    assert.match(health.response.headers.get('permissions-policy')||'', /camera=\(self\)/);
    assert.doesNotMatch(health.response.headers.get('x-powered-by')||'', /express/i);

    // 2. Sensitive-file theft and traversal attempts.
    for (const target of [
      '/.env','/server.js','/backup-server.js','/auth-crypto.js','/package.json','/package-lock.json',
      '/littlefeet.db','/littlefeet-replica.json','/tests/security-regression.test.js','/.git/config',
      '/%2e%2e/server.js','/%252e%252e/server.js','/assets/%2e%2e/server.js','/output/%2e%2e/server.js'
    ]) {
      const result = await request(target);
      assert.equal(result.response.status,404,'sensitive path must not be served: '+target);
    }

    // 3. Unauthenticated private API probes.
    for (const target of ['/api/accounts','/api/registry','/api/modules/curriculum','/api/payments/ledger','/api/production-readiness','/api/book-register','/api/system-errors']) {
      const result=await request(target);
      assert.ok([401,403].includes(result.response.status),'private API leaked without auth: '+target+' -> '+result.response.status);
    }

    // 4. Login injection and brute-force protection.
    const injection = await request('/api/login',{method:'POST',body:{username:"' OR 1=1 --",pin:'anything'}});
    assert.equal(injection.response.status,401);
    let sprayStatus=0;
    for(let i=0;i<6;i++){
      const attempt=await request('/api/login',{method:'POST',body:{username:'spray-user',pin:'wrong-'+i}});
      sprayStatus=attempt.response.status;
    }
    assert.equal(sprayStatus,429);

    // 5. Oversized body should be rejected before persistence.
    const oversized = 'x'.repeat(1100000);
    const tooLarge = await request('/api/signup',{method:'POST',rawBody:JSON.stringify({username:'large@example.com',pin:'1234',name:oversized,role:'parent',schoolName:'Alpha ECD',termsAccepted:true}),headers:{'content-type':'application/json'}});
    assert.equal(tooLarge.response.status,413);

    // 6. Public signup cannot self-assign privileged roles.
    const adminSignup=await request('/api/signup',{method:'POST',body:{username:'rogue-admin@example.com',pin:'12345',name:'Rogue',role:'admin',schoolName:'Alpha ECD',termsAccepted:true}});
    assert.equal(adminSignup.response.status,400);

    const alphaAdmin=await login('alpha-admin','AdminPass1');
    const alphaTeacher=await login('alpha-teacher','TeacherPass1');
    const alphaParent=await login('alpha-parent','ParentPass1');
    const bravoAdmin=await login('bravo-admin','BravoPass1');

    // 7. Origin/CSRF boundary: attacker origin rejected; same-origin accepted.
    const crossOrigin=await request('/api/term',{method:'POST',cookie:alphaAdmin,origin:'https://evil.example',body:{term:'Owned'}});
    assert.equal(crossOrigin.response.status,403);
    const sameOriginWrite=await request('/api/term',{method:'POST',cookie:alphaAdmin,origin:sameOrigin,body:{term:'Term 3'}});
    assert.equal(sameOriginWrite.response.status,200);

    // 8. Role escalation attempts.
    const roleAttacks=[
      ['/api/accounts','POST',{username:'evil',pin:'1234',name:'Evil',role:'admin',schoolName:'Alpha ECD'}],
      ['/api/subscription-billing','PUT',{baseMonthly:1}],
      ['/api/payments/reconcile','POST',{eventId:'evil',reference:'NOPE',status:'paid',amount:999}],
      ['/api/store/products','POST',{name:'Injected',price:1,stockQuantity:999}],
      ['/api/broadcasts','POST',{bcMessage:'Fake alert',bcPriority:'Urgent',location:{lat:-25.7,lng:28.2},radiusKm:10}],
      ['/api/school-deletion/execute','POST',{ticketId:'fake',confirmation:'DELETE SCHOOL'}]
    ];
    for(const [route,method,body] of roleAttacks){
      const result=await request(route,{method,cookie:alphaParent,origin:sameOrigin,body});
      assert.ok([403,404].includes(result.response.status),'parent privilege attack unexpectedly passed: '+route+' -> '+result.response.status);
    }

    // 9. Mass assignment / forged ownership attack on post.
    const forgedPost=await request('/api/posts',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{
      id:'attacker-id',audience:'Foundation',caption:'Normal update',schoolId:'school-bravo',schoolName:'Bravo School',createdBy:'bravo-admin',role:'admin',extra:{admin:true}
    }});
    assert.equal(forgedPost.response.status,200);
    assert.notEqual(forgedPost.data.post.id,'attacker-id');
    assert.equal(forgedPost.data.post.schoolId,'school-alpha');
    assert.equal(forgedPost.data.post.createdBy,'alpha-teacher');
    assert.equal(forgedPost.data.post.extra,undefined);
    assert.equal(forgedPost.data.post.role,undefined);

    // 10. Cross-tenant object deletion attack.
    const tenantDelete=await request('/api/posts/'+encodeURIComponent(forgedPost.data.post.id),{method:'DELETE',cookie:bravoAdmin,origin:sameOrigin});
    assert.equal(tenantDelete.response.status,404);

    // 11. Generic workspace mass assignment and storage-bloat fields are discarded.
    const moduleAttack=await request('/api/modules/operations',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{
      type:'Ratio check',details:'Owls: 2 staff / 12 children',recordedBy:'forged-admin',schoolId:'school-bravo',admin:true,nested:{payload:'x'.repeat(1000)}
    }});
    assert.equal(moduleAttack.response.status,200);
    assert.equal(moduleAttack.data.record.schoolId,'school-alpha');
    assert.equal(moduleAttack.data.record.admin,undefined);
    assert.equal(moduleAttack.data.record.nested,undefined);
    assert.equal(moduleAttack.data.record.details,'Owls: 2 staff / 12 children');

    // 12. Schedule and attendance ownership/status forging.
    const scheduleAttack=await request('/api/schedules',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{studentName:'Alpha Learner',dayOfWeek:'Monday',timeSlot:'08:00 - 09:00',activity:'Reading',schoolId:'school-bravo',id:'fake',admin:true}});
    assert.equal(scheduleAttack.response.status,200);
    assert.equal(scheduleAttack.data.item.schoolId,'school-alpha');
    assert.notEqual(scheduleAttack.data.item.id,'fake');
    assert.equal(scheduleAttack.data.item.admin,undefined);
    const badAttendance=await request('/api/attendance',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{studentName:'Alpha Learner',status:'ADMINISTRATOR',schoolId:'school-bravo'}});
    assert.equal(badAttendance.response.status,400);

    // 13. Media polyglot / forged MIME attack.
    const fakePng='data:image/png;base64,'+Buffer.from('<script>alert(1)</script>').toString('base64');
    const mediaAttack=await request('/api/posts',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{audience:'All',caption:'Photo',mediaUrl:fakePng}});
    assert.equal(mediaAttack.response.status,400);
    const svgAttack=await request('/api/worksheets',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{studentName:'Alpha Learner',title:'Evidence',grade:80,photoUrl:'data:image/svg+xml;base64,'+Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}});
    assert.equal(svgAttack.response.status,400);

    // 14. Stored HTML payload remains data; client render paths must escape it.
    const xssPayload='<img src=x onerror=alert(1)>';
    const stored=await request('/api/modules/operations',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{type:'Safety note',details:xssPayload}});
    assert.equal(stored.response.status,200);
    assert.equal(stored.data.record.details,xssPayload);
    const client=fs.readFileSync(path.join(root,'backup.js'),'utf8');
    assert.match(client,/escapeWorkspaceText\(record\.details\)/);

    // 15. Curriculum mapping cannot be crossed by a forged client.
    const badCurriculum=await request('/api/modules/curriculum',{method:'POST',cookie:alphaTeacher,origin:sameOrigin,body:{framework:'NCF Birth–4',area:'Mathematics',learnerName:'Alpha Learner',observation:'Forged mapping'}});
    assert.equal(badCurriculum.response.status,400);

    // 16. Account cannot be moved to another tenant or mass-assigned.
    const crossSchoolAccount=await request('/api/accounts',{method:'POST',cookie:alphaAdmin,origin:sameOrigin,body:{username:'new@example.com',pin:'12345',name:'New User',role:'teacher',schoolName:'Bravo School',admin:true}});
    assert.equal(crossSchoolAccount.response.status,403);

    // 17. Sensitive API responses must not be browser-cacheable.
    const privateResponse=await request('/api/registry',{cookie:alphaTeacher});
    assert.equal(privateResponse.response.status,200);
    assert.match(privateResponse.response.headers.get('cache-control')||'',/no-store/);

    // 18. Service worker must explicitly bypass API/auth/private files.
    const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
    assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
    assert.match(sw,/url\.pathname\.startsWith\('\/auth\/'\)/);
    assert.match(sw,/littlefeet\.db/);
    assert.doesNotMatch(sw,/cache\.put\([^\n]*api\//i);

    // 19. Source-level mass-assignment guard for direct request-body spreads.
    const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
    assert.doesNotMatch(server,/\.\.\.\s*req\.body/);
    assert.match(server,/camera=\(self\)/);
    assert.match(server,/boundedText/);

    // 20. Session cookie hardening in the test environment (Secure is production-only by design).
    const freshLogin=await request('/api/login',{method:'POST',body:{username:'alpha-principal',pin:'PrincipalPass1'}});
    const setCookie=freshLogin.response.headers.get('set-cookie')||'';
    assert.match(setCookie,/HttpOnly/i);
    assert.match(setCookie,/SameSite=Lax/i);
    assert.match(server,/secure:\s*isProduction/);

    console.log('Adversarial security regression test passed.');
  } catch(error) {
    console.error(error);
    process.exitCode=1;
  } finally {
    await stop();
    fs.rmSync(temp,{recursive:true,force:true});
  }
})();
