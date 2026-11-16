(() => {
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const shell = document.querySelector('.game-shell');
  const overlay = document.querySelector('#overlay');
  const title = document.querySelector('#overlayTitle');
  const copy = document.querySelector('#overlayCopy');
  const playBtn = document.querySelector('#playBtn');
  const distanceRead = document.querySelector('#distance');
  const coinRead = document.querySelector('#coins');
  const heartsRead = document.querySelector('#hearts');
  const progress = document.querySelector('#progress');
  const toast = document.querySelector('#toast');
  const hint = document.querySelector('#controlsHint');
  const TOTAL = 570;
  const roadHalf = 4.7;
  let W = 0, H = 0, dpr = 1, last = 0, soundOn = false, audioCtx = null;
  let mode = 'title', playerZ = 0, playerX = 0, targetLane = 1, jumpY = 0, jumpV = 0, airborne = false;
  let speed = 10.6, coins = 0, lives = 3, worldObjects = [], gaps = [], scenery = [], particles = [], shake = 0, toastTimer = 0, lastZ = 0;
  const laneX = [-2.5, 0, 2.5];
  const rand = (seed) => { let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const mix = (a, b, t) => a + (b - a) * t;

  function resize() {
    W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 1.6);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  function buildWorld() {
    worldObjects = []; gaps = []; scenery = [];
    // A generous ribbon of floating platforms, set pieces and recoverable star trails.
    let z = 29, index = 0;
    while (z < TOTAL - 18) {
      const r = rand(index + 11), lane = Math.floor(rand(index + 31) * 3);
      if (index % 6 === 4) {
        const gapLength = 5.1 + rand(index + 8) * 1.4;
        gaps.push({ start: z, end: z + gapLength });
        for (let k = 0; k < 5; k++) worldObjects.push({ type: 'coin', x: laneX[k % 3], z: z + .7 + k * .95, y: 1.25 + (k === 2 ? .26 : 0), taken: false, phase: rand(index + k) * 8 });
        z += gapLength + 13.5 + r * 5;
      } else {
        const type = index % 7 === 2 ? 'block' : index % 5 === 3 ? 'critter' : 'crate';
        worldObjects.push({ type, x: laneX[lane], z, y: type === 'block' ? 0 : 0, hit: false, seed: index });
        // A little readable reward route beside most hazards.
        const rewardLane = (lane + (rand(index + 76) > .5 ? 1 : 2)) % 3;
        for (let k = 0; k < 4; k++) worldObjects.push({ type: 'coin', x: laneX[rewardLane], z: z - 2.2 + k * 1.35, y: 1.05 + Math.sin(k / 3 * Math.PI) * .65, taken: false, phase: rand(index + k * 2) * 8 });
        if (index % 4 === 1) worldObjects.push({ type: 'block', x: laneX[(lane + 1) % 3], z: z + 4.3, y: 0, hit: false, seed: index + 10 });
        z += 17 + r * 9;
      }
      index++;
    }
    for (let i = 0; i < 72; i++) {
      const zz = i * 9 + 12;
      for (const side of [-1, 1]) {
        const x = side * (6.2 + rand(i * 2 + side + 25) * 7);
        scenery.push({ x, z: zz + rand(i * 2 + side + 88) * 5, type: i % 4 === 0 ? 'puff' : i % 3 === 0 ? 'spire' : 'tree', size: .7 + rand(i * 9 + side) * .9, color: Math.floor(rand(i + side * 13) * 4) });
      }
    }
  }
  buildWorld();

  function project(x, y, z) {
    const depth = z - playerZ;
    if (depth < 1.15) return null;
    const f = Math.min(W, H) * .88;
    const horizon = H * .405 + Math.sin(playerZ * 1.8) * (airborne ? 1.7 : .65) - jumpY * 20;
    const bob = mode === 'playing' && !airborne ? Math.sin(playerZ * 2.2) * 1.5 : 0;
    return { x: W * .5 + (x - playerX) * f / depth, y: horizon - (y - (1.55 + jumpY * .38)) * f / depth + bob, scale: f / depth, depth };
  }
  function path(points, fill, stroke, lineWidth=1) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }
  function polygon3(points, color, stroke) {
    const q = points.map(p => project(p[0], p[1], p[2])); if (q.some(p => !p)) return;
    path(q, color, stroke);
  }
  function box(x, y, z, w, h, d, colors, outline='#59483f') {
    const a=[x-w/2,y,z-d/2], b=[x+w/2,y,z-d/2], c=[x+w/2,y+h,z-d/2], e=[x-w/2,y+h,z-d/2];
    const f=[x-w/2,y,z+d/2], g=[x+w/2,y,z+d/2], hh=[x+w/2,y+h,z+d/2], ii=[x-w/2,y+h,z+d/2];
    // Back faces are deliberately painted first; the camera looks down +Z.
    polygon3([e,c,hh,ii], colors.top, outline);
    polygon3([b,g,hh,c], colors.right, outline);
    polygon3([a,b,c,e], colors.front, outline);
    polygon3([a,f,g,b], colors.left || colors.front, outline);
    polygon3([a,e,ii,f], colors.side || colors.left || colors.front, outline);
  }
  function drawSky(time) {
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,'#83cbdc'); grad.addColorStop(.48,'#c7e9d8'); grad.addColorStop(1,'#f2d89b');
    ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    const sunX=W*.77-playerX*4, sunY=H*.21;
    ctx.fillStyle='rgba(255,235,166,.18)';ctx.beginPath();ctx.arc(sunX,sunY,Math.min(W,H)*.14,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffe39a';ctx.beginPath();ctx.arc(sunX,sunY,Math.min(W,H)*.064,0,Math.PI*2);ctx.fill();
    // Layered distant cloudbanks and island silhouettes.
    const hz=H*.405;
    ctx.fillStyle='#a5d9d0'; ctx.beginPath();ctx.moveTo(0,hz+28);
    for(let x=0;x<=W+40;x+=40){const y=hz+31+Math.sin(x*.012+playerZ*.006)*15+Math.sin(x*.027)*7;ctx.lineTo(x,y);}ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
    ctx.fillStyle='#7db9a7';ctx.beginPath();ctx.moveTo(0,hz+54);
    for(let x=0;x<=W+20;x+=26){const y=hz+49+Math.sin(x*.009+1.5)*22+Math.sin(x*.024+2)*11;ctx.lineTo(x,y);}ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.fill();
    // Puffy sunlit clouds drift gently across the sky.
    for(let i=0;i<7;i++){
      const cx=((i*197-playerZ*2+time*.007)%(W+200)+W+200)%(W+200)-70, cy=H*(.12+(i%3)*.075), s=24+(i%3)*9;
      ctx.fillStyle='rgba(246,250,220,.72)';ctx.beginPath();ctx.ellipse(cx,cy,s*1.7,s*.42,0,0,Math.PI*2);ctx.ellipse(cx-s*.5,cy-s*.12,s*.62,s*.52,0,0,Math.PI*2);ctx.ellipse(cx+s*.15,cy-s*.28,s*.7,s*.65,0,0,Math.PI*2);ctx.ellipse(cx+s*.75,cy-s*.07,s*.46,s*.43,0,0,Math.PI*2);ctx.fill();
    }
  }
  function drawGround() {
    // Broad pastel void below the floating path.
    const hz=H*.405; const fade=ctx.createLinearGradient(0,hz,0,H);fade.addColorStop(0,'rgba(239,221,158,0)');fade.addColorStop(1,'#e5bf86');ctx.fillStyle=fade;ctx.fillRect(0,hz,W,H-hz);
    const start=Math.floor(playerZ/5)*5-5;
    for(let z=start+65;z>=start;z-=5){
      const z0=Math.max(z,playerZ+1.3), z1=z+5;
      const gap=gaps.find(g=>z>=g.start-4.9&&z<g.end);
      if(gap) continue;
      const alternate=(Math.floor(z/5)%2)===0;
      box(0,-.28,z+2.5,roadHalf*2,.36,5,{front:alternate?'#87a58b':'#789b86',right:'#62877e',left:'#95ae88',top:alternate?'#b7c893':'#adc18e',side:'#75977d'},'#617f73');
      // Small raised edge bands emphasize the floating road edges.
      box(-roadHalf+.08,.08,z+2.5,.16,.15,4.92,{front:'#e3c36f',right:'#c99d58',left:'#efd17a',top:'#f2d786',side:'#cba35e'},'#96784f');
      box(roadHalf-.08,.08,z+2.5,.16,.15,4.92,{front:'#e3c36f',right:'#c99d58',left:'#efd17a',top:'#f2d786',side:'#cba35e'},'#96784f');
      // Tile flecks and dashed center marks add scale.
      if(Math.floor(z/5)%2===0) box(0,.1,z+2.5,.08,.025,1.15,{front:'#e3d39a',right:'#c3ae7e',left:'#efe1ad',top:'#f2e3b2',side:'#c3ae7e'},'#baa77a');
    }
    // Dark blue undersides visible beneath the nearest edge.
    box(0,-1.25,playerZ+1.5,roadHalf*2,.72,3,{front:'#477884',right:'#365f6e',left:'#578a91',top:'#779b83',side:'#385f6d'},'#345965');
  }
  function drawScenery() {
    for(const o of scenery){
      if(o.z<playerZ+4||o.z>playerZ+105)continue;
      const depth=o.z-playerZ, s=o.size;
      if(o.type==='puff'){
        const p=project(o.x,1.2,o.z);if(!p)continue;
        const r=clamp(p.scale*s*1.4,1,55);
        ctx.fillStyle='rgba(247,249,222,.78)';ctx.beginPath();ctx.ellipse(p.x,p.y,r*1.7,r*.56,0,0,Math.PI*2);ctx.ellipse(p.x-r*.45,p.y-r*.22,r*.65,r*.62,0,0,Math.PI*2);ctx.ellipse(p.x+r*.3,p.y-r*.3,r*.72,r*.7,0,0,Math.PI*2);ctx.fill();
      } else if(o.type==='spire') {
        const colors=['#d98265','#e6b15d','#758d87','#bb7181']; const col=colors[o.color];
        box(o.x,0,o.z,s*.75,s*2.7,s*.75,{front:col,right:'#95635b',left:'#e6ae78',top:'#f4d184',side:'#996355'},'#755b50');
        box(o.x,.25,o.z,s*1.25,.25,s*1.25,{front:'#e9cf87',right:'#b48e63',left:'#f4e3a8',top:'#fff0bd',side:'#bb9567'},'#8d7058');
      } else {
        const trunk='#9a7253', leaves=['#5f9b74','#78aa78','#87ad69','#c57767'][o.color];
        box(o.x,0,o.z,s*.34,s*1.45,s*.34,{front:trunk,right:'#705a4c',left:'#ba8b5f',top:'#c2935f',side:'#705a4c'},'#735a4a');
        const p=project(o.x,2*s,o.z); if(!p)continue;
        const r=clamp(p.scale*s*.95,2,70);
        ctx.fillStyle='#426f64';ctx.beginPath();ctx.arc(p.x+2,p.y+3,r*1.02,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=leaves;ctx.beginPath();ctx.arc(p.x,p.y,r*.9,0,Math.PI*2);ctx.arc(p.x-r*.48,p.y+r*.18,r*.56,0,Math.PI*2);ctx.arc(p.x+r*.48,p.y+r*.18,r*.58,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='rgba(238,226,155,.55)';ctx.beginPath();ctx.arc(p.x-r*.24,p.y-r*.22,r*.24,0,Math.PI*2);ctx.fill();
      }
    }
  }
  function drawCoin(o,time) {
    const bob=Math.sin(time*.004+o.phase)*.12, p=project(o.x,o.y+bob,o.z);if(!p)return;
    const r=clamp(p.scale*.29,2.5,34), spin=.22+Math.abs(Math.sin(time*.006+o.phase))*.78;
    ctx.save();ctx.translate(p.x,p.y);ctx.scale(spin,1);
    ctx.fillStyle='rgba(79,67,48,.23)';ctx.beginPath();ctx.ellipse(2,r*1.35,r*.7,r*.22,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#b87336';ctx.beginPath();ctx.ellipse(0,0,r*.73,r,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#f7cd58';ctx.beginPath();ctx.ellipse(-r*.08,-r*.08,r*.58,r*.82,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff0a0';ctx.fillRect(-r*.3,-r*.55,Math.max(1,r*.14),r*.42);
    ctx.restore();
  }
  function drawBlock(o) {
    if(o.type==='crate'){
      box(o.x,.05,o.z,1.12,.96,.9,{front:'#d77855',right:'#a9584c',left:'#e8a65d',top:'#f2c774',side:'#9d5548'},'#704a43');
      // Cross braces on the face.
      const p1=project(o.x-.42,.17,o.z-.46),p2=project(o.x+.42,.88,o.z-.46),p3=project(o.x+.42,.17,o.z-.46),p4=project(o.x-.42,.88,o.z-.46);
      if(p1&&p2&&p3&&p4){ctx.strokeStyle='#f1c57b';ctx.lineWidth=Math.max(1,p1.scale*.07);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.moveTo(p3.x,p3.y);ctx.lineTo(p4.x,p4.y);ctx.stroke();}
    } else if(o.type==='block'){
      const lift=.12+Math.sin(performance.now()*.003+o.seed)*.08;
      box(o.x,.8+lift,o.z,1.25,.95,1.05,{front:'#e6ad4d',right:'#bd7942',left:'#f3ce68',top:'#ffdf77',side:'#b96d3c'},'#754b3d');
      const p=project(o.x,.8+lift+.48,o.z-.54);if(p){const s=clamp(p.scale,3,22);ctx.fillStyle='#80503b';ctx.font=`bold ${s}px Space Grotesk`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('✦',p.x,p.y);}
      box(o.x,.08,o.z,.98,.15,1,{front:'#a36b4c',right:'#895a49',left:'#be8556',top:'#cc9c5e',side:'#815345'},'#68483d');
    } else {
      // A tiny original puffball sentinel: no borrowed character silhouettes.
      const bob=Math.abs(Math.sin(performance.now()*.006+o.seed))* .08;
      box(o.x,.04+bob,o.z,.9,.77,.85,{front:'#db7b56',right:'#9b594c',left:'#efb164',top:'#f7ce73',side:'#985548'},'#754b43');
      const a=project(o.x-.19,.5+bob,o.z-.44),b=project(o.x+.19,.5+bob,o.z-.44);
      if(a&&b){for(const p of [a,b]){ctx.fillStyle='#fff5dc';ctx.beginPath();ctx.ellipse(p.x,p.y,Math.max(1,p.scale*.075),Math.max(1,p.scale*.11),0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#263c42';ctx.beginPath();ctx.arc(p.x,p.y,Math.max(1,p.scale*.035),0,Math.PI*2);ctx.fill();}}
    }
  }
  function drawGapWarnings(){
    for(const g of gaps){if(g.start<playerZ+2||g.start>playerZ+70)continue;
      for(const x of [-roadHalf+.3,roadHalf-.3]){
        const p=project(x,.18,g.start);if(!p)continue;const s=clamp(p.scale,1.4,26);
        ctx.fillStyle='#f1d071';ctx.fillRect(p.x-s*.22,p.y-s*.1,s*.44,s*.12);
      }
    }
  }
  function drawParticles(dt){
    particles=particles.filter(p=>p.life>0);
    for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=35*dt;p.life-=dt;ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}ctx.globalAlpha=1;
  }
  function render(time,dt){
    drawSky(time);drawGround();drawScenery();drawGapWarnings();
    const visible=worldObjects.filter(o=>!o.taken&&o.z>playerZ+1.3&&o.z<playerZ+90).sort((a,b)=>b.z-a.z);
    for(const o of visible){ if(o.type==='coin')drawCoin(o,time);else drawBlock(o); }
    if(mode==='playing') drawParticles(dt);
    if(shake>0){shake=Math.max(0,shake-dt*20);}
  }
  function showToast(text){toast.textContent=text;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),1050);}
  function chirp(freq=620,duration=.09){if(!soundOn)return;try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='triangle';osc.frequency.setValueAtTime(freq,audioCtx.currentTime);osc.frequency.exponentialRampToValueAtTime(freq*1.55,audioCtx.currentTime+duration);gain.gain.setValueAtTime(.055,audioCtx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);osc.connect(gain);gain.connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+duration);}catch(e){}}
  function burst(x,y,color){for(let i=0;i<9;i++)particles.push({x,y,vx:(Math.random()-.5)*140,vy:-30-Math.random()*100,life:.45+Math.random()*.35,max:.8,size:2+Math.random()*4,color});}
  function begin(){
    mode='playing';playerZ=0;playerX=0;targetLane=1;jumpY=0;jumpV=0;airborne=false;speed=10.6;coins=0;lives=3;shake=0;particles=[];buildWorld();
    shell.classList.add('playing');overlay.classList.add('hidden');hint.style.opacity='';
    updateHud();last=performance.now();
  }
  function finish(win){
    mode=win?'won':'over';shell.classList.remove('playing');overlay.classList.remove('hidden');
    title.innerHTML=win?'DU HAST DAS<br><em>TOR GEFUNDEN.</em>':'NOCH EINMAL<br><em>ABHEBEN?</em>';
    copy.textContent=win?`Das Wolkentor ist erreicht — und du hast ${coins} Sternfunken gesammelt. Die nächste Insel wartet schon.`:`Die Wolken waren schneller. Du hast ${coins} Sternfunken gesammelt — der Himmel wartet auf deinen nächsten Versuch.`;
    playBtn.querySelector('span').textContent=win?'NOCH EINE RUNDE':'NOCHMAL SPIELEN';
    document.querySelector('.title-badge b').textContent=win?'GATE CLEAR':'RETRY';
  }
  function updateHud(){distanceRead.textContent=String(Math.floor(playerZ)).padStart(3,'0');coinRead.textContent=String(coins).padStart(2,'0');heartsRead.textContent='♥ '.repeat(lives).trim()||'—';progress.style.width=`${Math.min(100,playerZ/TOTAL*100)}%`;}
  function hit(){
    lives--;shake=1.5;chirp(160,.22);showToast(lives?'AU! WEITERGEHT’S':'RUNDE VORBEI');
    if(lives<=0){finish(false);return;}
    playerZ+=4.2;jumpY=0;jumpV=0;airborne=false;targetLane=Math.round((playerX+2.5)/2.5);targetLane=clamp(targetLane,0,2);
    updateHud();
  }
  function action(name){
    if(mode!=='playing')return;
    if(name==='left')targetLane=Math.max(0,targetLane-1);
    if(name==='right')targetLane=Math.min(2,targetLane+1);
    if(name==='jump'&&!airborne){jumpV=8.6;airborne=true;chirp(390,.08);}
  }
  function tick(time){
    const dt=Math.min(.04,(time-last)/1000||0);last=time;
    if(mode==='playing'){
      speed=Math.min(13.5,10.6+playerZ*.0042);playerZ+=speed*dt;playerX=mix(playerX,laneX[targetLane],1-Math.exp(-dt*11));
      if(airborne){jumpY+=jumpV*dt;jumpV-=19.5*dt;if(jumpY<=0){jumpY=0;jumpV=0;airborne=false;}}
      // Collectible pickup and collision checks use the same lane geometry as the rendered course.
      for(const o of worldObjects){if(o.z<playerZ-1.6||o.z>playerZ+1.1)continue;
        if(o.type==='coin'&&!o.taken&&Math.abs(playerX-o.x)<1.15&&Math.abs(o.z-playerZ)<1.25){o.taken=true;coins++;chirp(740+coins%5*60,.075);const p=project(o.x,o.y,o.z);if(p)burst(p.x,p.y,'#ffe177');showToast('+1 STERNFUNKEN');}
        else if(o.type!=='coin'&&!o.hit&&Math.abs(o.z-playerZ)<.9&&Math.abs(playerX-o.x)<1.15){o.hit=true;if(jumpY<1.02)hit();else{chirp(480,.06);}}
      }
      const gap=gaps.find(g=>!g.hit&&playerZ>g.start+.1&&playerZ<g.end-.05);
      if(gap&&!airborne){gap.hit=true;hit();playerZ=gap.end+.7;}
      updateHud();
      if(playerZ>=TOTAL)finish(true);
    }
    render(time,dt);requestAnimationFrame(tick);
  }
  playBtn.addEventListener('click',()=>{if(mode==='paused')beginResume();else begin();});
  addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();if([' ','arrowleft','arrowright','arrowup','a','d','w'].includes(k))e.preventDefault();
    if(k===' '||k==='arrowup'||k==='w')action('jump');if(k==='arrowleft'||k==='a')action('left');if(k==='arrowright'||k==='d')action('right');
    if(k==='escape'&&mode==='playing'){mode='paused';shell.classList.remove('playing');overlay.classList.remove('hidden');title.innerHTML='KURZ<br><em>VERSCHNAUFEN.</em>';copy.textContent='Dein Lauf ist pausiert. Das Wolkentor läuft nicht weg.';playBtn.querySelector('span').textContent='WEITER';}
  });
  function beginResume(){mode='playing';shell.classList.add('playing');overlay.classList.add('hidden');last=performance.now();}
  document.querySelectorAll('.touch-btn').forEach(btn=>{const run=e=>{e.preventDefault();action(btn.dataset.action);};btn.addEventListener('pointerdown',run);btn.addEventListener('contextmenu',e=>e.preventDefault());});
  document.querySelector('#soundBtn').addEventListener('click',e=>{soundOn=!soundOn;e.currentTarget.innerHTML=soundOn?'♫ <span>TON AN</span>':'♫ <span>TON AUS</span>';if(soundOn)chirp(560,.08);});
  document.querySelector('#soundBtn').querySelector('span').textContent='TON AUS';
  requestAnimationFrame((t)=>{last=t;tick(t);});
})();
