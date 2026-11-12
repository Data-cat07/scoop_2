import fs from 'node:fs/promises';
import path from 'node:path';
import * as T from 'three';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {createFreshCharacter, DANCE_DURATION, OUTPUT_FPS, loadBvh} from './fresh-dropshot-character.mjs';

class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.({target: this});
    });
  }
}

globalThis.FileReader = NodeFileReader;

const bvhFileName = '1104(1)_customModel_hXBrhdpmbtpo6dwf3zVGyw.bvh';
const defaultBvhPath = path.resolve(process.env.USERPROFILE ?? 'C:/Users/PC', 'Downloads', bvhFileName);
const bvhPath = path.resolve(process.argv[2] ?? defaultBvhPath);
const bvh = await loadBvh(bvhPath);
if (bvh.frameCount < 2) throw new Error('The supplied BVH does not contain enough frames.');

const character = createFreshCharacter({bvh});
const root = character.root;
root.userData.sourceVideo = '새로운_보드_-P5aou1mc90giFMXDfIR_Dropshot.mp4';
root.userData.sourceBvh = bvhFileName;
root.userData.sourceBvhFrames = bvh.frameCount;
root.userData.sourceBvhFrameTime = bvh.frameTime;
root.userData.retargeting = 'BVH joints retargeted to the standalone ice-cream skeleton; no game runtime code.';

const animatedBones = character.rig.bones;
const sampleCount = Math.round(DANCE_DURATION * OUTPUT_FPS);
// Keep sampling times as JavaScript Numbers so the closing sample is exactly
// 7.2, then convert to Float32 only when writing glTF track data.
const times = Array.from(
  {length: sampleCount + 1},
  (_, index) => index === sampleCount ? DANCE_DURATION : index / OUTPUT_FPS,
);

const samples = [];
for (const time of times) {
  character.animate(time);
  root.updateMatrixWorld(true);
  samples.push(animatedBones.map((bone) => ({
    position: bone.position.toArray(),
    // setFromUnitVectors can leave a component a few ulps outside [-1, 1].
    // Normalize before baking so strict glTF validators and desktop viewers
    // accept every animation quaternion.
    quaternion: bone.quaternion.clone().normalize().toArray(),
  })));
}

const tracks = [];
for (let boneIndex = 0; boneIndex < animatedBones.length; boneIndex += 1) {
  const bone = animatedBones[boneIndex];
  const positions = new Float32Array(times.length * 3);
  const quaternions = new Float32Array(times.length * 4);
  samples.forEach((sample, sampleIndex) => {
    positions.set(sample[boneIndex].position, sampleIndex * 3);
    quaternions.set(sample[boneIndex].quaternion, sampleIndex * 4);
  });
  const trackTimes = Float32Array.from(times);
  tracks.push(new T.VectorKeyframeTrack(`${bone.name}.position`, trackTimes, positions));
  tracks.push(new T.QuaternionKeyframeTrack(`${bone.name}.quaternion`, trackTimes, quaternions));
}

// The hidden source rig is used only while retargeting. Removing it keeps the
// delivered GLB a clean standalone character with the target Skeleton only.
root.remove(character.source.group);
character.skeleton.update();

// The character group is useful while building and sampling the rig, but a
// standalone glTF is more portable when its skinned meshes are direct scene
// children. This also avoids viewers that reject a skinned mesh below a
// non-root transform node.
const exportScene = new T.Scene();
exportScene.name = root.name;
exportScene.userData = {...root.userData};
for (const child of [...root.children]) exportScene.add(child);
exportScene.updateMatrixWorld(true);
exportScene.traverse((object) => {
  if (!object.quaternion) return;
  object.quaternion.normalize();
});

const dance = new T.AnimationClip('Dance', DANCE_DURATION, tracks);
dance.userData = {
  source: bvhFileName,
  sourceFrames: bvh.frameCount,
  sourceFrameTime: bvh.frameTime,
  outputFps: OUTPUT_FPS,
  durationSeconds: DANCE_DURATION,
  resampledToVideoDuration: true,
  loop: true,
};

const exporter = new GLTFExporter();
const data = await exporter.parseAsync(exportScene, {
  binary: true,
  onlyVisible: true,
  animations: [dance],
  trs: true,
});

const outputDirectory = path.resolve('artifacts', 'model');
await fs.mkdir(outputDirectory, {recursive: true});
const outputPath = path.join(outputDirectory, 'dropshot-character-dance.glb');
await fs.writeFile(outputPath, Buffer.from(data));

const manifest = {
  file: 'dropshot-character-dance.glb',
  animation: 'Dance',
  durationSeconds: DANCE_DURATION,
  outputFps: OUTPUT_FPS,
  loop: true,
  sourceVideo: '새로운_보드_-P5aou1mc90giFMXDfIR_Dropshot.mp4 (7.20 seconds)',
  sourceBvh: bvhFileName,
  sourceBvhFrames: bvh.frameCount,
  sourceBvhFrameTime: bvh.frameTime,
  retargetedBoneCount: animatedBones.length,
  retargetedFromDeepMotionBvh: true,
  hasSkinnedSkeleton: true,
  gameImplementation: false,
  notes: 'New standalone model; BVH motion is resampled to the source video timebase and baked into Bone tracks.',
};
await fs.writeFile(
  path.join(outputDirectory, 'dropshot-character-dance.json'),
  JSON.stringify(manifest, null, 2) + '\n',
  'utf8',
);

console.log(JSON.stringify({
  outputPath,
  animation: dance.name,
  duration: dance.duration,
  tracks: tracks.length,
  bones: animatedBones.length,
  bvhFrames: bvh.frameCount,
  bvhFrameTime: bvh.frameTime,
}, null, 2));

