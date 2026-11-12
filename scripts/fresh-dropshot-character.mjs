import fs from 'node:fs/promises';
import * as T from 'three';

// The supplied video is 7.20 seconds at 30 fps. The BVH is 225 samples at
// 30 fps, so the exporter resamples the real mocap into the video's timebase.
export const DANCE_DURATION = 7.2;
export const OUTPUT_FPS = 30;
const DEG = Math.PI / 180;
const BVH_ROOT_SCALE = 0.0048;

const COLORS = {
  scoop: '#fffaf1',
  limb: '#f5eee5',
  purple: '#5a51a0',
  steam: '#8e80ca',
  ear: '#ded9ef',
  cone: '#eabc72',
  waffle: '#d9ad69',
};

function transformedGeometry(geometry, position, scale = [1, 1, 1], quaternion = new T.Quaternion()) {
  const transform = new T.Matrix4().compose(
    new T.Vector3(...position),
    quaternion,
    new T.Vector3(...scale),
  );
  geometry.applyMatrix4(transform);
  return geometry;
}

function makeTubeGeometry(points, radius, tubularSegments = 24) {
  const curve = new T.CatmullRomCurve3(points.map(([x, y, z]) => new T.Vector3(x, y, z)));
  return new T.TubeGeometry(curve, tubularSegments, radius, 12, false);
}

function makeCapsuleGeometry(a, b, radius) {
  const start = new T.Vector3(...a);
  const end = new T.Vector3(...b);
  const direction = end.clone().sub(start);
  const length = Math.max(0.05, direction.length() - radius * 0.40);
  const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize());
  return transformedGeometry(
    new T.CapsuleGeometry(radius, length, 8, 20),
    start.clone().add(end).multiplyScalar(0.5).toArray(),
    [1, 1, 1],
    rotation,
  );
}

function setShadow(object) {
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function parseBvhText(text) {
  const lines = text.split(/\r?\n/);
  const motionStart = lines.findIndex((line) => line.trim() === 'MOTION');
  if (motionStart < 0) throw new Error('BVH MOTION section is missing');

  const nodes = [];
  const stack = [];
  let channelCount = 0;
  const currentJoint = () => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (!stack[index].endSite) return stack[index];
    }
    return null;
  };

  for (let index = 0; index < motionStart; index += 1) {
    const line = lines[index];
    const joint = line.match(/^\s*(ROOT|JOINT)\s+(\S+)/);
    if (joint) {
      const node = {name: joint[2], offset: [0, 0, 0], channels: [], children: [], channelOffset: channelCount};
      const parent = currentJoint();
      if (parent) parent.children.push(node);
      nodes.push(node);
      stack.push(node);
      continue;
    }
    if (/^\s*End Site/.test(line)) {
      stack.push({endSite: true});
      continue;
    }
    const offset = line.match(/^\s*OFFSET\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/);
    if (offset) {
      const node = currentJoint();
      if (node) node.offset = offset.slice(1).map(Number);
      continue;
    }
    const channels = line.match(/^\s*CHANNELS\s+(\d+)\s+(.+)/);
    if (channels) {
      const node = currentJoint();
      if (!node) continue;
      node.channels = channels[2].trim().split(/\s+/).slice(0, Number(channels[1]));
      node.channelOffset = channelCount;
      channelCount += node.channels.length;
      continue;
    }
    if (line.trim() === '}') stack.pop();
  }

  const framesLine = lines.findIndex((line, index) => index > motionStart && /^Frames:\s+\d+/.test(line.trim()));
  const timeLine = lines.findIndex((line, index) => index > motionStart && /^Frame Time:\s+/.test(line.trim()));
  if (framesLine < 0 || timeLine < 0) throw new Error('BVH frame metadata is missing');
  const frameCount = Number(lines[framesLine].match(/Frames:\s+(\d+)/)[1]);
  const frameTime = Number(lines[timeLine].match(/Frame Time:\s+([-+\d.eE]+)/)[1]);
  const motionValues = lines.slice(timeLine + 1).join(' ').trim().split(/\s+/).filter(Boolean).map(Number);
  const expected = frameCount * channelCount;
  if (motionValues.length < expected) throw new Error(`BVH motion is incomplete: ${motionValues.length}/${expected}`);

  const frames = Array.from({length: frameCount}, (_, frameIndex) => {
    const frame = new Map();
    for (const node of nodes) {
      const values = {};
      node.channels.forEach((channel, channelIndex) => {
        values[channel] = motionValues[frameIndex * channelCount + node.channelOffset + channelIndex];
      });
      frame.set(node.name, values);
    }
    return frame;
  });

  function value(frame, nodeName, channel) {
    return frame.get(nodeName)?.[channel] ?? 0;
  }

  function sample(timeSeconds) {
    // The source BVH is mapped over the exact 7.2-second video interval.
    const phase = ((timeSeconds % DANCE_DURATION) + DANCE_DURATION) % DANCE_DURATION;
    const position = (phase / DANCE_DURATION) * frameCount;
    const firstIndex = Math.floor(position) % frameCount;
    const nextIndex = (firstIndex + 1) % frameCount;
    const alpha = position - Math.floor(position);
    const first = frames[firstIndex];
    const next = frames[nextIndex];
    const sampleValue = (nodeName, channel) => T.MathUtils.lerp(
      value(first, nodeName, channel),
      value(next, nodeName, channel),
      alpha,
    );
    return {sampleValue};
  }

  return {nodes, frames, frameCount, frameTime, sourceDuration: frameCount * frameTime, sample};
}

