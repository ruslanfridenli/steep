import * as THREE from 'three';
import './style.css';
import { createWorld, createRider, createParticles, makeTrail, terrainHeight, WORLD } from './world.js';
import { createRiderState, updateRider } from './physics.js';

const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(67, innerWidth / innerHeight, .1, 5200);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('canvas-root').appendChild(renderer.domElement);

const world = createWorld(scene);
const rider = createRider();
scene.add(rider.root);
const particles = createParticles(scene);
const tracks = makeTrail(scene);
const state = createRiderState();
const clock = new THREE.Clock();
const pressed = new Set();
const input = { left:0, right:0, forward:0, back:0, tuck:false, brake:false, jumpHeld:false, jumpRelease:false, grab:false, deploy:false };
const sports = {
  ski: { name:'SKIS', icon:'Ⅰ' },
  board: { name:'SNOWBOARD', icon:'Ⅱ' },
  wingsuit: { name:'WINGSUIT', icon:'Ⅲ' },
};
const weather = [
  { name:'BLUEBIRD · 12:40', bg:'#a9c5d0', fog:'#c4d7dc', fogDensity:.00022, sun:2.6, exposure:1.05 },
  { name:'GOLDEN HOUR · 18:20', bg:'#dfa987', fog:'#efd1b5', fogDensity:.00025, sun:2.1, exposure:1.13 },
  { name:'MOONLIGHT · 22:10', bg:'#1c2b43', fog:'#24374d', fogDensity:.0003, sun:.42, exposure:.85 },
  { name:'LIGHT SNOW · 14:05', bg:'#9aaeb8', fog:'#b9c9cd', fogDensity:.00042, sun:1.45, exposure:.92 },
];
let weatherIndex = 0, cameraMode = 0, started = false, mapOpen = false;
let rewindTime = 0, trailClock = 0, trickFlashTimer = 0, toastTimer = 0;
let audioContext = null, ambientGain = null, windGainNode = null, gateRunStart = 0, gateActive = 0;
let proximityClock = 0, speedShake = 0, scrapeTimer = 0;

const playerStart = { x: 0, z: WORLD.startZ + 60 };
function placeRider(x, z, clearRun = false) {
  state.position.set(x, terrainHeight(x,z) + .16, z);
  state.velocity.set(0,0,0); state.heading = 0; state.pitch = 0; state.roll = 0;
  state.airborne = false; state.jumpCharge = 0; state.spin = 0; state.flip = 0;
  state.crashed = false; state.crashTimer = 0; state.parachute = false; state.gForce = 0;
  if (clearRun) { state.combo = 0; state.trickScore = 0; tracks.clear(); gateActive = 0; gateRunStart = state.runTime; }
}
placeRider(playerStart.x, playerStart.z);

