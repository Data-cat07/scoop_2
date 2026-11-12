export type SpawnZone='central'|'mid'|'west'|'east'|'back';

export type SpawnPoint={
 x:number;
 z:number;
 zone:SpawnZone;
};

export const TARGET_COUNT=10;

// Ground-level points are deliberately distributed across the full park. The
// later AI stage can add roof-specific points without changing this contract.
export const SPAWN_POINTS:readonly SpawnPoint[]=[
 {x:-6,z:-5,zone:'central'},{x:0,z:-5,zone:'central'},{x:6,z:-6,zone:'central'},
 {x:0,z:-14,zone:'central'},{x:7,z:-17,zone:'central'},
 {x:-20,z:-30,zone:'mid'},{x:20,z:-30,zone:'mid'},{x:-20,z:-45,zone:'mid'},
 {x:20,z:-45,zone:'mid'},{x:0,z:-75,zone:'mid'},
 {x:-40,z:-65,zone:'west'},{x:-40,z:-95,zone:'west'},
 {x:-55,z:-112,zone:'west'},{x:-55,z:-140,zone:'west'},
 {x:40,z:-65,zone:'east'},{x:40,z:-95,zone:'east'},
 {x:55,z:-112,zone:'east'},{x:55,z:-140,zone:'east'},
 {x:-12,z:-95,zone:'mid'},{x:12,z:-95,zone:'mid'},
 {x:0,z:-120,zone:'back'},{x:-20,z:-158,zone:'back'},
 {x:20,z:-158,zone:'back'},{x:0,z:-165,zone:'back'},
];

const ZONE_ORDER:SpawnZone[]=['central','mid','west','east','back'];

export function chooseSpawnPointIndices(count:number,random=Math.random){
 const selected:number[]=[];
 const used=new Set<number>();
 const choose=(candidates:number[])=>{
  if(!candidates.length)return;
  const offset=Math.min(candidates.length-1,Math.max(0,Math.floor(random()*candidates.length)));
  const index=candidates[offset];
  selected.push(index);used.add(index);
 };

 for(const zone of ZONE_ORDER){
  if(selected.length>=count)break;
  choose(SPAWN_POINTS.map((point,index)=>({point,index})).filter(item=>item.point.zone===zone&&!used.has(item.index)).map(item=>item.index));
 }
 while(selected.length<count&&selected.length<SPAWN_POINTS.length){
  choose(SPAWN_POINTS.map((_,index)=>index).filter(index=>!used.has(index)));
 }
 return selected;
}