export async function loadBvh(filePath) {
  return parseBvhText(await fs.readFile(filePath, 'utf8'));
}

function bvhEuler(sample, nodeName) {
  return new T.Euler(
    sample.sampleValue(nodeName, 'Xrotation') * DEG,
    sample.sampleValue(nodeName, 'Yrotation') * DEG,
    sample.sampleValue(nodeName, 'Zrotation') * DEG,
    'ZXY',
  );
}

function buildSourceSkeleton(bvh) {
  const group = new T.Group();
  group.name = 'source-bvh-rig-hidden';
  group.visible = false;
  const bones = new Map();
  const build = (node) => {
    const bone = new T.Bone();
    bone.name = `source-${node.name}`;
    bone.position.set(...node.offset);
    bone.rotation.order = 'ZXY';
    bones.set(node.name, bone);
    node.children.forEach((child) => bone.add(build(child)));
    return bone;
  };
  const root = build(bvh.nodes[0]);
  group.add(root);
  return {group, bones, root};
}

function createTargetSkeleton() {
  const group = new T.Group();
  group.name = 'dropshot-rig';

  const bone = (name, position, parent) => {
    const value = new T.Bone();
    value.name = name;
    value.position.set(...position);
    value.rotation.order = 'ZXY';
    parent.add(value);
    return value;
  };

  const root = new T.Bone();
  root.name = 'root-bone';
  root.position.set(0, 1.65, 0);
  root.rotation.order = 'ZXY';
  group.add(root);

  const spine = bone('spine-bone', [0, 0.43, 0], root);
  const spineUpper = bone('spine-upper-bone', [0, 0.30, 0], spine);
  const neck = bone('neck-bone', [0, 0.30, 0], spineUpper);
  const head = bone('head-bone', [0, 0.18, 0], neck);
  // Bind the shoulder pivots to the actual arm attachment points. The old
  // offset put the pivot above the visible arm by ~0.4 units, so retargeted
  // rotations made the arm orbit away from the scoop instead of hinging at it.
  const leftShoulder = bone('left-upper-arm-bone', [-0.72, 0, 0], spineUpper);
  const leftElbow = bone('left-forearm-bone', [-0.27, -0.12, 0], leftShoulder);
  const leftHand = bone('left-hand-bone', [-0.24, 0.03, 0], leftElbow);
  const rightShoulder = bone('right-upper-arm-bone', [0.72, 0, 0], spineUpper);
  const rightElbow = bone('right-forearm-bone', [0.27, -0.12, 0], rightShoulder);
  const rightHand = bone('right-hand-bone', [0.24, 0.03, 0], rightElbow);
  const leftHip = bone('left-thigh-bone', [-0.34, -0.43, 0], root);
  const leftKnee = bone('left-shin-bone', [0, -0.42, 0], leftHip);
  const leftAnkle = bone('left-ankle-bone', [0, -0.39, 0], leftKnee);
  const leftToe = bone('left-toe-bone', [0, -0.14, 0.12], leftAnkle);
  const rightHip = bone('right-thigh-bone', [0.34, -0.43, 0], root);
  const rightKnee = bone('right-shin-bone', [0, -0.42, 0], rightHip);
  const rightAnkle = bone('right-ankle-bone', [0, -0.39, 0], rightKnee);
  const rightToe = bone('right-toe-bone', [0, -0.14, 0.12], rightAnkle);

  const bones = [
    root, spine, spineUpper, neck, head,
    leftShoulder, leftElbow, leftHand, rightShoulder, rightElbow, rightHand,
    leftHip, leftKnee, leftAnkle, leftToe, rightHip, rightKnee, rightAnkle, rightToe,
  ];
  group.updateMatrixWorld(true);
  const skeleton = new T.Skeleton(bones);
  skeleton.calculateInverses();
  const bindPositions = new Map(bones.map((item) => [item.name, item.position.clone()]));
  const restDirections = new Map(
    bones
      .map((item) => [item.name, item.children.find((child) => child.isBone)])
      .filter(([, child]) => child)
      .map(([name, child]) => [name, child.position.clone().normalize()]),
  );
  return {
    group,
    root,
    spine,
    spineUpper,
    neck,
    head,
    leftShoulder,
    leftElbow,
    leftHand,
    rightShoulder,
    rightElbow,
    rightHand,
    leftHip,
    leftKnee,
    leftAnkle,
    leftToe,
    rightHip,
    rightKnee,
    rightAnkle,
    rightToe,
    bones,
    skeleton,
    bindPositions,
    restDirections,
  };
}