function initAudio() {
  if (audioContext) { if (audioContext.state === 'suspended') audioContext.resume(); return; }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  audioContext = new AudioCtx();
  ambientGain = audioContext.createGain();
  ambientGain.gain.value = .02;
  ambientGain.connect(audioContext.destination);
  for (const [frequency, level] of [[110,.18],[164.81,.1],[220,.07]]) {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.value = level;
    oscillator.connect(gain).connect(ambientGain); oscillator.start();
  }
  const noise = audioContext.createBufferSource(), buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const windFilter = audioContext.createBiquadFilter();
  windGainNode = audioContext.createGain();
  windFilter.type = 'lowpass'; windFilter.frequency.value = 380; windGainNode.gain.value = .018;
  noise.buffer = buffer; noise.loop = true; noise.connect(windFilter).connect(windGainNode).connect(audioContext.destination); noise.start();
}
function sound(freq = 460, duration = .12, type = 'sine') {
  if (!audioContext) return;
  const osc = audioContext.createOscillator(), gain = audioContext.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * .65), audioContext.currentTime + duration);
  gain.gain.setValueAtTime(.055, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
  osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + duration);
}
function snowScrape() {
  if (!audioContext) return;
  const source = audioContext.createBufferSource(), buffer = audioContext.createBuffer(1, audioContext.sampleRate * .1, audioContext.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i=0;i<samples.length;i++) samples[i]=(Math.random()*2-1)*(1-i/samples.length);
  const filter = audioContext.createBiquadFilter(), gain = audioContext.createGain();
  filter.type='bandpass';filter.frequency.value=1150;filter.Q.value=.55;
  gain.gain.value=.028;source.buffer=buffer;source.connect(filter).connect(gain).connect(audioContext.destination);source.start();
}
function toast(message, duration = 2.2) {
  $('toast').textContent = message; $('toast').classList.add('show'); toastTimer = duration;
}
function showTrick(message) {
  $('trick-pop').textContent = message; $('trick-pop').classList.add('show'); trickFlashTimer = 1.5;
}
function setSport(sport) {
  if (sport === 'wingsuit' && !state.airborne) { toast('WINGSUIT UNLOCKS IN THE AIR'); return; }
  if (state.sport === 'wingsuit' && !state.airborne) state.parachute = false;
  state.sport = sport; rider.wing.visible = sport === 'wingsuit'; rider.chute.visible = state.parachute;
  $('sport-name').textContent = sports[sport].name; $('sport-icon').textContent = sports[sport].icon;
  toast(`${sports[sport].name} EQUIPPED`, 1.3); sound(520, .08);
}
function setWeather(index) {
  weatherIndex = (index + weather.length) % weather.length;
  const preset = weather[weatherIndex];
  scene.background.set(preset.bg); scene.fog.color.set(preset.fog); scene.fog.density = preset.fogDensity;
  world.sun.intensity = preset.sun; renderer.toneMappingExposure = preset.exposure;
  world.snow.visible = weatherIndex === 3;
  $('weather-label').textContent = preset.name;
  if (ambientGain) ambientGain.gain.setTargetAtTime(weatherIndex === 2 ? .01 : .018, audioContext.currentTime, .35);
}
function startGame() {
  if (started) return;
  started = true; initAudio(); $('start-screen').classList.add('dismiss');
  setTimeout(() => { $('help-panel').classList.remove('hidden'); }, 700);
  toast('FIND YOUR LINE', 2.5);
}
function toggleMap() {
  mapOpen = !mapOpen; $('mountain-view').classList.toggle('hidden', !mapOpen);
  if (mapOpen) drawMap();
}
function drawMap() {
  const canvas = $('map-canvas'), ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h); ctx.fillStyle = '#29404a'; ctx.fillRect(0,0,w,h);
  const gradient = ctx.createLinearGradient(0,0,0,h);
  gradient.addColorStop(0,'#e1ebdf'); gradient.addColorStop(.52,'#b7c8bb'); gradient.addColorStop(1,'#476458');
  ctx.fillStyle = gradient; ctx.beginPath();
  for (let i=0;i<=w;i+=4) {
    const x = (i/w-.5)*WORLD.width;
    const z = WORLD.startZ + WORLD.depth*(.08 + .84*(.5 + .5*Math.sin(i*.012)*Math.cos(i*.003)));
    const y = h*(1-(z-WORLD.startZ)/WORLD.depth);
    if (i===0) ctx.moveTo(i,y); else ctx.lineTo(i,y);
  }
  ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=1;
  for (let i=0;i<8;i++){const y=35+i*48;ctx.beginPath();ctx.moveTo(20,y);ctx.bezierCurveTo(170,y-35,430,y+26,600,y-8);ctx.stroke();}
  const xy = (x,z) => [(x/WORLD.width+.5)*w, ((z-WORLD.startZ)/WORLD.depth)*h];
  for (const marker of world.markers) {
    const [x,y]=xy(marker.x,marker.z); ctx.strokeStyle=marker.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle=marker.color;ctx.font='10px monospace';ctx.fillText('◇',x+10,y+3);
  }
  const [px,py]=xy(state.position.x,state.position.z);
  ctx.fillStyle='#d9ff91';ctx.shadowColor='#d9ff91';ctx.shadowBlur=15;ctx.beginPath();ctx.arc(px,py,6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  canvas.onclick = (event) => {
    const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width*WORLD.width-WORLD.width/2;
    const z=WORLD.startZ+(event.clientY-rect.top)/rect.height*WORLD.depth;
    placeRider(THREE.MathUtils.clamp(x,-WORLD.width/2+40,WORLD.width/2-40),THREE.MathUtils.clamp(z,WORLD.startZ+30,WORLD.endZ-60),true);
    state.heading=0;mapOpen=false;$('mountain-view').classList.add('hidden');toast('DROP ZONE SELECTED');drawMap();
  };
}
function keyDown(event) {
  const key = event.key.toLowerCase();
  if ([' ','arrowup','arrowdown','arrowleft','arrowright','tab'].includes(key)) event.preventDefault();
  if (key === 'escape') {
    if(mapOpen) toggleMap();
    if(!$('help-panel').classList.contains('hidden')) $('help-panel').classList.add('hidden');
    $('radial').classList.add('hidden'); return;
  }
  if (key === 'tab') { $('radial').classList.remove('hidden'); return; }
  if (key === 'm') { toggleMap(); return; }
  if (key === 'c' || key === 'v') { cameraMode = (cameraMode+1)%2; toast(cameraMode?'GOPRO VIEW':'FOLLOW CAMERA',1.2); return; }
  if (key === 't') { setWeather(weatherIndex+1); return; }
  if (key === 'h') { $('help-panel').classList.toggle('hidden'); return; }
  if (key === '1') { setSport('ski'); return; }
  if (key === '2') { setSport('board'); return; }
  if (key === '3') { setSport('wingsuit'); return; }
  if (key === ' ' && !pressed.has(key)) {
    if (!started) startGame();
    if (state.sport === 'wingsuit' && state.airborne) input.deploy = true;
    else input.jumpHeld=true;
  }
  pressed.add(key);
}
function keyUp(event) {
  const key = event.key.toLowerCase();
  pressed.delete(key);
  if (key === ' ') { if (input.jumpHeld) input.jumpRelease=true; input.jumpHeld=false; }
  if (key === 'tab') $('radial').classList.add('hidden');
}
window.addEventListener('keydown',keyDown);
window.addEventListener('keyup',keyUp);
window.addEventListener('blur',()=>{pressed.clear();input.jumpHeld=false;input.jumpRelease=false;$('radial').classList.add('hidden');});
$('ride-button').addEventListener('click',startGame);
$('weather-button').addEventListener('click',()=>setWeather(weatherIndex+1));
$('help-close').addEventListener('click',()=>$('help-panel').classList.add('hidden'));
document.querySelectorAll('.radial-option').forEach(button=>button.addEventListener('click',()=>setSport(button.dataset.sport)));
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));});

