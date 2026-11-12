import * as T from 'three';
import {loadCharacter,type CharacterInstance} from './character-loader';
import {createScoopMap,type ScoopMap} from './map';
import {PlayerController} from './player-controller';
import {Rules,type Snapshot} from './rules';
import {chooseSpawnPointIndices,SPAWN_POINTS,TARGET_COUNT} from './spawn-points';

type Target=CharacterInstance&{slot:number;delay:number};
type Particle={mesh:T.Mesh;velocity:T.Vector3;life:number};
export class GameEngine {
 readonly rules:Rules;
 readonly scene=new T.Scene();
 readonly camera=new T.PerspectiveCamera(65,1,.05,520);
 readonly renderer:T.WebGLRenderer;
 private map!:ScoopMap;
 private controller!:PlayerController;
 private targets:Target[]=[];
 private hero:CharacterInstance|null=null;
 private obstacles:T.Mesh[]=[];
 private ray=new T.Raycaster();
 private keys=new Set<string>();
 private aiming=false;
 private yaw=0;private pitch=0;private raf=0;private last=0;private elapsed=0;private uiTime=0;
 private particles:Particle[]=[];private recoil=0;private flashTime=0;
 private gun=new T.Group();private flash!:T.Mesh;
 private audio:AudioContext|null=null;
 private endedSaved=false;private disposed=false;
 private cleanup:(()=>void)[]=[];
 constructor(private host:HTMLElement,private notify:(s:Snapshot)=>void,private onError:(s:string)=>void){
  let best=0;try{best=Number(localStorage.getItem('scoop-best'))||0;}catch{/* Storage is optional. */}
  this.rules=new Rules(best);
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:false});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
  host.appendChild(this.renderer.domElement);this.scene.background=new T.Color('#b9dcd7');this.scene.fog=new T.Fog('#c3ded7',70,360);
  this.camera.position.set(0,1.7,7);this.camera.rotation.order='YXZ';this.scene.add(this.camera);
  this.buildWorld();this.controller=new PlayerController(this.camera,this.map);void this.loadImportedCharacters();this.buildGun();this.events();this.resize();this.notify({...this.rules.state});this.raf=requestAnimationFrame(this.frame);
 }
 private async loadImportedCharacters(){
  try{
   const loaded=await Promise.all(Array.from({length:TARGET_COUNT+1},()=>loadCharacter()));
   if(this.disposed)return;
   if(this.hero)this.scene.remove(this.hero.root);this.targets.forEach(target=>this.scene.remove(target.root));
   const [hero,...targets]=loaded;
   this.hero=hero;this.hero.root.position.set(2.5,.46,1);this.hero.root.userData.baseY=.46;this.hero.root.scale.setScalar(.82);this.scene.add(this.hero.root);
   const initialSlots=chooseSpawnPointIndices(targets.length);
   this.targets=targets.map((character,index)=>{
    const target={...character,slot:initialSlots[index],delay:0};
    target.root.userData.baseY=.38;target.root.scale.setScalar(.66);this.placeTarget(target,target.slot);this.tagTarget(target,index);this.scene.add(target.root);return target;
   });
   if(this.rules.state.phase==='ready')this.onError('');
  }catch(error){
   console.error('Failed to load dropshot-character-dance.glb.',error);
   this.onError('새 아이스크림 캐릭터를 불러오지 못해 기본 캐릭터를 표시하고 있어요.');
  }
 }
 private tagTarget(target:Target,index:number){target.root.userData.target=index;target.root.traverse(object=>object.userData.target=index);}
 private placeTarget(target:Target,slotIndex:number){const slot=SPAWN_POINTS[slotIndex];if(!slot)return;target.slot=slotIndex;target.root.position.set(slot.x,target.root.userData.baseY??0,slot.z);}
 private listen<K extends keyof WindowEventMap>(type:K,fn:(e:WindowEventMap[K])=>void){window.addEventListener(type,fn);this.cleanup.push(()=>window.removeEventListener(type,fn));}
 private events(){
  this.listen('resize',()=>this.resize());
  this.listen('keydown',e=>{if(['KeyW','KeyA','KeyS','KeyD','KeyR','Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight'].includes(e.code)&&this.rules.state.phase!=='ready')e.preventDefault();this.keys.add(e.code);if(e.code==='KeyR')this.rules.reload();if(e.code==='Escape')this.pause();});
  this.listen('keyup',e=>this.keys.delete(e.code));
  this.listen('blur',()=>this.pause());
  this.listen('mousemove',e=>{if(document.pointerLockElement!==this.renderer.domElement)return;if(!['playing','countdown'].includes(this.rules.state.phase))return;this.yaw-=e.movementX*.002;this.pitch=T.MathUtils.clamp(this.pitch-e.movementY*.002,-1.1,1.1);this.camera.rotation.set(this.pitch,this.yaw,0);});
  this.listen('mousedown',e=>{
   if(document.pointerLockElement!==this.renderer.domElement)return;
   if(e.button===0)this.shoot();
   if(e.button===2&&this.rules.state.phase==='playing'){e.preventDefault();this.aiming=true;}
  });
  this.listen('mouseup',e=>{if(e.button===2)this.aiming=false;});
  this.listen('contextmenu',e=>{if(document.pointerLockElement===this.renderer.domElement)e.preventDefault();});
  const lock=()=>{if(document.pointerLockElement!==this.renderer.domElement)this.pause();};document.addEventListener('pointerlockchange',lock);this.cleanup.push(()=>document.removeEventListener('pointerlockchange',lock));
  const visibility=()=>{if(document.hidden)this.pause();};document.addEventListener('visibilitychange',visibility);this.cleanup.push(()=>document.removeEventListener('visibilitychange',visibility));
  const error=()=>this.onError('마우스 잠금을 허용해야 플레이할 수 있어요. 시작 버튼을 다시 눌러주세요.');document.addEventListener('pointerlockerror',error);this.cleanup.push(()=>document.removeEventListener('pointerlockerror',error));
 }
 async start(){
  if(!this.hero||this.targets.length===0){this.onError('춤추는 캐릭터를 준비하고 있어요. 잠시 후 다시 눌러주세요.');return;}
  try{await this.renderer.domElement.requestPointerLock();if(this.disposed)return;if(document.pointerLockElement!==this.renderer.domElement)return;
   if(this.rules.state.phase==='paused')this.rules.resume();else{this.rules.start();this.endedSaved=false;this.elapsed=0;this.controller.reset(new T.Vector3(0,1.7,7));this.yaw=0;this.pitch=0;this.camera.rotation.set(0,0,0);this.clearParticles();const initialSlots=chooseSpawnPointIndices(this.targets.length);this.targets.forEach((t,i)=>{t.delay=0;t.root.visible=true;this.placeTarget(t,initialSlots[i]);});}
   this.keys.clear();this.last=performance.now();this.onError('');this.sound(440,.04,.02);this.notify({...this.rules.state});
  }catch{this.onError('마우스 잠금을 시작하지 못했어요. 브라우저에서 이 페이지를 열고 다시 시도해주세요.');}
 }
 pause(){this.rules.pause();this.keys.clear();this.notify({...this.rules.state});if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();}
 toggleSound(){this.rules.state.sound=!this.rules.state.sound;this.notify({...this.rules.state});}
 private resize(){const w=this.host.clientWidth,h=this.host.clientHeight;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 private buildWorld(){
  this.scene.add(new T.HemisphereLight('#fff4db','#729f86',2.8));
  const sun=new T.DirectionalLight('#fff1d4',3.8);sun.position.set(-32,44,26);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-100,right:100,top:100,bottom:-100,near:1,far:240});sun.shadow.normalBias=.035;this.scene.add(sun);
  this.map=createScoopMap(this.scene);this.obstacles=this.map.obstacles;
 }
 private buildGun(){
  const dark=new T.MeshStandardMaterial({color:'#46565c',metalness:.35,roughness:.45}),light=new T.MeshStandardMaterial({color:'#f3e8d1',roughness:.5}),accent=new T.MeshStandardMaterial({color:'#f2aa74',roughness:.5});
  const part=(w:number,h:number,d:number,x:number,y:number,z:number,mat:T.Material)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);this.gun.add(m);return m;};
  part(.16,.19,.44,0,0,0,light);part(.09,.09,.4,0,.015,-.3,dark);part(.12,.22,.12,0,-.16,.08,accent).rotation.x=-.25;part(.1,.2,.12,0,-.15,-.08,dark);part(.13,.025,.19,0,.108,.01,dark);part(.027,.034,.028,0,.136,-.16,accent);part(.23,.15,.13,0,0,.27,accent);
  this.flash=new T.Mesh(new T.OctahedronGeometry(.12),new T.MeshBasicMaterial({color:'#fff3ac',transparent:true,opacity:.95}));this.flash.position.set(0,.015,-.55);this.flash.visible=false;this.gun.add(this.flash);this.gun.position.set(.34,-.31,-.67);this.camera.add(this.gun);
 }
 private shoot(){
  if(!this.rules.shoot())return;
  this.recoil=1;this.flashTime=.055;this.sound(105,.07,.08,'sawtooth');
  this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);this.ray.setFromCamera(new T.Vector2(0,0),this.camera);
  const roots:T.Object3D[]=[...this.obstacles,...this.targets.filter(t=>t.root.visible).map(t=>t.root)];
  const hit=this.ray.intersectObjects(roots,true)[0];
  if(hit&&typeof hit.object.userData.target==='number'){
   const t=this.targets[hit.object.userData.target];if(t.delay>0)return;
   this.rules.hit();this.burst(hit.point);t.root.visible=false;t.delay=.7;this.sound(720,.11,.06,'sine');
  }
  this.notify({...this.rules.state});
 }
 private sound(freq:number,duration:number,gain:number,type:OscillatorType='sine'){
  if(!this.rules.state.sound)return;
  try{this.audio??=new AudioContext();void this.audio.resume();const osc=this.audio.createOscillator(),env=this.audio.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,this.audio.currentTime);osc.frequency.exponentialRampToValueAtTime(freq*.45,this.audio.currentTime+duration);env.gain.setValueAtTime(gain,this.audio.currentTime);env.gain.exponentialRampToValueAtTime(.001,this.audio.currentTime+duration);osc.connect(env).connect(this.audio.destination);osc.start();osc.stop(this.audio.currentTime+duration);}catch{/* Audio is optional. */}
 }
 private burst(p:T.Vector3){for(let i=0;i<18;i++){const m=new T.Mesh(new T.OctahedronGeometry(.07+(i%3)*.025),new T.MeshBasicMaterial({color:i%2?'#ffe397':'#c5b3f1',transparent:true}));m.position.copy(p);this.scene.add(m);this.particles.push({mesh:m,velocity:new T.Vector3(Math.sin(i*2.4)*2,1.5+(i%5)*.4,Math.cos(i*2.4)*2),life:.65});}}
 private clearParticles(){for(const p of this.particles){this.scene.remove(p.mesh);p.mesh.geometry.dispose();(p.mesh.material as T.Material).dispose();}this.particles=[];}
 private move(dt:number){
  this.controller.update(dt,{forward:this.keys.has('KeyW'),back:this.keys.has('KeyS'),left:this.keys.has('KeyA'),right:this.keys.has('KeyD'),jump:this.keys.has('Space'),sprint:this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'),slide:this.keys.has('ControlLeft')||this.keys.has('ControlRight')},this.yaw);
 }
 private frame=(now:number)=>{
  if(this.disposed)return;const dt=this.last?Math.min((now-this.last)/1000,.1):0;this.last=now;
  const before=this.rules.state.phase;this.rules.tick(dt);const s=this.rules.state;
  const animate=s.phase==='ready'||s.phase==='playing'||s.phase==='countdown';if(animate)this.elapsed+=dt;
  if(s.phase==='playing'){
   this.move(dt);
   for(const t of this.targets)if(t.delay>0){t.delay=Math.max(0,t.delay-dt);if(t.delay===0){const occupied=new Set(this.targets.filter(o=>o!==t&&o.delay===0).map(o=>o.slot));const options=SPAWN_POINTS.map((slot,index)=>({slot,index})).filter(item=>!occupied.has(item.index)&&item.index!==t.slot&&Math.hypot(item.slot.x-this.camera.position.x,item.slot.z-this.camera.position.z)>2);const replacement=options.length?options[Math.floor(Math.random()*options.length)].index:t.slot;this.placeTarget(t,replacement);t.root.visible=true;}}
   for(const p of this.particles){p.life-=dt;p.velocity.y-=dt*4;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.rotation.x+=dt*4;p.mesh.scale.setScalar(Math.max(0,p.life/.65));}
   this.particles=this.particles.filter(p=>{if(p.life>0)return true;this.scene.remove(p.mesh);p.mesh.geometry.dispose();(p.mesh.material as T.Material).dispose();return false;});
  }
  for(const t of this.targets)t.animate(this.elapsed);
  if(this.hero){this.hero.root.visible=s.phase==='ready';this.hero.animate(this.elapsed);}
  if(animate){this.recoil=Math.max(0,this.recoil-dt*9);this.flashTime=Math.max(0,this.flashTime-dt);}
  this.gun.visible=s.phase==='playing'||s.phase==='countdown';this.flash.visible=this.flashTime>0;
  this.gun.position.z=-.67+this.recoil*.09;this.gun.rotation.x=this.recoil*.12+(s.reload>0?-.7*Math.sin(s.reload/1.5*Math.PI):0);
  const aim=this.aiming&&s.phase==='playing'&&document.pointerLockElement===this.renderer.domElement;
  if(!aim)this.aiming=false;
  const aimBlend=1-Math.exp(-dt*18);
  this.gun.position.x=T.MathUtils.lerp(this.gun.position.x,aim?0:.34,aimBlend);
  this.gun.position.y=T.MathUtils.lerp(this.gun.position.y,aim?-.21:-.31,aimBlend);
  this.host.classList.toggle('aiming',aim);
  this.camera.fov=T.MathUtils.lerp(this.camera.fov,aim?40:65,aimBlend);
  this.camera.updateProjectionMatrix();
  if(s.phase==='ended'&&!this.endedSaved){this.endedSaved=true;try{localStorage.setItem('scoop-best',String(s.best));}catch{/* Storage is optional. */}this.keys.clear();if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();}
  this.uiTime+=dt;if(this.uiTime>.07||before!==s.phase){this.notify({...s});this.uiTime=0;}
  this.renderer.render(this.scene,this.camera);this.raf=requestAnimationFrame(this.frame);
 };
 dispose(){this.disposed=true;cancelAnimationFrame(this.raf);this.cleanup.forEach(f=>f());if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock();this.clearParticles();const geos=new Set<T.BufferGeometry>(),mats=new Set<T.Material>();this.scene.traverse(o=>{if(o instanceof T.Mesh){geos.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach((m:T.Material)=>mats.add(m));}});geos.forEach(g=>g.dispose());mats.forEach(m=>{if(m instanceof T.MeshStandardMaterial)m.map?.dispose();m.dispose();});this.renderer.dispose();void this.audio?.close();this.renderer.domElement.remove();}
}
