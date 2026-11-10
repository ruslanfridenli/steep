import * as THREE from 'three';
import { terrainHeight, terrainNormal, WORLD } from './world.js';

export function createRiderState() {
  return {
    position: new THREE.Vector3(0, terrainHeight(0, WORLD.startZ) + .16, WORLD.startZ),
    velocity: new THREE.Vector3(),
    heading: 0, pitch: 0, roll: 0, airborne: false, jumpCharge: 0,
    spin: 0, flip: 0, trickScore: 0, combo: 0, gForce: 0, crashed: false,
    crashTimer: 0, sport: 'board', parachute: false, airtime: 0,
    lastGate: -1, gateCount: 0, score: 0, runTime: 0, fallDistance: 0,
  };
}

export function updateRider(state, input, dt, context) {
  const { getTerrain = terrainHeight } = context;
  const pos = state.position, vel = state.velocity;
  state.runTime += dt;
  if (state.crashed) {
    state.crashTimer -= dt;
    vel.multiplyScalar(Math.max(0, 1 - dt * 2.2));
    pos.addScaledVector(vel, dt);
    pos.y = Math.max(pos.y, getTerrain(pos.x, pos.z) + .3);
    if (state.crashTimer <= 0) { state.crashed = false; state.gForce = 0; state.combo = 0; state.trickScore = 0; }
    return { crashed: true, landed: false, jump: false };
  }
  const speed = vel.length();
  const normal = terrainNormal(pos.x, pos.z);
  const inAir = state.airborne;
  const steer = input.right - input.left;
  const acceleration = state.sport === 'ski' ? 22 : 17;
  const topSpeed = state.sport === 'ski' ? 62 : state.sport === 'wingsuit' ? 74 : 53;
  if (!inAir) {
    state.heading += steer * dt * (0.85 + Math.min(speed / 40, 1.2)) * (input.brake ? 1.45 : .9);
    const downhill = new THREE.Vector3(normal.x, 0, normal.z);
    const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    const slopePower = THREE.MathUtils.clamp((1 - normal.y) * 4.2, .22, 1.9);
    const tuck = input.tuck ? 1.55 : 1;
    vel.addScaledVector(forward, acceleration * slopePower * tuck * dt);
    vel.addScaledVector(downhill, 9.5 * dt);
    if (input.brake) vel.multiplyScalar(Math.max(.04, 1 - dt * (state.sport === 'ski' ? 1.7 : 2.2)));
    else vel.multiplyScalar(Math.max(.04, 1 - dt * .12));
    const forwardSpeed = vel.dot(forward);
    vel.addScaledVector(forward, THREE.MathUtils.clamp(forwardSpeed, -6, topSpeed) - forwardSpeed);
    state.pitch = THREE.MathUtils.damp(state.pitch, 0, 3, dt);
    state.roll = THREE.MathUtils.damp(state.roll, -steer * Math.min(speed / 32, .6), 7, dt);
    state.jumpCharge = input.jumpHeld ? Math.min(1, state.jumpCharge + dt * .9) : state.jumpCharge;
    if (input.jumpRelease && speed > 3) {
      const ramp = THREE.MathUtils.clamp(1 - normal.y, .15, .78);
      vel.y += 8 + state.jumpCharge * 12 + ramp * 8;
      state.airborne = true; state.airtime = 0; state.trickScore = 0; state.spin = 0; state.flip = 0;
      state.fallDistance = pos.y;
    }
    const turnAngle = Math.abs(steer) * Math.min(speed / 35, 1);
    state.gForce = THREE.MathUtils.damp(state.gForce, turnAngle * .55 + (input.brake ? .5 : 0), 2.5, dt);
    const drag = state.sport === 'ski' ? .018 : .028;
    const lateral = new THREE.Vector3(vel.x, 0, vel.z).dot(new THREE.Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading)));
    vel.x -= Math.cos(state.heading) * lateral * Math.min(1, dt * (input.brake ? 4 : 1.3));
    vel.z += Math.sin(state.heading) * lateral * Math.min(1, dt * (input.brake ? 4 : 1.3));
    vel.multiplyScalar(Math.max(.01, 1 - drag * dt));
  } else {
    state.airtime += dt;
    if (state.sport === 'wingsuit') {
      state.heading += steer * dt * 1.15;
      state.pitch = THREE.MathUtils.clamp(state.pitch + (input.forward - input.back) * dt * .9, -.9, .9);
      state.roll = THREE.MathUtils.damp(state.roll, -steer * .8, 3, dt);
      const forward = new THREE.Vector3(Math.sin(state.heading), Math.sin(state.pitch), Math.cos(state.heading));
      vel.lerp(forward.multiplyScalar(state.parachute ? 17 : 43), dt * (state.parachute ? 1.5 : .48));
      vel.y -= (state.parachute ? 7 : 2.2) * dt;
      if (input.deploy) state.parachute = !state.parachute;
    } else {
      state.spin += steer * dt * 2.5;
      state.flip += (input.forward - input.back) * dt * 2.3;
      state.pitch = state.flip;
      state.roll = -steer * .45;
      vel.y -= 9.8 * dt;
      const forward = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
      vel.addScaledVector(forward, -vel.dot(forward) * Math.min(1, dt * .28));
      if (input.grab) state.trickScore += dt * (state.sport === 'ski' ? 190 : 260);
    }
    state.trickScore += Math.abs(steer) * dt * 120 + Math.abs(input.forward - input.back) * dt * 110;
    state.gForce = THREE.MathUtils.damp(state.gForce, Math.max(0, -vel.y) * .035, 2, dt);
  }
  pos.addScaledVector(vel, dt);
  pos.x = THREE.MathUtils.clamp(pos.x, -WORLD.width / 2 + 20, WORLD.width / 2 - 20);
  const ground = getTerrain(pos.x, pos.z);
  if (state.airborne && pos.y <= ground + .16) {
    const landingSpeed = Math.abs(vel.y);
    const facing = new THREE.Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    const travel = new THREE.Vector3(vel.x, 0, vel.z).normalize();
    const alignment = Math.abs(facing.dot(travel));
    const impact = landingSpeed * (1.05 - alignment * .42) + Math.abs(state.spin % (Math.PI * 2)) * 1.2 + Math.abs(state.flip % (Math.PI * 2)) * .8;
    state.gForce = Math.max(state.gForce, impact / 5.8);
    state.airborne = false; state.parachute = false; pos.y = ground + .16;
    const clean = impact < 12 && alignment > .42;
    const earned = clean ? Math.round(state.trickScore * (1 + Math.abs(state.spin) / 4 + Math.abs(state.flip) / 5)) : 0;
    state.score += earned; state.combo = clean ? state.combo + earned : 0;
    state.trickScore = 0;
    if (impact > 24) { state.crashed = true; state.crashTimer = 2.6; vel.multiplyScalar(.28); }
    else vel.y = 0;
    return { crashed: state.crashed, landed: true, clean, earned, impact, jump: false };
  }
  if (!state.airborne) {
    pos.y = ground + .16;
    vel.y = 0;
  }
  const maxY = terrainHeight(pos.x, pos.z) + 1;
  state.airborne = state.airborne || pos.y > maxY + .85;
  return { crashed: false, landed: false, jump: false };
}