function addSkinned(root, skeleton, boneIndex, geometry, material, name) {
  const count = geometry.getAttribute('position').count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    indices[index * 4] = boneIndex;
    weights[index * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
  const object = setShadow(new T.SkinnedMesh(geometry, material));
  object.name = name;
  if (/glasses|eyelid|stem|bridge|nose|smile|tooth|ear|steam|waffle/.test(name)) object.castShadow = false;
  object.bind(skeleton, new T.Matrix4());
  root.add(object);
  return object;
}

function addScoopAndFace(root, skeleton, rig, materials) {
  const {scoop, purple, ear, steam} = materials;
  const headIndex = rig.bones.indexOf(rig.head);
  const rootIndex = rig.bones.indexOf(rig.root);

  const scoopGeometry = new T.SphereGeometry(1, 72, 48);
  const scoopPosition = scoopGeometry.getAttribute('position');
  for (let index = 0; index < scoopPosition.count; index += 1) {
    const y = scoopPosition.getY(index);
    const lower = Math.max(0, -y);
    scoopPosition.setX(index, scoopPosition.getX(index) * (1 + lower * 0.08));
    scoopPosition.setY(index, scoopPosition.getY(index) * 0.93 + lower * 0.02);
    scoopPosition.setZ(index, scoopPosition.getZ(index) * (1 + lower * 0.025));
  }
  scoopGeometry.computeVertexNormals();
  addSkinned(root, skeleton, headIndex, transformedGeometry(scoopGeometry, [0, 2.86, 0], [1.18, 0.93, 0.99]), scoop, 'scoop-shell');

  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    addSkinned(root, skeleton, headIndex, transformedGeometry(new T.TorusGeometry(0.205, 0.045, 12, 48), [side * 0.78, 3.58, 0.05]), purple, `${label}-ear-outer`);
    addSkinned(root, skeleton, headIndex, transformedGeometry(new T.CircleGeometry(0.165, 40), [side * 0.78, 3.58, 0.10]), scoop, `${label}-ear-inner`);
    addSkinned(root, skeleton, headIndex, transformedGeometry(new T.CircleGeometry(0.083, 32), [side * 0.78, 3.58, 0.108]), ear, `${label}-ear-center`);

    const glasses = new T.TorusGeometry(0.245, 0.034, 12, 64);
    addSkinned(root, skeleton, headIndex, transformedGeometry(glasses, [side * 0.34, 3.03, 0.99], [1.22, 0.72, 1]), purple, `${label}-glasses-rim`);
    const waveX = [-0.18, -0.09, 0.02, 0.12, 0.18];
    const waveY = side < 0 ? [0.03, 0.08, 0.035, 0.01, 0.075] : [0.075, 0.03, 0.075, 0.035, 0.01];
    addSkinned(
      root,
      skeleton,
      headIndex,
      makeTubeGeometry(waveX.map((x, index) => [side * x + side * 0.34, 3.03 + waveY[index], 1.035]), 0.032, 24),
      purple,
      `${label}-eyelid-line`,
    );
    addSkinned(
      root,
      skeleton,
      headIndex,
      makeTubeGeometry(side < 0 ? [[-0.57, 3.07, 1.025], [-0.68, 3.05, 1.025]] : [[0.57, 3.07, 1.025], [0.68, 3.05, 1.025]], 0.028, 12),
      purple,
      `${label}-glasses-stem`,
    );
  }

  addSkinned(root, skeleton, headIndex, makeTubeGeometry([[-0.12, 3.05, 1.03], [0, 3.06, 1.05], [0.12, 3.05, 1.03]], 0.032, 20), purple, 'glasses-bridge');
  addSkinned(root, skeleton, headIndex, transformedGeometry(new T.SphereGeometry(0.06, 24, 16), [0, 2.84, 1.045], [1, 0.82, 0.65]), purple, 'nose');
  addSkinned(root, skeleton, headIndex, makeTubeGeometry([[0, 2.89, 1.055], [0, 2.82, 1.055], [-0.045, 2.79, 1.055]], 0.026, 12), purple, 'nose-left');
  addSkinned(root, skeleton, headIndex, makeTubeGeometry([[0, 2.82, 1.055], [0.045, 2.79, 1.055]], 0.026, 12), purple, 'nose-right');
  addSkinned(root, skeleton, headIndex, makeTubeGeometry([[-0.12, 2.74, 1.045], [-0.12, 2.60, 1.045], [0, 2.57, 1.045], [0.12, 2.60, 1.045], [0.12, 2.74, 1.045]], 0.030, 24), purple, 'smile-outline');
  addSkinned(root, skeleton, headIndex, transformedGeometry(new T.BoxGeometry(0.062, 0.12, 0.026), [-0.048, 2.685, 1.06]), scoop, 'left-tooth');
  addSkinned(root, skeleton, headIndex, transformedGeometry(new T.BoxGeometry(0.062, 0.12, 0.026), [0.048, 2.685, 1.06]), scoop, 'right-tooth');

  const steamWaves = [
    [[-0.32, 3.87, 0.02], [-0.40, 4.02, 0.02], [-0.31, 4.16, 0.02], [-0.38, 4.30, 0.02]],
    [[0, 3.93, 0.02], [-0.07, 4.07, 0.02], [0.02, 4.22, 0.02], [-0.04, 4.38, 0.02]],
    [[0.31, 3.85, 0.02], [0.24, 3.99, 0.02], [0.34, 4.14, 0.02], [0.28, 4.28, 0.02]],
  ];
  steamWaves.forEach((points, index) => addSkinned(root, skeleton, headIndex, makeTubeGeometry(points, 0.045, 24), steam, `steam-wave-${index}`));

  return {headIndex, rootIndex};
}

