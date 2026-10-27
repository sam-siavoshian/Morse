import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenshotClip} from '../daemon/screenshot.js';
test('Spotify at 83% zoom: crop follows the actual player instead of blank space below it', () => {
  const clip = screenshotClip({x:480,y:960,width:640,height:64,scrollX:0,scrollY:0,dpr:5/3,scale:1},{cssVisualViewport:{zoom:5/6}});
  assert.equal(clip.x,400);assert.equal(clip.y,800);assert.equal(clip.width,640*5/6);assert.equal(clip.scale,0.6);
});
test('Retina and scrolled documents keep screenshot bounds and output size', () => {
  const clip = screenshotClip({x:10,y:20,width:1000,height:800,scrollX:30,scrollY:200,dpr:2,scale:0.8},{cssVisualViewport:{zoom:1}});
  assert.deepEqual(clip,{x:40,y:220,width:1000,height:800,scale:0.4});
});
test('older hosts without zoom metrics retain the normal clip', () => {
  assert.deepEqual(screenshotClip({x:1,y:2,width:300,height:200}),{x:1,y:2,width:300,height:200,scale:1});
});
