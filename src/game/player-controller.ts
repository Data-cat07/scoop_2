import * as T from 'three';
import type {ScoopMap} from './map';

export type MovementInput={
 forward:boolean;
 back:boolean;
 left:boolean;
 right:boolean;
 jump:boolean;
 sprint:boolean;
 slide:boolean;
};

export class PlayerController{
 readonly eyeHeight=1.7;
 readonly slideEyeHeight=.94;
 readonly radius=.34;
 readonly height=1.72;
 readonly slideHeight=1.05;
 readonly walkSpeed=6.2;
 readonly sprintSpeed=10.5;
 readonly slideSpeed=15;
 readonly jumpSpeed=7.4;
 readonly gravity=19;
 readonly slideDuration=.72;
 private velocityY=0;
 private grounded=false;
 private jumpHeld=false;
 private coyoteTime=0;
 private jumpBuffer=0;
 private slideTimer=0;
 private slideCooldown=0;
 private slideHeld=false;
 private currentEyeHeight=this.eyeHeight;
 private slideDirection=new T.Vector2(0,1);

 constructor(private camera:T.PerspectiveCamera,private map:ScoopMap){}

 reset(position:T.Vector3){
  this.camera.position.copy(position);
  const footY=this.map.groundHeightAt(position.x,position.z,0);
  this.currentEyeHeight=this.eyeHeight;
  this.camera.position.y=footY+this.currentEyeHeight;
  this.velocityY=0;
  this.grounded=true;
  this.jumpHeld=false;
  this.coyoteTime=.12;
  this.jumpBuffer=0;
  this.slideTimer=0;
  this.slideCooldown=0;
  this.slideHeld=false;
 }

 update(dt:number,input:MovementInput,yaw:number){
  const step=Math.min(dt,.08);
  this.slideCooldown=Math.max(0,this.slideCooldown-step);
  const footBefore=this.camera.position.y-this.currentEyeHeight;
  const support=this.map.groundHeightAt(this.camera.position.x,this.camera.position.z,footBefore);
  if(this.velocityY<=0&&Math.abs(footBefore-support)<=.10){
   this.grounded=true;
   this.coyoteTime=.12;
  }else{
   this.grounded=false;
   this.coyoteTime=Math.max(0,this.coyoteTime-step);
  }

  const jumpPressed=input.jump&&!this.jumpHeld;
  if(jumpPressed)this.jumpBuffer=.12;
  else this.jumpBuffer=Math.max(0,this.jumpBuffer-step);
  this.jumpHeld=input.jump;
  if(this.jumpBuffer>0&&(this.grounded||this.coyoteTime>0)){
   this.velocityY=this.jumpSpeed;
   this.grounded=false;
   this.coyoteTime=0;
   this.jumpBuffer=0;
   this.slideTimer=0;
  }

  let moveX=Number(input.right)-Number(input.left);
  let moveZ=Number(input.back)-Number(input.forward);
  const length=Math.hypot(moveX,moveZ);
  if(length>0){
   moveX/=length;moveZ/=length;
  }
  const slidePressed=input.slide&&!this.slideHeld;
  if(slidePressed&&this.grounded&&this.velocityY<=0&&length>0&&this.slideCooldown===0){
   this.slideTimer=this.slideDuration;
   this.slideCooldown=.12;
   this.slideDirection.set(
    moveX*Math.cos(yaw)+moveZ*Math.sin(yaw),
    -moveX*Math.sin(yaw)+moveZ*Math.cos(yaw),
   ).normalize();
  }
  this.slideHeld=input.slide;
  this.slideTimer=Math.max(0,this.slideTimer-step);

  const wantsSlide=this.slideTimer>0;
  const canStand=this.map.canOccupy(this.camera.position.x,this.camera.position.z,footBefore,this.radius,this.height);
  const sliding=wantsSlide||!canStand;
  const targetEyeHeight=sliding?this.slideEyeHeight:this.eyeHeight;
  const eyeStep=sliding?Math.min(1,step/.12):Math.min(1,step/.18);
  this.currentEyeHeight=T.MathUtils.lerp(this.currentEyeHeight,targetEyeHeight,eyeStep);

  if(sliding){
   const slideProgress=this.slideTimer/this.slideDuration;
   const speed=T.MathUtils.lerp(this.sprintSpeed+.8,this.slideSpeed,slideProgress);
   const dx=this.slideDirection.x*speed*step;
   const dz=this.slideDirection.y*speed*step;
   const currentFoot=footBefore;
   if(this.map.canOccupy(this.camera.position.x+dx,this.camera.position.z,currentFoot,this.radius,this.slideHeight))this.camera.position.x+=dx;
   if(this.map.canOccupy(this.camera.position.x,this.camera.position.z+dz,currentFoot,this.radius,this.slideHeight))this.camera.position.z+=dz;
  }else if(length>0){
   const speed=input.sprint?this.sprintSpeed:this.walkSpeed;
   const dx=(moveX*Math.cos(yaw)+moveZ*Math.sin(yaw))*speed*step;
   const dz=(-moveX*Math.sin(yaw)+moveZ*Math.cos(yaw))*speed*step;
   const currentFoot=footBefore;
   if(this.map.canOccupy(this.camera.position.x+dx,this.camera.position.z,currentFoot,this.radius,this.height))this.camera.position.x+=dx;
   if(this.map.canOccupy(this.camera.position.x,this.camera.position.z+dz,currentFoot,this.radius,this.height))this.camera.position.z+=dz;
  }

  const nextVelocity=this.velocityY-this.gravity*step;
  const nextFoot=footBefore+nextVelocity*step;
  const nextSupport=this.map.groundHeightAt(this.camera.position.x,this.camera.position.z,footBefore);
  const landing=this.map.surfaceBelow(this.camera.position.x,this.camera.position.z,Math.max(footBefore,nextFoot)+.05);
  if(nextVelocity<=0&&landing!==null&&nextFoot<=landing&&footBefore>=landing-.65){
   this.camera.position.y=landing+this.currentEyeHeight;
   this.velocityY=0;
   this.grounded=true;
  }else if(nextVelocity<=0&&nextFoot<=nextSupport+.06&&Math.abs(footBefore-nextSupport)<=.72){
   this.camera.position.y=nextSupport+this.currentEyeHeight;
   this.velocityY=0;
   this.grounded=true;
  }else{
   this.camera.position.y=nextFoot+this.currentEyeHeight;
   this.velocityY=nextVelocity;
   this.grounded=false;
  }
 }
}