function syncInput() {
  input.left = Number(pressed.has('a')||pressed.has('arrowleft'));
  input.right = Number(pressed.has('d')||pressed.has('arrowright'));
  input.forward = Number(pressed.has('w')||pressed.has('arrowup'));
  input.back = Number(pressed.has('s')||pressed.has('arrowdown'));
  input.tuck = input.forward > 0;
  input.brake = input.back > 0;
  input.grab = pressed.has('q')||pressed.has('e')||pressed.has('mouse0')||pressed.has('mouse2');
}
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('mousedown',e=>{if(e.button===0)pressed.add('mouse0');if(e.button===2)pressed.add('mouse2');});
window.addEventListener('mouseup',e=>{if(e.button===0)pressed.delete('mouse0');if(e.button===2)pressed.delete('mouse2');});

function updateGates(dt) {
  world.markers.forEach((marker,index)=>{
    marker.ring.rotation.z += dt*(index%2?-.4:.4);
    marker.group.position.y=terrainHeight(marker.x,marker.z)+9+Math.sin(state.runTime*1.3+index)*.45;
    const d=state.position.distanceTo(marker.group.position);
    if(d<10 && state.lastGate!==index){
      state.lastGate=index;state.gateCount++;gateActive=index;
      const elapsed=state.runTime-gateRunStart;gateRunStart=state.runTime;
      const points=marker.type==='FREESTYLE'?Math.max(500,state.combo):Math.max(350,Math.round(3500/(elapsed+1)));
      state.score+=points;
      $('challenge-type').textContent=marker.type; $('challenge-name').textContent=marker.name.toUpperCase();
      toast(`${marker.name.toUpperCase()}  +${points.toLocaleString()}`,2.6);
      showTrick(marker.type==='RACE'?'CHECKPOINT CLEARED':`${points.toLocaleString()} POINTS`);
      sound(680,.18,'triangle');
    }
    if(d>22 && state.lastGate===index)state.lastGate=-1;
  });
  if(state.sport==='wingsuit'&&state.airborne){
    const near=world.markers.some(m=>state.position.distanceTo(m.group.position)<23);
    const treesNear=Math.abs(state.position.x)>100&&state.position.z>-60&&state.position.z<1040&&state.position.y<terrainHeight(state.position.x,state.position.z)+30;
    if(near||treesNear){proximityClock+=dt;if(proximityClock>.3){state.score+=Math.round(dt*160);if(Math.random()<.03)showTrick('PROXIMITY +');}}
    else proximityClock=0;
  }else proximityClock=0;
}

