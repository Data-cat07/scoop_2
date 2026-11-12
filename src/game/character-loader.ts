import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/examples/jsm/utils/SkeletonUtils.js';

export type CharacterInstance = {
 root:T.Group;
 animate:(timeSeconds:number)=>void;
};

const MODEL_URL=new URL('../../artifacts/model/dropshot-character-dance.glb',import.meta.url).href;
type LoadedModel=Awaited<ReturnType<GLTFLoader['loadAsync']>>;
let modelPromise:Promise<LoadedModel>|null=null;

function loadModel(){
 modelPromise??=new GLTFLoader().loadAsync(MODEL_URL);
 return modelPromise;
}

export async function loadCharacter():Promise<CharacterInstance>{
 const model=await loadModel();
 const root=cloneSkinned(model.scene) as T.Group;
 const clip=model.animations.find(item=>item.name==='Dance')??model.animations[0];
 if(!clip)throw new Error('dropshot-character-dance.glb에 애니메이션이 없습니다.');

 root.name='dropshot-character-dance';
 root.userData.model='dropshot-character-dance.glb';
 root.userData.animation=clip.name;
 root.userData.animationDuration=clip.duration;
 root.traverse(object=>{
  if((object as T.Mesh).isMesh){
   const mesh=object as T.Mesh;
   mesh.castShadow=true;
   mesh.receiveShadow=true;
  }
 });

 const mixer=new T.AnimationMixer(root);
 const action=mixer.clipAction(clip);
 action.setLoop(T.LoopRepeat,Infinity);
 action.play();

 return {
  root,
  animate(timeSeconds){
   const time=clip.duration>0?((timeSeconds%clip.duration)+clip.duration)%clip.duration:0;
   mixer.setTime(time);
   root.updateMatrixWorld(true);
  },
 };
}