function coneSurface(u, y) {
  const bottom = 0.45;
  const top = 2.12;
  const radius = 0.72 * T.MathUtils.clamp((y - bottom) / (top - bottom), 0.035, 1);
  const x = T.MathUtils.clamp(u * radius, -radius * 0.92, radius * 0.92);
  const z = Math.sqrt(Math.max(0.0001, radius * radius - x * x));
  return [x, y, z + 0.014];
}

function addCone(root, skeleton, rig, materials) {
  const rootIndex = rig.bones.indexOf(rig.root);
  const coneFlip = new T.Quaternion().setFromEuler(new T.Euler(Math.PI, 0, 0));
  addSkinned(root, skeleton, rootIndex, transformedGeometry(new T.ConeGeometry(0.72, 1.67, 64, 32), [0, 1.285, 0], [1, 1, 1], coneFlip), materials.cone, 'waffle-cone-surface');
  const addTube = (points, radius, name) => addSkinned(root, skeleton, rootIndex, makeTubeGeometry(points, radius, 28), materials.waffle, name);
  [-0.66, -0.43, -0.20, 0.03, 0.26, 0.49, 0.68].forEach((y, row) => addTube(Array.from({length: 25}, (_, index) => coneSurface(-0.88 + (index / 24) * 1.76, y)), 0.010, `waffle-row-${row}`));
  for (const direction of [-1, 1]) {
    for (let line = -5; line <= 5; line += 1) {
      const points = [];
      for (let index = 0; index <= 32; index += 1) {
        const y = 0.48 + (index / 32) * 1.30;
        const progress = (y - 0.48) / 1.30;
        const u = line * 0.22 + direction * (progress - 0.5) * 1.08;
        if (Math.abs(u) <= 0.90) points.push(coneSurface(u, y));
      }
      if (points.length >= 3) addTube(points, 0.009, `waffle-diagonal-${direction < 0 ? 'down' : 'up'}-${line}`);
    }
  }
}

