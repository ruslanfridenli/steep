import * as THREE from 'three';

export const WORLD = { width: 2400, depth: 2240, startZ: -1120, endZ: 1120 };

const fract = (x) => x - Math.floor(x);
const hash = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);

export function terrainHeight(x, z) {
  const progress = (z - WORLD.startZ) / (WORLD.endZ - WORLD.startZ);
  const base = 475 - progress * 455;
  const broadBowl = 22 * Math.sin(z * 0.0032) * Math.cos(x * 0.0025);
  const ridges = 8 * Math.sin(x * 0.007 + z * 0.004) + 5 * Math.sin(z * 0.012 - x * 0.009);
  const peak = 125 * Math.exp(-((x - 470) ** 2 / 160000 + (z + 1040) ** 2 / 190000));
  const shoulder = 58 * Math.exp(-((x + 760) ** 2 / 190000 + (z + 510) ** 2 / 210000));
  const cliffBand = 18 * Math.sin(z * 0.021) * Math.exp(-((x + 520) ** 2 / 120000 + (z + 140) ** 2 / 190000));
  const lowerRoll = 13 * Math.sin(x * 0.009 + z * 0.006) * Math.sin(z * 0.004);
  return Math.max(4, base + broadBowl + ridges + peak + shoulder + cliffBand + lowerRoll);
}

export function terrainNormal(x, z) {
  const d = 2;
  const dx = (terrainHeight(x + d, z) - terrainHeight(x - d, z)) / (2 * d);
  const dz = (terrainHeight(x, z + d) - terrainHeight(x, z - d)) / (2 * d);
  return new THREE.Vector3(-dx, 1, -dz).normalize();
}

function createTerrain() {
  const cols = 190, rows = 200;
  const positions = [], colors = [], indices = [];
  const low = new THREE.Color('#8ba8aa'), snow = new THREE.Color('#e9f2f3'), shadow = new THREE.Color('#b7cbd0');
  for (let j = 0; j <= rows; j++) {
    const z = WORLD.startZ + WORLD.depth * j / rows;
    for (let i = 0; i <= cols; i++) {
      const x = -WORLD.width / 2 + WORLD.width * i / cols;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);
      const n = hash(i * 1.7, j * 2.3);
      const rock = y < 150 && n > .77;
      const c = rock ? low : (n > .58 ? shadow : snow);
      const altitudeFade = THREE.MathUtils.clamp((y - 10) / 400, .58, 1);
      colors.push(c.r * altitudeFade, c.g * altitudeFade, c.b * altitudeFade);
      if (i < cols && j < rows) {
        const a = j * (cols + 1) + i, b = a + cols + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .97, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

function createForest(group) {
  const pineGeo = new THREE.ConeGeometry(1, 1, 6);
  const trunkGeo = new THREE.CylinderGeometry(.13, .2, 1, 5);
  const pineMat = new THREE.MeshStandardMaterial({ color: '#30463f', roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#514d42', roughness: 1 });
  const trees = new THREE.InstancedMesh(pineGeo, pineMat, 1800);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 1800);
  const dummy = new THREE.Object3D();
  let count = 0;
  for (let i = 0; i < 1800; i++) {
    const x = (hash(i + 11, 4) - .5) * 2100;
    const z = -60 + hash(i + 201, 8) * 1100;
    const y = terrainHeight(x, z);
    if (y > 205 || Math.abs(x) < 70) continue;
    const scale = 5 + hash(i, 2) * 7;
    dummy.position.set(x, y + scale * .48, z); dummy.scale.set(scale * .55, scale, scale * .55);
    dummy.rotation.y = hash(i, 3) * Math.PI; dummy.updateMatrix(); trees.setMatrixAt(count, dummy.matrix);
    dummy.position.y = y + scale * .11; dummy.scale.set(scale * .09, scale * .22, scale * .09);
    dummy.updateMatrix(); trunks.setMatrixAt(count, dummy.matrix); count++;
  }
  trees.count = count; trunks.count = count; trees.castShadow = true; group.add(trees, trunks);
}

function createRocks(group) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: '#697b7d', roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(geo, mat, 210);
  const dummy = new THREE.Object3D(); let count = 0;
  for (let i = 0; i < 210; i++) {
    const x = (hash(i + 455, 19) - .5) * 2100;
    const z = -1200 + hash(i + 34, 52) * 1750;
    const y = terrainHeight(x, z);
    if (y < 110 || Math.abs(x) < 300) continue;
    const s = 3 + hash(i, 6) * 8;
    dummy.position.set(x, y + s * .32, z); dummy.scale.set(s * 1.3, s, s); dummy.rotation.set(hash(i, 1), hash(i, 2), hash(i, 3));
    dummy.updateMatrix(); rocks.setMatrixAt(count++, dummy.matrix);
  }
  rocks.count = count; rocks.castShadow = true; rocks.receiveShadow = true; group.add(rocks);
}

export function createRider(sport = 'board') {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const jacket = new THREE.Mesh(new THREE.CapsuleGeometry(.34, .82, 4, 8), new THREE.MeshStandardMaterial({ color: '#d8ef83', roughness: .78 }));
  jacket.position.y = 1.18; jacket.castShadow = true; body.add(jacket);
  const pants = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .45, 3, 7), new THREE.MeshStandardMaterial({ color: '#263846', roughness: .85 }));
  pants.position.set(0, .56, .02); body.add(pants);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.31, 12, 10), new THREE.MeshStandardMaterial({ color: '#ebf1ed', roughness: .38, metalness: .12 }));
  helmet.position.set(0, 1.88, -.08); helmet.scale.set(1, .9, 1.05); body.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.37, .1, .16), new THREE.MeshStandardMaterial({ color: '#83c7d0', metalness: .6, roughness: .18 }));
  visor.position.set(0, 1.87, .2); body.add(visor);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .55, 3, 6), jacket.material);
    arm.position.set(side * .42, 1.27, .03); arm.rotation.z = side * -.46; body.add(arm);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .47, 3, 6), pants.material);
    leg.position.set(side * .17, .37, .03); leg.rotation.z = side * -.11; body.add(leg);
  }
  const gearMat = new THREE.MeshStandardMaterial({ color: '#202e34', roughness: .5, metalness: .25 });
  const gear = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(.34, .085, 2.05), gearMat);
  gear.add(board); root.add(gear);
  const skiGear = new THREE.Group();
  for (const side of [-1, 1]) {
    const ski = new THREE.Mesh(new THREE.BoxGeometry(.11, .075, 2.35), gearMat);
    ski.position.x = side * .24; skiGear.add(ski);
  }
  root.add(skiGear);
  const wing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: '#ec754e', side: THREE.DoubleSide, roughness: .72 }));
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1.1,1.35,0, 0,.85,0, 1.1,1.35,0, -.62,.1,.02, .62,.1,.02],3));
  wingGeo.setIndex([0,1,3,1,2,4,1,4,3]); wingGeo.computeVertexNormals(); wing.geometry = wingGeo; wing.visible = false; body.add(wing);
  const chute = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 7, 0, Math.PI), new THREE.MeshStandardMaterial({ color: '#f5f2d9', side: THREE.DoubleSide }));
  chute.scale.set(1.8, .8, .7); chute.position.set(0, 3, -.25); chute.visible = false; root.add(chute);
  return { root, body, gear, skiGear, board, wing, chute };
}

