import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const db=new DatabaseSync(':memory:');
for(const name of ['0001_store.sql','0002_write_guards.sql'])db.exec(readFileSync('cloudflare/migrations/'+name,'utf8'));
const DB={
 prepare(sql){return {bind(...args){const q=db.prepare(sql);return {first:async()=>q.get(...args),all:async()=>({results:q.all(...args)}),run:async()=>q.run(...args)};}};},
 async batch(ops){db.exec('BEGIN');try{for(const op of ops)await op.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
};
const env={DB,AURELLA_ADMIN_PASSWORD:'test-only-password',ASSETS:{fetch:()=>new Response('<html>Store admin</html>')}};
let cookie='';
async function call(path,body,auth=true){
 const res=await worker.fetch(new Request('https://aurella.test'+path,{method:body?'POST':'GET',headers:auth?{cookie}:{},body:body?JSON.stringify(body):undefined}),env);
 if(res.headers.has('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
 return [res.status,res.headers.get('content-type')?.includes('json')?await res.json():await res.text()];
}
assert.equal((await call('/admin'))[0],200);
assert.equal((await call('/api/admin/data'))[0],401);
assert.equal((await call('/api/admin/login',{password:env.AURELLA_ADMIN_PASSWORD}))[0],200);
assert.equal((await call('/api/admin/data'))[1].settings.name,'Aurélla');
const [status,p]=await call('/api/admin/product',{name:'Test',brand:'Demo',category:'Serums',status:'published',photos:[],variants:[{label:'30 ml',sku:'TEST1',price:1000,stock:1}]});
assert.equal(status,200);
const input={reference:crypto.randomUUID(),name:'Test User',email:'test@example.com',phone:'0771234567',address:'Test address',region:'Colombo',method:'test',items:[{product:p.id,variant:p.variants[0].id,qty:1,price:1000}]};
const [placed,order]=await call('/api/order',input,false);
assert.equal(placed,201);
assert.equal((await call('/api/order',input,false))[1].invoice,order.invoice);
assert.equal((await call('/api/order',{...input,reference:crypto.randomUUID()},false))[0],409);
assert.equal((await call('/api/admin/order',{id:order.id,status:'Dispatched'}))[0],200);
const [,tracking]=await call('/api/track/'+order.tracking,null,false);
assert.equal(tracking.status,'Dispatched');
assert.equal(tracking.customer,undefined);
console.log('Worker smoke passed: admin auth, product creation, order, idempotency, stock, fulfillment and private tracking.');