function addLimbs(root, skeleton, rig, materials) {
  const index = (bone) => rig.bones.indexOf(bone);
  const add = (a, b, radius, bone, material, name) => addSkinned(root, skeleton, index(bone), makeCapsuleGeometry(a, b, radius), material, name);
  const addEllipsoid = (position, scale, bone, material, name) => addSkinned(root, skeleton, index(bone), transformedGeometry(new T.SphereGeometry(1, 32, 24), position, scale), material, name);
  const feet = {};

  addEllipsoid([-0.72, 2.38, 0.02], [0.22, 0.18, 0.20], rig.spineUpper, materials.limb, 'left-shoulder-bridge');
  add([-0.72, 2.38, 0.02], [-0.99, 2.26, 0.02], 0.15, rig.leftShoulder, materials.limb, 'left-upper-arm-mesh');
  add([-0.99, 2.26, 0.02], [-1.21, 2.29, 0.03], 0.16, rig.leftElbow, materials.limb, 'left-forearm-mesh');
  addEllipsoid([-0.99, 2.26, 0.04], [0.17, 0.17, 0.18], rig.leftElbow, materials.limb, 'left-elbow-joint');
  addEllipsoid([-1.26, 2.30, 0.04], [0.18, 0.15, 0.19], rig.leftHand, materials.limb, 'left-hand-mesh');
  addEllipsoid([0.72, 2.38, 0.02], [0.22, 0.18, 0.20], rig.spineUpper, materials.limb, 'right-shoulder-bridge');
  add([0.72, 2.38, 0.02], [0.99, 2.26, 0.02], 0.15, rig.rightShoulder, materials.limb, 'right-upper-arm-mesh');
  add([0.99, 2.26, 0.02], [1.21, 2.29, 0.03], 0.16, rig.rightElbow, materials.limb, 'right-forearm-mesh');
  addEllipsoid([0.99, 2.26, 0.04], [0.17, 0.17, 0.18], rig.rightElbow, materials.limb, 'right-elbow-joint');
  addEllipsoid([1.26, 2.30, 0.04], [0.18, 0.15, 0.19], rig.rightHand, materials.limb, 'right-hand-mesh');

  add([-0.34, 1.22, 0.12], [-0.34, 0.80, 0.13], 0.17, rig.leftHip, materials.limb, 'left-thigh-mesh');
  add([-0.34, 0.80, 0.13], [-0.34, 0.41, 0.14], 0.17, rig.leftKnee, materials.limb, 'left-shin-mesh');
  feet.left = addEllipsoid([-0.34, 0.14, 0.20], [0.26, 0.15, 0.38], rig.leftAnkle, materials.limb, 'left-foot-mesh');
  add([0.34, 1.22, 0.12], [0.34, 0.80, 0.13], 0.17, rig.rightHip, materials.limb, 'right-thigh-mesh');
  add([0.34, 0.80, 0.13], [0.34, 0.41, 0.14], 0.17, rig.rightKnee, materials.limb, 'right-shin-mesh');
  feet.right = addEllipsoid([0.34, 0.14, 0.20], [0.26, 0.15, 0.38], rig.rightAnkle, materials.limb, 'right-foot-mesh');
  return feet;
}