export function createWorld(scene) {
  scene.background = new THREE.Color('#a9c5d0');
  scene.fog = new THREE.FogExp2('#c4d7dc', .00022);
  scene.add(createTerrain());
  const sun = new THREE.DirectionalLight('#fff2d6', 2.6);
  sun.position.set(-450, 850, -500); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -950; sun.shadow.camera.right = 950; sun.shadow.camera.top = 950; sun.shadow.camera.bottom = -950;
  sun.shadow.bias = -.00015; scene.add(sun);
  scene.add(new THREE.HemisphereLight('#d8efff', '#65776d', 1.35));
  const ambient = new THREE.Group();
  createForest(ambient); createRocks(ambient); scene.add(ambient);
  const markers = [];
  const gates = [
    { x: 90, z: -590, type: 'FREESTYLE', name: 'Ridge runner', color: '#d9ff91' },
    { x: -135, z: -125, type: 'RACE', name: 'The long way down', color: '#8fe8ff' },
    { x: 170, z: 390, type: 'WINGSUIT', name: 'Between the pines', color: '#ffb28e' },
    { x: -35, z: 780, type: 'FREESTYLE', name: 'Powder garden', color: '#d9ff91' },
  ];
  for (const [index, gate] of gates.entries()) {
    const y = terrainHeight(gate.x, gate.z) + 9;
    const group = new THREE.Group(); group.position.set(gate.x, y, gate.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, .22, 8, 48), new THREE.MeshBasicMaterial({ color: gate.color, transparent: true, opacity: .8 }));
    ring.castShadow = false; group.add(ring);
    const glow = new THREE.PointLight(gate.color, 18, 30); group.add(glow);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,9,6), new THREE.MeshBasicMaterial({ color: gate.color, transparent:true, opacity:.48 }));
    post.position.y = -4.5; group.add(post);
    scene.add(group); markers.push({ ...gate, group, ring, index });
  }
  const windGeo = new THREE.BufferGeometry();
  const windCount = 1000, windPositions = new Float32Array(windCount * 3);
  for (let i = 0; i < windCount; i++) {
    windPositions[i * 3] = (Math.random() - .5) * 1600;
    windPositions[i * 3 + 1] = Math.random() * 420;
    windPositions[i * 3 + 2] = (Math.random() - .5) * 1800;
  }
  windGeo.setAttribute('position', new THREE.BufferAttribute(windPositions, 3));
  const snow = new THREE.Points(windGeo, new THREE.PointsMaterial({ color:'#f7ffff', size:1.45, transparent:true, opacity:.55, depthWrite:false }));
  snow.visible = false; scene.add(snow);
  return { sun, markers, snow, windPositions, windCount };
}

export function makeTrail(scene) {
  const lines = [], trails = [[], []];
  for (let i = 0; i < 2; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    lines.push(geometry);
    scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color:'#fff', transparent:true, opacity:.36, depthWrite:false })));
  }
  function push(point, offset, heading = 0) {
    const side = offset < 0 ? 1 : 0, points = trails[side];
    points.push({
      x: point.x + Math.cos(heading) * offset,
      y: point.y + .08,
      z: point.z - Math.sin(heading) * offset,
    });
    if (points.length > 900) points.shift();
    const geometry = lines[side], attr = geometry.attributes.position;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], idx = (i - 1) * 6;
      attr.array.set([a.x,a.y,a.z,b.x,b.y,b.z], idx);
    }
    attr.needsUpdate = true; geometry.setDrawRange(0, Math.max(0, points.length - 1) * 2);
  }
  function clear() { for (const [index, points] of trails.entries()) { points.length = 0; lines[index].setDrawRange(0, 0); } }
  return { push, clear };
}

export function createParticles(scene) {
  const count = 220;
  const geometry = new THREE.BufferGeometry(), positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions.set([(Math.random()-.5)*8, Math.random()*4, (Math.random()-.5)*8], i*3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color:'#fff', size:2.4, transparent:true, opacity:.8, depthWrite:false }));
  scene.add(points);
  return { points, positions, count, geometry };
}
