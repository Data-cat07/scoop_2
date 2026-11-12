import * as T from 'three';

export type CollisionBox={
 box:T.Box3;
 name:string;
};

type RampSurface={
 axis:'x'|'z';
 centerX:number;
 centerZ:number;
 length:number;
 width:number;
 baseY:number;
 topY:number;
 direction:1|-1;
};

export type ScoopMap={
 obstacles:T.Mesh[];
 colliders:CollisionBox[];
 groundHeightAt:(x:number,z:number,footY:number)=>number;
 surfaceBelow:(x:number,z:number,topY:number)=>number|null;
 canOccupy:(x:number,z:number,footY:number,radius:number,height:number)=>boolean;
};

const STEP_HEIGHT=.46;
const MAP_MIN_X=-75;
const MAP_MAX_X=75;
const MAP_MIN_Z=-170;
const MAP_MAX_Z=30;

function material(color:string,roughness=.86){
 return new T.MeshStandardMaterial({color,roughness});
}

function rampGeometry(width:number,length:number,height:number){
 const x=width/2,z=length/2;
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute([
  -x,0,-z, x,0,-z,
  -x,0,z, x,0,z,
  -x,height,z, x,height,z,
 ],3));
 geometry.setIndex([
  0,2,1, 1,2,3,
  0,1,5, 0,5,4,
  0,4,2, 2,4,5,
  1,3,5, 1,5,3,
  2,4,5, 2,5,3,
 ]);
 geometry.computeVertexNormals();
 return geometry;
}

function addRamp(
 scene:T.Scene,
 ramps:RampSurface[],
 width:number,
 length:number,
 height:number,
 centerX:number,
 centerZ:number,
 axis:'x'|'z',
 direction:1|-1,
 color:string,
){
 const mesh=new T.Mesh(rampGeometry(width,length,height),material(color,.91));
 mesh.position.set(centerX,0,centerZ);
 mesh.rotation.y=axis==='z'
  ?(direction===1?0:Math.PI)
  :(direction===1?Math.PI/2:-Math.PI/2);
 mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
 ramps.push({axis,centerX,centerZ,length,width,baseY:0,topY:height,direction});
 return mesh;
}

function rampHeight(ramp:RampSurface,x:number,z:number){
 const halfLength=ramp.length/2,halfWidth=ramp.width/2;
 let progress:number;
 if(ramp.axis==='z'){
  if(Math.abs(x-ramp.centerX)>halfWidth||Math.abs(z-ramp.centerZ)>halfLength)return null;
  progress=(z-ramp.centerZ+halfLength)/ramp.length;
 }else{
  if(Math.abs(z-ramp.centerZ)>halfWidth||Math.abs(x-ramp.centerX)>halfLength)return null;
  progress=(x-ramp.centerX+halfLength)/ramp.length;
 }
 if(ramp.direction===-1)progress=1-progress;
 return ramp.baseY+T.MathUtils.clamp(progress,0,1)*(ramp.topY-ramp.baseY);
}

function addCloud(scene:T.Scene,x:number,y:number,z:number,r:number,color:string){
 const mesh=new T.Mesh(new T.SphereGeometry(r,14,10),material(color,1));
 mesh.position.set(x,y,z);mesh.scale.set(1.6,.75,1);mesh.castShadow=true;scene.add(mesh);
}