function relativeQuaternion(current, base) {
  return base.clone().invert().multiply(current);
}

function mirroredQuaternion(quaternion) {
  const euler = new T.Euler().setFromQuaternion(quaternion, 'ZXY');
  return new T.Quaternion().setFromEuler(new T.Euler(euler.x, -euler.y, -euler.z, 'ZXY'));
}

function mirroredRelativeQuaternion(current, base) {
  return relativeQuaternion(mirroredQuaternion(current), mirroredQuaternion(base));
}

function applySourceMotion(source, bvh, timeSeconds) {
  const sample = bvh.sample(timeSeconds);
  for (const node of bvh.nodes) {
    const bone = source.bones.get(node.name);
    if (!bone) continue;
    bone.rotation.copy(bvhEuler(sample, node.name));
    if (node === bvh.nodes[0]) {
      const base = bvh.sample(0);
      bone.position.set(
        (sample.sampleValue(node.name, 'Xposition') - base.sampleValue(node.name, 'Xposition')),
        (sample.sampleValue(node.name, 'Yposition') - base.sampleValue(node.name, 'Yposition')),
        (sample.sampleValue(node.name, 'Zposition') - base.sampleValue(node.name, 'Zposition')),
      );
    }
  }
  source.group.updateMatrixWorld(true);
  return sample;
}

function worldDirection(bones, fromName, toName) {
  const from = new T.Vector3();
  const to = new T.Vector3();
  bones.get(fromName).getWorldPosition(from);
  bones.get(toName).getWorldPosition(to);
  return to.sub(from).normalize();
}

function orientTargetBone(targetBone, direction, restDirections) {
  const child = targetBone.children.find((item) => item.isBone);
  if (!child) return;
  const rest = (restDirections?.get(targetBone.name) ?? child.position.clone().normalize()).clone();
  const parentQuaternion = new T.Quaternion();
  targetBone.parent.getWorldQuaternion(parentQuaternion).invert();
  const localDirection = direction.clone().applyQuaternion(parentQuaternion).normalize();
  targetBone.quaternion.setFromUnitVectors(rest, localDirection);
}

function amplifiedElbowDirection(upperDirection, forearmDirection, side) {
  const axis = new T.Vector3().crossVectors(upperDirection, forearmDirection);
  const preferredAxis = new T.Vector3(0, 0, side < 0 ? 1 : -1);
  if (axis.lengthSq() < 1e-6) {
    axis.copy(preferredAxis);
  } else if (axis.dot(preferredAxis) < 0) {
    axis.negate();
  }
  axis.normalize();
  const sourceAngle = upperDirection.angleTo(forearmDirection);
  const bendAngle = Math.min(Math.PI * 0.82, Math.max(sourceAngle * 1.20, 0.16));
  return upperDirection.clone().applyAxisAngle(axis, bendAngle).normalize();
}

