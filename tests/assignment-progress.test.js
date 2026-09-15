const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function runtime() {
 const values = new Map();
 const storage = {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i],get length(){return values.size;}};
 const window = {};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assignment-progress.js'),'utf8'),{window,localStorage:storage});
 return {api:window.AssignmentProgress,storage};
}
const draft = {title:'Homework',items:[{id:'q1',question:'Q',answer:'A'}],results:[],answers:[],draft:'A'};
test('checkpoints survive reload and isolate students, assignments and retries',()=>{
 const {api}=runtime();
 assert.equal(api.save('alice','one','first',draft),true);
 assert.equal(api.read('alice','one').draft,'A');
 assert.equal(api.read('bob','one'),null);
 assert.equal(api.read('alice','two'),null);
 assert.equal(api.read('alice','one','all'),null);
 assert.equal(api.list('alice').length,1);
 assert.equal(api.list('bob').length,0);
 api.remove('alice','one','first'); assert.equal(api.read('alice','one'),null);
});
test('changed assignment content and incomplete answer records cannot resume',()=>{
 const {api}=runtime(); api.save('alice','one','first',draft);
 const saved=api.read('alice','one');
 assert.equal(api.matches(saved,draft.items),true);
 assert.equal(api.matches(saved,[{...draft.items[0],answer:'Changed'}]),false);
 api.save('alice','one','first',{...draft,results:[true]});
 assert.equal(api.read('alice','one'),null);
});
test('storage failures report failure without deleting the prior checkpoint',()=>{
 const {api,storage}=runtime(); api.save('alice','one','first',draft);
 storage.setItem=()=>{throw Error('Quota exceeded');};
 assert.equal(api.save('alice','one','first',{...draft,draft:'new'}),false);
 assert.equal(api.read('alice','one').draft,'A');
});