function updatePlayerMesh(dt) {
  rider.root.position.copy(state.position);
  rider.root.rotation.set(0,state.heading,0);
  rider.body.rotation.set(state.sport==='wingsuit'?state.pitch:state.flip,state.sport==='wingsuit'?0:state.spin,state.roll);
  rider.gear.rotation.z=state.roll*.7;
  rider.gear.visible=state.sport!=='ski';
  rider.skiGear.visible=state.sport==='ski';
  rider.skiGear.rotation.z=state.roll*.7;
  rider.chute.visible=state.parachute;
  if(state.sport==='wingsuit')rider.root.rotation.x=-state.pitch*.6;
  const speed=state.velocity.length();
  const pos=state.position;
  if(windGainNode&&audioContext)windGainNode.gain.setTargetAtTime(.012+Math.min(speed/65,1)*.045,audioContext.currentTime,.25);
  if(!state.airborne&&speed>8&&(input.brake||Math.abs(input.right-input.left)>.8)&&scrapeTimer<=0){snowScrape();scrapeTimer=.34;}
  scrapeTimer=Math.max(0,scrapeTimer-dt);
  if(speed>4&&state.airborne===false&&Math.random()<.7){
    const p=particles.positions;
    const steer=input.right-input.left;
    for(let i=0;i<particles.count;i++){
      const n=i*3;
      if(p[n+1]<-.1){p[n]=(Math.random()-.5)*4;p[n+1]=Math.random()*1.8;p[n+2]=(Math.random()-.5)*4;}
      p[n+1]-=dt*(1.5+speed*.04);p[n]+=steer*dt*1.8;p[n+2]-=dt*(1+speed*.035);
    }
    particles.geometry.attributes.position.needsUpdate=true;
    particles.points.position.set(pos.x,pos.y-.2,pos.z);
    particles.points.visible=input.brake||Math.abs(steer)>.2;
  }else particles.points.visible=false;
  trailClock+=dt;
  if(trailClock>.055&&!state.airborne){trailClock=0;tracks.push(pos,.16,state.heading);tracks.push(pos,-.16,state.heading);}
  if(speed>48){speedShake=THREE.MathUtils.damp(speedShake,Math.random()*.025,5,dt);}else speedShake=THREE.MathUtils.damp(speedShake,0,4,dt);
}

