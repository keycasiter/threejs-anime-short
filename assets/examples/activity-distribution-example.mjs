import {compileWorldLayout} from '../scene/world-layout.mjs';
import {allocateActivityGroups} from '../scene/activity-distribution.mjs';

const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];

/** Runnable multi-zone example; footprints stand in for upstream measured envelopes. */
export function createActivityDistributionExample(){
 const layout=compileWorldLayout({
  levels:[{id:'ground',y:0,nodes:[],edges:[]}],
  regions:[{id:'public-zone',level:'ground',role:'public',outline:rect(-12,-8,12,8)}]
 });
 return allocateActivityGroups({layout,groups:[
  {id:'primary-destination',priority:100,candidates:[
   {id:'candidate-a',payload:{frame:{origin:[-2,0],yawRadians:0},memberIds:['member-a','member-b']},footprints:[{id:'group-envelope',level:'ground',regionId:'public-zone',polygon:rect(-5,-3,1,3),minY:0,maxY:3,clearance:.5}]},
   {id:'candidate-b',footprints:[{id:'group-envelope',level:'ground',regionId:'public-zone',polygon:rect(2,-3,8,3),minY:0,maxY:3,clearance:.5}]}
  ]},
  {id:'secondary-destination',priority:20,candidates:[
   {id:'candidate-c',footprints:[{id:'group-envelope',level:'ground',regionId:'public-zone',polygon:rect(6,-2,10,2),minY:0,maxY:2.4,clearance:.35}]}
  ]}
 ]});
}