function retargetFrame(character, timeSeconds) {
  const {bvh, source, rig} = character;
  // Collision correction is intentionally reapplied from the bind position
  // every frame; otherwise the previous frame's hand offset would change the
  // elbow's rest direction and accumulate into a visible arm drift.
  rig.leftHand.position.copy(rig.bindPositions.get(rig.leftHand.name));
  rig.rightHand.position.copy(rig.bindPositions.get(rig.rightHand.name));
  const sample = applySourceMotion(source, bvh, timeSeconds);
  const sourceRoot = source.bones.get(bvh.nodes[0].name);
  const baseSample = bvh.sample(0);
  const rootDelta = new T.Vector3(
    -(sample.sampleValue(bvh.nodes[0].name, 'Xposition') - baseSample.sampleValue(bvh.nodes[0].name, 'Xposition')),
    sample.sampleValue(bvh.nodes[0].name, 'Yposition') - baseSample.sampleValue(bvh.nodes[0].name, 'Yposition'),
    sample.sampleValue(bvh.nodes[0].name, 'Zposition') - baseSample.sampleValue(bvh.nodes[0].name, 'Zposition'),
  ).multiplyScalar(BVH_ROOT_SCALE);
  rig.root.position.set(0, 1.65 + rootDelta.y, 0);
  const sourceRootBase = bvhEuler(baseSample, bvh.nodes[0].name);
  const sourceRootCurrent = sourceRoot.quaternion.clone();
  rig.root.quaternion.copy(mirroredRelativeQuaternion(sourceRootCurrent, new T.Quaternion().setFromEuler(sourceRootBase)));

  const directMap = [
    [rig.spine, 'spine_JNT'],
    [rig.spineUpper, 'spine1_JNT'],
    [rig.neck, 'neck_JNT'],
    [rig.head, 'head_JNT'],
  ];
  for (const [target, sourceName] of directMap) {
    const base = new T.Quaternion().setFromEuler(bvhEuler(baseSample, sourceName));
    const current = source.bones.get(sourceName).quaternion;
    target.quaternion.copy(mirroredRelativeQuaternion(current, base));
  }

  rig.group.updateMatrixWorld(true);
  const armMap = [
    [rig.leftShoulder, rig.leftElbow, 'l_shoulder_JNT', 'l_arm_JNT', 'l_forearm_JNT', -1],
    [rig.rightShoulder, rig.rightElbow, 'r_shoulder_JNT', 'r_arm_JNT', 'r_forearm_JNT', 1],
  ];
  for (const [shoulder, elbow, shoulderName, armName, forearmName, side] of armMap) {
    const upperDirection = worldDirection(source.bones, shoulderName, armName);
    const forearmDirection = worldDirection(source.bones, armName, forearmName);
    upperDirection.x *= -1;
    forearmDirection.x *= -1;
    orientTargetBone(shoulder, upperDirection, rig.restDirections);
    rig.group.updateMatrixWorld(true);
    orientTargetBone(elbow, amplifiedElbowDirection(upperDirection, forearmDirection, side), rig.restDirections);
    rig.group.updateMatrixWorld(true);
  }

  const directionalMap = [
    [rig.leftHip, 'l_upleg_JNT', 'l_leg_JNT'],
    [rig.leftKnee, 'l_leg_JNT', 'l_foot_JNT'],
    [rig.rightHip, 'r_upleg_JNT', 'r_leg_JNT'],
    [rig.rightKnee, 'r_leg_JNT', 'r_foot_JNT'],
    [rig.leftAnkle, 'l_foot_JNT', 'l_toebase_JNT'],
    [rig.rightAnkle, 'r_foot_JNT', 'r_toebase_JNT'],
  ];
  for (const [target, fromName, toName] of directionalMap) {
    const direction = worldDirection(source.bones, fromName, toName);
    direction.x *= -1;
    orientTargetBone(target, direction, rig.restDirections);
    rig.group.updateMatrixWorld(true);
  }

  for (const [target, sourceName] of [[rig.leftHand, 'l_hand_JNT'], [rig.rightHand, 'r_hand_JNT']]) {
    const base = new T.Quaternion().setFromEuler(bvhEuler(baseSample, sourceName));
    target.quaternion.copy(mirroredRelativeQuaternion(source.bones.get(sourceName).quaternion, base));
  }
  rig.group.updateMatrixWorld(true);
  applyCollisionConstraints(character);
  rig.group.updateMatrixWorld(true);
  character.skeleton.update();
}