export function createScoopMap(scene:T.Scene):ScoopMap{
 const obstacles:T.Mesh[]=[];
 const colliders:CollisionBox[]=[];
 const ramps:RampSurface[]=[];

 const addBox=(
  name:string,x:number,y:number,z:number,width:number,height:number,depth:number,color:string,
  solid=true,
 )=>{
  const mesh=new T.Mesh(new T.BoxGeometry(width,height,depth),material(color));
  mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  if(solid){
   obstacles.push(mesh);
   colliders.push({box:new T.Box3().setFromObject(mesh),name});
  }
  return mesh;
 };

 const floor=new T.Mesh(new T.PlaneGeometry(230,230),material('#a8c99c',1));
 floor.name='park-ground';floor.rotation.x=-Math.PI/2;floor.position.set(0,-.055,-70);floor.receiveShadow=true;scene.add(floor);
 const plaza=new T.Mesh(new T.CylinderGeometry(18,18,.10,112),material('#e5d9bd',.97));
 plaza.name='central-plaza';plaza.position.set(0,-.02,-5);plaza.receiveShadow=true;scene.add(plaza);
 const centralAvenue=new T.Mesh(new T.BoxGeometry(8,.035,190),material('#f2e7ce',.98));
 centralAvenue.name='central-avenue';centralAvenue.position.set(0,-.015,-70);centralAvenue.receiveShadow=true;scene.add(centralAvenue);
 const westAvenue=new T.Mesh(new T.BoxGeometry(6,.035,180),material('#efe1c8',.98));
 westAvenue.name='west-avenue';westAvenue.position.set(-40,-.012,-70);westAvenue.receiveShadow=true;scene.add(westAvenue);
 const eastAvenue=new T.Mesh(new T.BoxGeometry(6,.035,180),material('#efe1c8',.98));
 eastAvenue.name='east-avenue';eastAvenue.position.set(40,-.012,-70);eastAvenue.receiveShadow=true;scene.add(eastAvenue);

 // The park now spans several districts rather than one compact arena. The
 // boundary leaves generous side lanes and a long rear route for exploration.
 addBox('north-boundary',0,1,30,150,2,.45,'#d9cfbd');
 addBox('south-boundary',0,1,-170,150,2,.45,'#d9cfbd');
 addBox('west-boundary',-75,1,-70,.45,2,200,'#d9cfbd');
 addBox('east-boundary',75,1,-70,.45,2,200,'#d9cfbd');

 // A broad entrance district makes the spawn area feel like a real park
 // gateway before the player reaches the older central buildings.
 addBox('north-gate-left',-10,2,24,6,4,.8,'#d7c3df');
 addBox('north-gate-right',10,2,24,6,4,.8,'#d7c3df');
 addBox('north-gate-top',0,4.25,24,22,1,.8,'#f0d1b7');
 addBox('north-gate-sign',0,5.2,23.55,10,.7,.18,'#56776a');
 addBox('north-planter-west',-21,.5,19,3,1,2.5,'#b9d5c0');
 addBox('north-planter-east',21,.5,19,3,1,2.5,'#b9d5c0');

 // Original pastel park landmarks: a waffle depot on the west, a freezer
 // tower on the east, and a raised sundae hall at the back of the park.
 addBox('waffle-depot',-9,2.5,-6,5.6,5,6.5,'#d7b0a5');
 addBox('waffle-depot-roof',-9,5.18,-6,5.9,.36,6.8,'#f2d1b7');
 addBox('waffle-depot-roof-rail-west',-11.6,5.75,-6,.16,.9,6.4,'#f7e7cf');
 addBox('waffle-depot-roof-rail-east',-6.4,5.75,-6,.16,.9,6.4,'#f7e7cf');
 addBox('waffle-depot-roof-rail-back',-9,5.75,-9.1,5.2,.9,.16,'#f7e7cf');

 addBox('freezer-tower',9,3,-12,5,6,6,'#b7cbe0');
 addBox('freezer-tower-roof',9,6.18,-12,5.3,.36,6.3,'#d9e7f0');
 addBox('freezer-tower-roof-rail',9,6.75,-15,4.7,.9,.16,'#f7f0df');

 addBox('sundae-hall',0,2,-24,10,4,4,'#c8b9d9');
 addBox('sundae-hall-roof',0,4.18,-24,10.3,.36,4.3,'#e8d8e7');
 addBox('sundae-hall-roof-rail',0,4.75,-26,9.5,.9,.16,'#f7e7cf');

 // The enlarged park continues into two side districts and a deep factory
 // quarter. These structures are spaced to leave long alleys between them.
 addBox('waffle-yard-warehouse',-21,2.5,-31,6,5,9,'#dfb39c');
 addBox('waffle-yard-warehouse-roof',-21,5.18,-31,6.3,.36,9.3,'#f2d1b7');
 addBox('waffle-yard-loading-wall',-26,1.4,-37,2,2.8,5,'#c9a88e');
 addBox('waffle-yard-bridge',-20,4.1,-42,7,.32,1.3,'#efc0d1');
 addBox('waffle-yard-bridge-pillar',-20,2,-42,.4,4,.4,'#bc91a6');

 addBox('mint-market-hall',21,2.5,-31,6,5,9,'#b8cfe1');
 addBox('mint-market-hall-roof',21,5.18,-31,6.3,.36,9.3,'#dceaf0');
 addBox('mint-market-loading-wall',26,1.4,-37,2,2.8,5,'#a9bdcf');
 addBox('mint-market-bridge',20,4.1,-42,7,.32,1.3,'#b6d5df');
 addBox('mint-market-bridge-pillar',20,2,-42,.4,4,.4,'#8facbf');

 addBox('sugar-factory-west',-11,3.5,-50,8,7,9,'#c9b9d7');
 addBox('sugar-factory-east',11,3.5,-50,8,7,9,'#d6bfd9');
 addBox('sugar-factory-west-roof',-11,7.18,-50,8.3,.36,9.3,'#e8d8e7');
 addBox('sugar-factory-east-roof',11,7.18,-50,8.3,.36,9.3,'#f0d6df');
 addBox('sugar-factory-bridge',0,7.35,-50,7,.35,1.4,'#f2c7ad');
 addBox('sugar-factory-bridge-pillar-west',-3.3,3.7,-50,.4,7,.4,'#b390af');
 addBox('sugar-factory-bridge-pillar-east',3.3,3.7,-50,.4,7,.4,'#b390af');
 addBox('sugar-tower',0,4,-60,6,8,6,'#e5bf91');
 addBox('sugar-tower-roof',0,8.18,-60,6.3,.36,6.3,'#f3d9aa');
 addBox('sugar-tower-rail',0,8.75,-62.5,5.6,.9,.16,'#fff0d8');

 // Far districts fill the expanded 150 x 200 park with new landmarks,
 // long sight lines and alternate side routes instead of empty terrain.
 addBox('outer-waffle-warehouse',-38,2.5,-82,12,5,10,'#dfb39c');
 addBox('outer-waffle-warehouse-roof',-38,5.18,-82,12.3,.36,10.3,'#f2d1b7');
 addBox('outer-waffle-loading-bay',-53,1.3,-88,3,2.6,6,'#c9a88e');
 addBox('outer-mint-warehouse',38,2.5,-82,12,5,10,'#b8cfe1');
 addBox('outer-mint-warehouse-roof',38,5.18,-82,12.3,.36,10.3,'#dceaf0');
 addBox('outer-mint-loading-bay',53,1.3,-88,3,2.6,6,'#a9bdcf');

 addBox('sprinkle-courtyard-west',-24,2,-103,8,4,8,'#c9b9d7');
 addBox('sprinkle-courtyard-east',24,2,-103,8,4,8,'#d6bfd9');
 addBox('sprinkle-courtyard-arch',0,4.25,-103,16,1,.8,'#f0c7ad');
 addBox('sprinkle-courtyard-cover-west',-12,.8,-108,3,1.6,2,'#e5c58e');
 addBox('sprinkle-courtyard-cover-east',12,.8,-108,3,1.6,2,'#e2b5b1');

 addBox('rail-hub-west',-45,3,-126,10,6,8,'#b9cde1');
 addBox('rail-hub-east',45,3,-126,10,6,8,'#cbb9d9');
 addBox('rail-hub-west-roof',-45,6.18,-126,10.3,.36,8.3,'#dceaf0');
 addBox('rail-hub-east-roof',45,6.18,-126,10.3,.36,8.3,'#ead8e9');
 addBox('rail-hub-bridge',0,6.35,-126,78,.35,1.4,'#f0c5d1');
 addBox('rail-hub-pillar-west',-20,3.2,-126,.45,6.4,.45,'#ad91b6');
 addBox('rail-hub-pillar-east',20,3.2,-126,.45,6.4,.45,'#ad91b6');

 addBox('back-dock-west',-25,2,-150,12,4,8,'#e5bf91');
 addBox('back-dock-east',25,2,-150,12,4,8,'#b8d2c3');
 addBox('back-dock-roof-west',-25,4.18,-150,12.3,.36,8.3,'#f3d9aa');
 addBox('back-dock-roof-east',25,4.18,-150,12.3,.36,8.3,'#d6eadb');
 addBox('back-dock-center',0,1.2,-157,6,2.4,3,'#d3b6c7');

 // Mid-map kiosks create staggered sight lines and traversable cover before the
 // player commits to either rooftop route.
 addBox('pistachio-kiosk-west',-5.1,1.05,-9.8,2.7,2.1,2.5,'#efc5b1');
 addBox('pistachio-kiosk-west-roof',-5.1,2.28,-9.8,3.0,.35,2.8,'#f8dec0');
 addBox('berry-kiosk-east',5.3,1.0,-8.4,2.5,2,2.2,'#c9d9e7');
 addBox('berry-kiosk-east-roof',5.3,2.18,-8.4,2.8,.35,2.5,'#e2edf1');
 addBox('central-scoop-stage',0,.65,-10.9,3.8,1.3,2.1,'#eecb9e');
 addBox('central-scoop-stage-step',0,.16,-9.55,1.5,.32,.55,'#f5dfb8');
 addBox('central-scoop-stage-rail-west',-1.7,1.35,-10.9,.12,1.4,1.8,'#f8eedc');
 addBox('central-scoop-stage-rail-east',1.7,1.35,-10.9,.12,1.4,1.8,'#f8eedc');

 // Two ramps and a stepped route make the rooftops part of the traversal
 // space instead of unreachable scenery. The third ramp reaches a central
 // observation deck, giving the player a fast high-ground loop.
 addRamp(scene,ramps,2.4,5.8,5,-9,-12.25,'z',1,'#edc89d');
 addRamp(scene,ramps,2.5,4.8,6,4.7,-12,'x',1,'#b5cde0');
 addRamp(scene,ramps,2.4,5.4,2.2,0,-14.15,'z',1,'#e4b7c7');
 addRamp(scene,ramps,2.8,5.8,5,-21,-37.0,'z',1,'#e4b6a2');
 addRamp(scene,ramps,2.8,5.8,5,21,-37.0,'z',1,'#b8d1df');
 addRamp(scene,ramps,3.2,8,8,0,-65,'z',1,'#e6c18f');
 addRamp(scene,ramps,3.2,6,5,-38,-90,'z',1,'#e4b6a2');
 addRamp(scene,ramps,3.2,6,5,38,-90,'z',1,'#b8d1df');
 addRamp(scene,ramps,3.2,8,4,-24,-111,'z',1,'#d8bdd1');
 addRamp(scene,ramps,3.2,8,4,24,-111,'z',1,'#d8bdd1');
 addRamp(scene,ramps,3.6,8,6,-45,-134,'z',1,'#b6d0df');
 addRamp(scene,ramps,3.6,8,6,45,-134,'z',1,'#d3bddb');
 addRamp(scene,ramps,3.2,8,4,-25,-158,'z',1,'#e5c08f');
 addRamp(scene,ramps,3.2,8,4,25,-158,'z',1,'#b9d4c4');
 addBox('central-observation-deck',0,2.35,-11.25,5.8,.3,1.15,'#f0d1a4');
 addBox('central-observation-rail-west',-2.7,2.8,-11.25,.14,.9,1.05,'#fff0d9');
 addBox('central-observation-rail-east',2.7,2.8,-11.25,.14,.9,1.05,'#fff0d9');

 // A second-level bridge cuts across the rear alley. It is supported by
 // pastel columns and is reachable from the stepped hall route.
 addBox('sundae-bridge',0,3.0,-21.4,5.6,.32,1.25,'#e7b9ce');
 addBox('sundae-bridge-rail-west',-2.55,3.55,-21.4,.14,1.05,1.1,'#fff0df');
 addBox('sundae-bridge-rail-east',2.55,3.55,-21.4,.14,1.05,1.1,'#fff0df');
 addBox('sundae-bridge-pillar-west',-2.45,1.5,-21.4,.38,3,.38,'#c39caf');
 addBox('sundae-bridge-pillar-east',2.45,1.5,-21.4,.38,3,.38,'#c39caf');

 const stepCount=9,stepDepth=.48,stepHeight=.44;
 for(let index=0;index<stepCount;index+=1){
  const height=(index+1)*stepHeight;
  addBox(`sundae-stair-${index}`,0,height/2,-18.3-index*stepDepth,3,height,stepDepth,'#d8bdd1');
 }

 // A low catwalk crosses the back alley and gives the player a second sight
 // line without turning the park into one long open shooting lane.
 addBox('back-catwalk',0,2.55,-17.1,6.4,.35,1.2,'#f0c3d2');
 addBox('back-catwalk-pillar-west',-2.8,1.25,-17.1,.35,2.5,.35,'#c49caf');
 addBox('back-catwalk-pillar-east',2.8,1.25,-17.1,.35,2.5,.35,'#c49caf');

 // Cover pieces and short walls shape the central lanes and side alleys.
 addBox('plaza-cover-west',-3.9,.65,-1.8,2.1,1.3,1.2,'#c6a98e');
 addBox('plaza-cover-east',4.4,.55,-3.7,2.0,1.1,1.3,'#d5b58f');
 addBox('plaza-cover-center',0,.52,-7.4,3.4,1.04,.75,'#f1c3a8');
 addBox('alley-wall-west',-4.8,.8,-13.4,1.2,1.6,4.4,'#d5bd9f');
 addBox('alley-wall-east',5.1,.75,-7.6,1.1,1.5,3.6,'#c4b2d0');
 addBox('crate-stack-west',-12,.65,1.2,1.4,1.3,1.5,'#e6c27c');
 addBox('crate-stack-east',12,.55,-3.2,1.4,1.1,1.4,'#e7b8a8');
 addBox('crate-stack-back',7,.85,-20.5,1.5,1.7,1.4,'#e5ca8f');

 // Park dressing remains soft and colorful, but tree trunks and buildings
 // still provide meaningful line-of-sight breaks for the future AI stage.
 for(let index=0;index<10;index+=1){
  const side=index%2===0?-1:1;
  const x=side*(12.2+(index%3)*1.1);
  const z=9-Math.floor(index/2)*4.8;
  addBox(`tree-trunk-${index}`,x,1.2,z,.35,2.4,.35,'#af8d6d');
  addCloud(scene,x+.7*side,3.3,z,1.25,index%3?'#78a67e':'#91b687');
 }
 for(let index=0;index<16;index+=1){
  const side=index%2===0?-1:1;
  const x=side*(17+(index%5)*1.7);
  const z=22-Math.floor(index/2)*9;
  addBox(`outer-tree-trunk-${index}`,x,1.2,z,.35,2.4,.35,'#af8d6d');
  addCloud(scene,x+.7*side,3.3,z,1.35,index%3?'#78a67e':'#91b687');
 }
 for(let index=0;index<24;index+=1){
  const side=index%2===0?-1:1;
  const x=side*(59+(index%3)*2.4);
  const z=16-Math.floor(index/2)*12;
  addBox(`far-tree-trunk-${index}`,x,1.2,z,.35,2.4,.35,'#af8d6d');
  addCloud(scene,x+.7*side,3.3,z,1.45,index%3?'#78a67e':'#91b687');
 }
 for(let index=0;index<14;index+=1)addCloud(scene,(index-7)*7,14+(index%3)*2,-38-(index%5)*6,2.5,'#edf3df');
 for(let index=0;index<20;index+=1)addCloud(scene,(index-10)*8,16+(index%4)*2,-72-(index%6)*12,3,'#edf3df');

 const groundHeightAt=(x:number,z:number,footY:number)=>{
  let best=0;
  for(const ramp of ramps){
   const height=rampHeight(ramp,x,z);
   if(height!==null&&Math.abs(height-footY)<=.66)best=Math.max(best,height);
  }
  for(const collider of colliders){
   const {box}=collider;
   if(x<box.min.x-.02||x>box.max.x+.02||z<box.min.z-.02||z>box.max.z+.02)continue;
   if(box.min.y>footY+1.8)continue;
   if(box.max.y-footY<=STEP_HEIGHT+.08)best=Math.max(best,box.max.y);
  }
  return best;
 };

 const surfaceBelow=(x:number,z:number,topY:number)=>{
  let best=0;
  for(const ramp of ramps){
   const height=rampHeight(ramp,x,z);
   if(height!==null&&height<=topY+.06)best=Math.max(best,height);
  }
  for(const collider of colliders){
   const {box}=collider;
   if(x<box.min.x-.02||x>box.max.x+.02||z<box.min.z-.02||z>box.max.z+.02)continue;
   if(box.max.y<=topY+.06&&box.max.y>best)best=box.max.y;
  }
  return best;
 };

 const canOccupy=(x:number,z:number,footY:number,radius:number,height:number)=>{
  for(const collider of colliders){
   const {box}=collider;
   if(x+radius<=box.min.x||x-radius>=box.max.x||z+radius<=box.min.z||z-radius>=box.max.z)continue;
   if(footY+height<=box.min.y+.02||footY>=box.max.y-.08)continue;
   if(box.max.y-footY<=STEP_HEIGHT+.04)continue;
   return false;
  }
  return x>MAP_MIN_X+.6&&x<MAP_MAX_X-.6&&z>MAP_MIN_Z+.6&&z<MAP_MAX_Z-.6;
 };

 return {obstacles,colliders,groundHeightAt,surfaceBelow,canOccupy};
}
