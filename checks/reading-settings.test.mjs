import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, SETTINGS_KEY, validateSettings, loadSettings, saveSettings, READING_PALETTES } from '../src/lib/reading-settings.ts';
test('settings accept only version, supported size and manual theme', () => {
  for (const value of [null, {}, [], {version:2,theme:'dark',fontSize:18}, {version:1,theme:'system',fontSize:18}, {version:1,theme:'light',fontSize:17}, {version:1,theme:'light',fontSize:'28'}, {version:1,theme:'light',fontSize:30}]) assert.deepEqual(validateSettings(value), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings({ version:1,theme:'sepia',fontSize:28,secret:'discard' }), {version:1,theme:'sepia',fontSize:28});
  assert.deepEqual(loadSettings({getItem:()=>'{broken'}), {settings:DEFAULT_SETTINGS,available:true});
});
test('storage failures retain usable defaults/session and serialization drops foreign fields', () => {
  assert.equal(loadSettings(null).available, false);
  assert.equal(loadSettings({getItem:()=>{throw Error('blocked');}}).available, false);
  assert.equal(saveSettings({setItem:()=>{throw Error('full');}}, DEFAULT_SETTINGS), false);
  let saved;
  assert.equal(saveSettings({setItem:(key,value)=>{assert.equal(key,SETTINGS_KEY);saved=value;}}, {...DEFAULT_SETTINGS,extra:'discard'}), true);
  assert.deepEqual(JSON.parse(saved),DEFAULT_SETTINGS);
});
const luminance = hex => hex.match(/\w\w/g).map(value=>parseInt(value,16)/255).map(value=>value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0);
test('theme text, status, link and error colors exceed 4.5:1 on both surfaces', () => {
  for (const [name,palette] of Object.entries(READING_PALETTES)) for (const ink of ['text','muted','link','error']) for (const background of ['background','surface']) {
    const a=luminance(palette[ink].slice(1)), b=luminance(palette[background].slice(1));
    assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${name} ${ink}/${background}`);
  }
});