function applyCollisionConstraints(character) {
  const {rig} = character;
  character.skeleton.update();
  rig.group.updateMatrixWorld(true);
  const leftFootBounds = new T.Box3().setFromObject(character.footMeshes.left);
  const rightFootBounds = new T.Box3().setFromObject(character.footMeshes.right);
  const meshFloorCorrection = Math.max(0, 0.025 - Math.min(leftFootBounds.min.y, rightFootBounds.min.y));
  const leftFoot = new T.Vector3();
  const rightFoot = new T.Vector3();
  rig.leftToe.getWorldPosition(leftFoot);
  rig.rightToe.getWorldPosition(rightFoot);
  const floorCorrection = Math.max(meshFloorCorrection, 0.04 - Math.min(leftFoot.y, rightFoot.y));
  if (floorCorrection > 0) {
    rig.root.position.y += floorCorrection;
    rig.group.updateMatrixWorld(true);
  }

  const headCenter = new T.Vector3();
  rig.head.getWorldPosition(headCenter);
  for (const hand of [rig.leftHand, rig.rightHand]) {
    const handPosition = new T.Vector3();
    hand.getWorldPosition(handPosition);
    const relative = handPosition.clone().sub(headCenter);
    const normalized = (relative.x / 1.18) ** 2 + (relative.y / 0.93) ** 2 + (relative.z / 0.99) ** 2;
    if (normalized < 1.03) {
      const push = Math.min(0.20, (1.03 - normalized) * 0.30 + 0.035);
      const desired = handPosition.clone().add(new T.Vector3(0, 0, push));
      const local = desired.applyMatrix4(new T.Matrix4().copy(hand.parent.matrixWorld).invert());
      const base = character.rig.bindPositions.get(hand.name);
      hand.position.copy(local);
      hand.position.y = base.y + T.MathUtils.clamp(local.y - base.y, -0.04, 0.18);
      hand.position.z = base.z + T.MathUtils.clamp(local.z - base.z, -0.02, 0.26);
    }
  }
}

export function createFreshCharacter({bvh}) {
  if (!bvh) throw new Error('The fresh character requires the supplied BVH motion data.');
  const rig = createTargetSkeleton();
  const source = buildSourceSkeleton(bvh);
  rig.group.add(source.group);

  const root = rig.group;
  root.name = 'dropshot-character-dance';
  root.userData.assetType = 'standalone-skinned-character';
  root.userData.retargetedFrom = 'DeepMotion BVH';
  root.userData.animation = 'Dance';
  root.userData.animationDuration = DANCE_DURATION;
  root.userData.animationFps = OUTPUT_FPS;
  root.userData.gameImplementation = false;

  const materials = {
    scoop: new T.MeshStandardMaterial({color: COLORS.scoop, roughness: 0.93}),
    limb: new T.MeshStandardMaterial({color: COLORS.limb, roughness: 0.95}),
    purple: new T.MeshStandardMaterial({color: COLORS.purple, roughness: 0.68}),
    steam: new T.MeshStandardMaterial({color: COLORS.steam, roughness: 0.62}),
    ear: new T.MeshStandardMaterial({color: COLORS.ear, roughness: 0.96}),
    cone: new T.MeshStandardMaterial({color: COLORS.cone, roughness: 0.95}),
    waffle: new T.MeshStandardMaterial({color: COLORS.waffle, roughness: 0.90}),
  };
  addScoopAndFace(root, rig.skeleton, rig, materials);
  addCone(root, rig.skeleton, rig, materials);
  const footMeshes = addLimbs(root, rig.skeleton, rig, materials);

  const character = {
    root,
    rig,
    source,
    bvh,
    skeleton: rig.skeleton,
    footMeshes,
    animate(timeSeconds) {
      retargetFrame(character, timeSeconds);
    },
  };
  character.animate(0);
  return character;
}

