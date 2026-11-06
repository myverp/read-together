import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionAnchor, selectionToolbarPosition } from '../src/lib/selection-anchor.ts';

const rect = (left, top, right, bottom) => ({left,top,right,bottom,width:right-left,height:bottom-top});
test('selection caret maps a translated column iframe into the parent viewport', () => {
  const endpoint = rect(1240,100,1240,130), node = {};
  const range = {cloneRange:()=>({setStart(){},collapse(){},getClientRects:()=>[endpoint]})};
  const selected = {rangeCount:1,focusNode:node,focusOffset:42,getRangeAt:()=>range};
  const frame = {clientWidth:2000,clientHeight:600,getBoundingClientRect:()=>rect(-1000,60,1000,660)};
  assert.deepEqual(selectionAnchor(selected,frame,rect(20,60,380,660)),{left:240,right:240,top:160,bottom:190});
});
test('missing caret rect uses the visible range end and follows reverse selection', () => {
  const node = {}, range = {startContainer:node,startOffset:0,cloneRange:()=>({setStart(){},collapse(){},getClientRects:()=>[]}),getClientRects:()=>[rect(-200,30,-100,60),rect(30,60,200,90),rect(30,90,120,120)]};
  const selected = {rangeCount:1,focusNode:node,focusOffset:100,getRangeAt:()=>range};
  const frame = {clientWidth:400,clientHeight:600,getBoundingClientRect:()=>rect(0,40,400,640)};
  const clip=rect(0,40,400,640);
  assert.deepEqual(selectionAnchor(selected,frame,clip),{left:120,right:120,top:130,bottom:160});
  selected.focusOffset=0;
  assert.deepEqual(selectionAnchor(selected,frame,clip),{left:30,right:30,top:100,bottom:130});
});
test('toolbar stays near the endpoint and flips above near the bottom edge', () => {
  const bounds=rect(20,60,380,660);
  assert.deepEqual(selectionToolbarPosition(rect(200,100,200,130),bounds,96,52),{left:152,top:146});
  assert.deepEqual(selectionToolbarPosition(rect(375,600,375,630),bounds,96,52),{left:276,top:532});
  assert.deepEqual(selectionToolbarPosition(rect(21,61,21,91),bounds,96,52),{left:28,top:107});
});
test('a caret wrapped into the next clipped column falls back to the visible selection end', () => {
  const node={},range={startContainer:node,startOffset:0,cloneRange:()=>({setStart(){},collapse(){},getClientRects:()=>[rect(500,10,500,40)]}),getClientRects:()=>[rect(20,500,180,530)]};
  const selected={rangeCount:1,focusNode:node,focusOffset:115,getRangeAt:()=>range};
  const frame={clientWidth:800,clientHeight:600,getBoundingClientRect:()=>rect(0,0,800,600)};
  assert.deepEqual(selectionAnchor(selected,frame,rect(0,0,400,600)),{left:180,right:180,top:500,bottom:530});
});