function updateCamera(dt) {
  const speed=state.velocity.length();
  const forward=new THREE.Vector3(Math.sin(state.heading),0,Math.cos(state.heading));
  if(cameraMode===1){
    const eye=state.position.clone().add(new THREE.Vector3(0,1.55,0)).addScaledVector(forward,.25);
    camera.position.lerp(eye,.22);
    camera.lookAt(eye.clone().addScaledVector(forward,35).add(new THREE.Vector3(0,state.pitch*8,0)));
  }else{
    const behind=state.position.clone().addScaledVector(forward,-(10+speed*.13)).add(new THREE.Vector3(0,4.2+speed*.055,0));
    if(state.sport==='wingsuit'&&state.airborne)behind.y+=2;
    camera.position.lerp(behind,.08);
    camera.position.x+=(Math.random()-.5)*speedShake;camera.position.y+=(Math.random()-.5)*speedShake;
    camera.lookAt(state.position.clone().addScaledVector(forward,7).add(new THREE.Vector3(0,1.8,0)));
  }
  camera.fov=THREE.MathUtils.damp(camera.fov,67+Math.min(speed*.28,18),3,dt);camera.updateProjectionMatrix();
}
function updateSnow(dt) {
  const pos=world.windPositions;
  for(let i=0;i<world.windCount;i++){
    const k=i*3;pos[k]+=(.8+weatherIndex*.2)*dt;pos[k+1]-=(.5+weatherIndex*.8)*dt;
    if(pos[k]>850)pos[k]=-850;if(pos[k+1]<0)pos[k+1]=420;
  }
  world.snow.geometry.attributes.position.needsUpdate=true;
  world.snow.position.set(state.position.x,state.position.y-140,state.position.z);
}
function updateHud(result,dt) {
  const speed=state.velocity.length();
  $('speed').textContent=Math.round(speed*3.6).toString().padStart(2,'0');
  $('altitude').textContent=`${Math.max(0,Math.round(state.position.y*5.2)).toLocaleString()} M`;
  $('place-name').textContent=state.position.z < -700?'HIGH RIDGE':state.position.z < -200?'NORTH FACE':state.position.z<500?'THE BOWL':'PINE COUNTRY';
  $('combo-label').textContent=state.combo>0?'TRICK COMBO':state.airborne?'IN THE AIR':'READY WHEN YOU ARE';
  $('combo-score').textContent=state.combo>0?state.combo.toLocaleString():'';
  $('score-fill').style.width=`${Math.min(100,state.combo/35)}%`;
  $('impact-value').textContent=state.gForce.toFixed(1);
  $('impact-fill').style.width=`${Math.min(100,state.gForce*9)}%`;
  $('impact').classList.toggle('active',state.gForce>.35);
  $('compass-needle').style.transform=`rotate(${state.heading*180/Math.PI}deg)`;
  $('center-message').textContent=state.crashed?'WIPEOUT':'';
  $('center-message').classList.toggle('show',state.crashed);
  if(result.landed){
    if(result.crashed){showTrick('WIPEOUT · TAKE A BREATH');sound(120,.35,'sawtooth');}
    else if(result.earned>0){showTrick(`${result.clean?'CLEAN LANDING':'LANDING'}  +${result.earned.toLocaleString()}`);sound(430,.11);}
    else showTrick('LANDING · NO SCORE');
  }
  if(trickFlashTimer>0){trickFlashTimer-=dt;if(trickFlashTimer<=0)$('trick-pop').classList.remove('show');}
  if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('show');}
  const gate=world.markers[gateActive];
  if(gate){$('challenge-type').textContent=gate.type;$('challenge-name').textContent=gate.name.toUpperCase();}
}

function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.035);
  syncInput();
  if(!mapOpen&&started){
    if(pressed.has('r')){rewindTime+=dt;if(rewindTime>.9){placeRider(playerStart.x,playerStart.z,true);state.heading=0;rewindTime=0;toast('REWOUND TO THE RIDGE');}}
    else rewindTime=0;
    const previousZ=state.position.z;
    const result=updateRider(state,input,dt,{getTerrain:terrainHeight});
    input.jumpRelease=false;input.deploy=false;
    updateGates(dt);
    if(state.position.z>WORLD.endZ-30){placeRider(playerStart.x,playerStart.z,true);toast('THE MOUNTAIN IS YOURS. AGAIN.');}
    if(previousZ<state.position.z&&state.position.z<-700)$('region').textContent='THE NORTH FACE';
    else if(state.position.z>-700&&state.position.z<400)$('region').textContent='THE HIGH BOWL';
    else if(state.position.z>=400)$('region').textContent='PINE COUNTRY';
    updatePlayerMesh(dt);updateCamera(dt);updateHud(result,dt);updateSnow(dt);
  }
  if(!started)updateCamera(dt);
  renderer.render(scene,camera);
}
setWeather(0);
updatePlayerMesh(0);
updateCamera(0);
animate();
