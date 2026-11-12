import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createScoopMap} from '../src/game/map.ts';
import {PlayerController} from '../src/game/player-controller.ts';
import {chooseSpawnPointIndices,SPAWN_POINTS,TARGET_COUNT} from '../src/game/spawn-points.ts';

const idle={forward:false,back:false,left:false,right:false,jump:false,sprint:false,slide:false};

test('Scoop Park exposes solid buildings, rooftop ramps and cover',()=>{
 const map=createScoopMap(new T.Scene());
 assert.ok(map.obstacles.length>=20);
 assert.ok(map.colliders.some(item=>item.name==='waffle-depot'));
 assert.ok(map.colliders.some(item=>item.name==='central-observation-deck'));
 assert.ok(map.colliders.some(item=>item.name==='sundae-bridge'));
 assert.ok(map.colliders.some(item=>item.name==='sugar-factory-west'));
 assert.ok(map.colliders.some(item=>item.name==='sugar-tower'));
 assert.ok(map.colliders.some(item=>item.name==='rail-hub-west'));
 assert.ok(map.colliders.some(item=>item.name==='back-dock-east'));
 assert.equal(map.canOccupy(0,7,0,.34,1.72),true);
 assert.equal(map.canOccupy(28,20,0,.34,1.72),true);
 assert.equal(map.canOccupy(74,20,0,.34,1.72),true);
 assert.equal(map.canOccupy(75,20,0,.34,1.72),false);
 assert.equal(map.canOccupy(0,-169,0,.34,1.72),true);
 assert.equal(map.canOccupy(0,-170,0,.34,1.72),false);
 assert.equal(map.canOccupy(-9,-6,0,.34,1.72),false);
 assert.ok((map.surfaceBelow(-9,-12.25,5)??0)>2);
 assert.ok((map.surfaceBelow(0,-65,8)??0)>3.5);
 assert.ok((map.surfaceBelow(-45,-130,6)??0)>5.5);
});

test('first-person controller jumps, runs, slides and stops at the park boundary',()=>{
 const map=createScoopMap(new T.Scene());
 const camera=new T.PerspectiveCamera();
 const controller=new PlayerController(camera,map);
 controller.reset(new T.Vector3(0,1.7,7));
 assert.equal(camera.position.y,1.7);

 controller.update(.1,{...idle,forward:true},0);
 const walkedDistance=7-camera.position.z;
 controller.reset(new T.Vector3(0,1.7,7));
 controller.update(.1,{...idle,forward:true,sprint:true},0);
 const sprintDistance=7-camera.position.z;
 assert.ok(sprintDistance>walkedDistance*1.5);

 controller.reset(new T.Vector3(0,1.7,7));
 controller.update(.016,{...idle,jump:true},0);
 assert.ok(camera.position.y>1.7);
 let highest=camera.position.y;
 for(let index=0;index<120;index+=1){
  controller.update(.016,idle,0);
  highest=Math.max(highest,camera.position.y);
 }
 assert.ok(highest>2.5);
 assert.ok(Math.abs(camera.position.y-1.7)<.05);

 controller.reset(new T.Vector3(0,1.7,7));
 controller.update(.1,{...idle,forward:true,slide:true},0);
 assert.ok(camera.position.y<1.7);
 assert.ok(7-camera.position.z>sprintDistance);

 controller.reset(new T.Vector3(-73,1.7,20));
 for(let index=0;index<30;index+=1)controller.update(.05,{...idle,left:true,sprint:true},0);
 assert.ok(camera.position.x<-73);
 assert.ok(camera.position.x>-74.4);
});

test('target spawn points cover separate districts of the enlarged park',()=>{
 const indices=chooseSpawnPointIndices(TARGET_COUNT,()=>0);
 const zones=new Set(indices.map(index=>SPAWN_POINTS[index].zone));
 assert.equal(TARGET_COUNT,10);
 assert.equal(indices.length,TARGET_COUNT);
 assert.equal(zones.size,5);
 assert.ok(Math.min(...indices.map(index=>SPAWN_POINTS[index].z))<-100);
 assert.ok(Math.max(...indices.map(index=>SPAWN_POINTS[index].x))>30);
 assert.ok(Math.min(...indices.map(index=>SPAWN_POINTS[index].x))<-30);
});
