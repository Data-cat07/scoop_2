import fs from 'node:fs/promises';
import path from 'node:path';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

const filePath = path.resolve(process.argv[2] ?? 'artifacts/model/dropshot-character-dance.glb');
const buffer = await fs.readFile(filePath);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const loader = new GLTFLoader();
const gltf = await new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));
const animation = gltf.animations.find((clip) => clip.name === 'Dance');
const skinnedMeshes = [];
const bones = [];
gltf.scene.traverse((object) => {
  if (object.isSkinnedMesh) skinnedMeshes.push(object);
  if (object.isBone) bones.push(object);
});
if (!animation) throw new Error('GLB is missing the Dance animation.');
if (skinnedMeshes.length === 0) throw new Error('GLB is missing a SkinnedMesh.');
if (bones.length < 10) throw new Error(`GLB has too few bones: ${bones.length}`);
if (animation.duration < 7.19 || animation.duration > 7.21) throw new Error(`Unexpected animation duration: ${animation.duration}`);
if (!animation.tracks.some((track) => track.name.endsWith('.quaternion'))) throw new Error('GLB has no quaternion bone tracks.');

let loopEndpointsMatch = true;
for (const track of animation.tracks) {
  const size = track.getValueSize();
  const first = track.values.slice(0, size);
  const last = track.values.slice(track.values.length - size);
  for (let index = 0; index < size; index += 1) {
    if (Math.abs(first[index] - last[index]) > 1e-4) {
      loopEndpointsMatch = false;
    }
  }
}
const result = {
  file: filePath,
  animation: animation.name,
  durationSeconds: animation.duration,
  tracks: animation.tracks.length,
  bones: bones.length,
  skinnedMeshes: skinnedMeshes.length,
  skeletonBones: skinnedMeshes[0].skeleton.bones.length,
  loopEndpointsMatch,
  hasPositionTracks: animation.tracks.some((track) => track.name.endsWith('.position')),
  hasQuaternionTracks: animation.tracks.some((track) => track.name.endsWith('.quaternion')),
};
console.log(JSON.stringify(result, null, 2));
if (!loopEndpointsMatch) throw new Error('The baked animation does not loop at matching endpoints.');

