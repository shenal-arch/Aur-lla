import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, timingSafeEqual, createHash} from 'node:crypto';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = new URL('./', import.meta.url);
await mkdir(new URL('data/',root),{recursive:true});
const db = new DatabaseSync(fileURLToPath(new URL('data/store.sqlite',root)));
export const closeDatabase = () => db.close();
db.exec(`CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, body TEXT);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, body TEXT);
CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY, mime TEXT, bytes BLOB);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY, body TEXT);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, expires INTEGER);`);
const defaults = {name:'Aurélla',currency:'LKR',contact:'',regions:[{name:'Colombo',fee:450,cod:false},{name:'Other districts',fee:650,cod:false}],test:true,delivery:'Delivery and return policies will be confirmed before launch.',privacy:'This preview stores test order details locally.'};
const get = (table,id) => JSON.parse(db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id)?.body || 'null');
const all = table => db.prepare(`SELECT body FROM ${table} ORDER BY rowid DESC`).all().map(row=>JSON.parse(row.body));
const save = (table,id,value) => db.prepare(`INSERT INTO ${table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`).run(id,JSON.stringify(value));
const config = () => get('settings',1) || defaults;
const id = () => randomBytes(16).toString('hex');
const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
const clean = (x,max=1000) => typeof x==='string' ? x.trim().slice(0,max) : '';
const money = x => Number.isSafeInteger(x) && x>=0 && x<=100000000;
const validPrice = x => typeof x==='number' && Number.isFinite(x) && x>0 && x<=100000000 && Math.abs(x*100-Math.round(x*100))<0.000001;
const tags = x => clean(x).split(',').map(t=>t.trim()).filter(Boolean).join(', ');
const sessions = new Map();
const digest = value=>createHash('sha256').update(value).digest();
const password = process.env.AURELLA_ADMIN_PASSWORD;
const port = Number(process.env.PORT || 4173);
const secure = process.env.AURELLA_SECURE_COOKIES==='1';

function product(input, key) {
  const fields = ['name','brand','category','description','skin','concern','keyIngredients','ingredients','usage','warnings'];
  const p = Object.fromEntries(fields.map(f=>[f,clean(input[f],5000)]));
  if(!p.name || !p.brand || !p.category) fail('Name, brand and category are required.');
  if(!['draft','published','archived'].includes(input.status)) fail('Choose a publication status.');
  p.id=key;
  p.status=input.status;
  p.featured=input.featured===true;
  for(const f of ['skin','concern','keyIngredients']) p[f]=tags(p[f]);
  if(!Array.isArray(input.photos)||input.photos.length>12) fail('Use up to 12 photos.');
  p.photos=input.photos.map(photo=>{
    if(!db.prepare('SELECT id FROM images WHERE id=?').get(String(photo.id))) fail('Upload the photo before saving.');
    return {id:photo.id,alt:clean(photo.alt,180)};
  });
  if(!Array.isArray(input.variants)||!input.variants.length||input.variants.length>40) fail('Add 1 to 40 variants.');
  const previous=get('products',key);
  if(previous?.sourceUrl){
    p.sourceUrl=previous.sourceUrl;
    p.referencePrice=previous.referencePrice;
    p.sourceImages=previous.sourceImages;
    p.priceFrom=previous.priceFrom;
  }
  if(previous && (previous.revision||0)!==(input.revision||0)) fail('This product changed. Reopen it before saving.',409);
  p.revision=(previous?.revision||0)+1;
  p.variants=input.variants.map(v=>{
    const sku=clean(v.sku,60);
    const label=clean(v.label,80);
    if(!sku||!label||!validPrice(v.price)||!money(v.stock)) fail('Each variant needs a label, SKU, positive price with up to two decimals and whole stock quantity.');
    return {id:previous?.variants.some(old=>old.id===v.id)?v.id:id(),sku,label,price:v.price,stock:v.stock,swatch:/^#[0-9a-f]{6}$/i.test(v.swatch)?v.swatch:'',photo:p.photos.some(photo=>photo.id===v.photo)?v.photo:''};
  });
  const existing=all('products').filter(item=>item.id!==key).flatMap(item=>item.variants.map(v=>v.sku.toLowerCase()));
  const skus=p.variants.map(v=>v.sku.toLowerCase());
  if(new Set(skus).size!==skus.length||skus.some(s=>existing.includes(s))) fail('Each SKU must be unique.');
  if(new Set(p.variants.map(v=>v.id)).size!==p.variants.length) fail('Duplicate variant.');
  return p;
}

const stages=['Order received','Ready to dispatch','Dispatched','Order completed'];
const legacy={Received:stages[0],Preparing:stages[1],Delivered:stages[3]};
const payment=o=>o.method==='cod'?(o.paid?'Paid':'Awaiting cash on delivery'):'Test order — no payment collected';
const summary=o=>({id:o.id,invoice:o.invoice,tracking:o.tracking,status:legacy[o.status]||o.status,payment:payment(o),total:o.total,currency:o.currency});
let sending=false;
async function sendPending(){
 if(sending||!process.env.RESEND_API_KEY||!process.env.AURELLA_EMAIL_FROM||!process.env.AURELLA_PUBLIC_URL)return;
 sending=true;
 try{
 for(const o of all('orders')){
  if(!o.mail)continue;
  for(const kind of ['merchant','customer']){
   if(o.mail[kind]==='sent')continue;
   try{
    const link=new URL('/track/'+o.tracking,process.env.AURELLA_PUBLIC_URL).href;
    const lines=o.items.map(i=>i.name+' / '+i.variant+' × '+i.qty+' — '+o.currency+' '+(i.price*i.qty).toFixed(2));
    const body=[o.invoice,payment(o),...lines,'Delivery: '+o.currency+' '+o.delivery.toFixed(2),'Total: '+o.currency+' '+o.total.toFixed(2),'Amount paid: '+o.currency+' '+(o.paid?o.total:0).toFixed(2),'Track order: '+link];
    if(kind==='merchant')body.push(o.customer.name,o.customer.email,o.customer.phone,o.customer.address,o.region);
    const response=await fetch('https://api.resend.com/emails',{
     method:'POST',signal:AbortSignal.timeout(10000),
     headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':o.id+'/'+kind},
     body:JSON.stringify({from:process.env.AURELLA_EMAIL_FROM,to:[kind==='merchant'?'shenalrdemel@gmail.com':o.customer.email],subject:'Aurélla '+o.invoice+' — '+(kind==='merchant'?'New order':'Order confirmation'),text:body.join('\n')})
    });
    if(!response.ok)throw Error('Email provider HTTP '+response.status);
    const latest=get('orders',o.id);latest.mail[kind]='sent';save('orders',o.id,latest);
   }catch(error){console.error('Order email pending',o.invoice,kind,error.message);}
  }
 }
 }finally{sending=false;}
}
function order(input){
  const c=config();
  const region=c.regions.find(r=>r.name===input.region);
  if(!region || (c.test?input.method!=='test':input.method!=='cod'||!region.cod)) fail('Choose an available delivery region and payment method.');
  const customer=Object.fromEntries(['name','phone','address','email'].map(k=>[k,clean(input[k],300)]));
  if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(customer.email)) fail('Enter a valid email address.');
  if(!customer.name||!customer.address||!/^\+?[\d ()-]{7,24}$/.test(customer.phone)) fail('Enter your name, a valid phone number and delivery address.');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>100) fail('Your cart is empty or too large.');
  if(!/^[a-f0-9-]{36}$/.test(input.reference||'')) fail('Invalid checkout reference.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=get('orders',input.reference);
    if(existing){
      if(JSON.stringify(customer)!==JSON.stringify(existing.customer)) fail('Checkout reference was already used.',409);
      db.exec('COMMIT');
      return summary(existing);
    }
    const products=new Map();
    const items=input.items.map(line=>{
      let p=products.get(line.product)||get('products',String(line.product));
      const v=p?.variants.find(option=>option.id===line.variant);
      if(p?.status!=='published'||!v||!Number.isSafeInteger(line.qty)||line.qty<1||v.stock<line.qty) fail('An item is no longer available in the requested quantity.',409);
      if(v.price!==line.price) fail('A price changed. Review your cart and try again.',409);
      v.stock-=line.qty;
      products.set(p.id,p);
      return {product:p.id,name:p.name,brand:p.brand,variant:v.label,sku:v.sku,price:v.price,qty:line.qty};
    });
    const subtotalMinor=items.reduce((sum,line)=>sum+Math.round(line.price*100)*line.qty,0);
    if(!Number.isSafeInteger(subtotalMinor+region.fee*100)) fail('Order total is too large.');
    const subtotal=subtotalMinor/100;
    const record={id:input.reference,customer,items,region:region.name,method:input.method,subtotal,delivery:region.fee,total:subtotal+region.fee,currency:c.currency,invoice:'AUR-'+id().toUpperCase(),tracking:id(),mail:{merchant:'pending',customer:'pending'},status:stages[0],created:new Date().toISOString()};
    for(const [key,p] of products){p.revision=(p.revision||0)+1;save('products',key,p);}
    save('orders',record.id,record);
    db.exec('COMMIT');
    return summary(record);
  } catch(error){db.exec('ROLLBACK');throw error;}
}

const mime = {'/app.js':'text/javascript','/style.css':'text/css','/':'text/html'};
const pages = /^\/(?:shop|cart|checkout|admin|contact|delivery|privacy|track\/[a-f0-9]{32}|product\/[a-z0-9-]+)?$/;
export async function handleRequest(req,res){
  const send=(status,payload,type='application/json')=>{
    res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"});
    res.end(type==='application/json'?JSON.stringify(payload):payload);
  };
  try {
    const {pathname:path}=new URL(req.url,'http://localhost');
    const method=req.method;
    const token=req.headers.cookie?.match(/(?:^|;\s*)aurella=([a-f0-9]{32})(?:;|$)/)?.[1];
    const admin=token && db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(token,Date.now());
    const body=async (limit=6_000_000)=>{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>limit) fail('Upload is too large.',413);chunks.push(chunk);}
      return Buffer.concat(chunks);
    };
    const json=async()=>{try{return JSON.parse(await body(200_000));}catch(e){if(e.status)throw e;fail('Invalid request.');}};
    if(!['GET','HEAD'].includes(method)&&req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) fail('Request rejected.',403);
    if(method==='GET'&&path==='/api/catalog')return send(200,{settings:config(),products:all('products').filter(p=>p.status==='published')});
    if(method==='POST'&&path==='/api/order')return send(201,order(await json()));
    if(method==='GET'&&/^\/api\/track\/[a-f0-9]{32}$/.test(path)){
      const record=db.prepare("SELECT body FROM orders WHERE json_extract(body, '$.tracking')=?").get(path.split('/').pop());
      if(!record)fail('Order unavailable.',404);
      const o=JSON.parse(record.body);
      return send(200,{invoice:o.invoice,status:legacy[o.status]||o.status,stages});
    }
    if(method==='GET'&&/^\/media\/[a-f0-9]{32}$/.test(path)){
      const key=path.split('/').pop();
      const visible=admin||all('products').some(p=>p.status==='published'&&p.photos.some(photo=>photo.id===key));
      const photo=visible&&db.prepare('SELECT mime,bytes FROM images WHERE id=?').get(key);
      if(!photo)fail('Photo unavailable.',404);
      return send(200,Buffer.from(photo.bytes),photo.mime);
    }
    if(path==='/api/admin/login'&&method==='POST'){
      if(!password||password.length<14)fail('Set an admin password of at least 14 characters on the server.',503);
      const source=req.socket.remoteAddress;
      const now=Date.now();
      const attempt=sessions.get(source)||{expires:0,count:0};
      if(now>attempt.expires){attempt.expires=now+60000;attempt.count=0;}
      if(++attempt.count>8)fail('Too many attempts. Try again in a minute.',429);
      sessions.set(source,attempt);
      const input=await json();
      if(!timingSafeEqual(digest(clean(input.password)),digest(password)))fail('Incorrect password.',401);
      const session=id();
      db.prepare('DELETE FROM sessions WHERE expires<=? OR id=?').run(now,token||'');
      db.prepare('INSERT INTO sessions VALUES (?,?)').run(session,now+8*3600000);
      res.setHeader('Set-Cookie',`aurella=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure?'; Secure':''}`);
      return send(200,{ok:true});
    }
    if(path.startsWith('/api/admin/')){
      if(!admin) fail('Sign in as the store administrator.',401);
      if(path==='/api/admin/logout'&&method==='POST'){
        db.prepare('DELETE FROM sessions WHERE id=?').run(token);
        res.setHeader('Set-Cookie','aurella=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
        return send(200,{ok:true});
      }
      if(path==='/api/admin/data'&&method==='GET')return send(200,{products:all('products'),orders:all('orders'),settings:config()});
      if(path==='/api/admin/photo'&&method==='POST'){
        const bytes=await body();
        const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
        const jpg=bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));
        const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
        if(!png&&!jpg&&!webp) fail('Upload a JPG, PNG or WebP image under 6 MB.');
        const key=id();
        db.prepare('INSERT INTO images VALUES (?,?,?)').run(key,png?'image/png':jpg?'image/jpeg':'image/webp',bytes);
        return send(201,{id:key});
      }
      if(path==='/api/admin/product'&&method==='POST'){
        const input=await json();
        const key=input.id||id();
        if(input.id&&!get('products',String(key)))fail('Product unavailable.',404);
        const p=product(input,key);
        save('products',key,p);
        return send(200,p);
      }
      if(path.startsWith('/api/admin/product/')&&method==='DELETE'){
        const key=path.split('/').pop();
        const p=get('products',key);
        if(!p)fail('Product unavailable.',404);
        const used=all('orders').some(o=>o.items.some(line=>line.product===key));
        if(used){p.status='archived';p.revision=(p.revision||0)+1;save('products',key,p);}
        else db.prepare('DELETE FROM products WHERE id=?').run(key);
        return send(200,{archived:used});
      }
      if(path==='/api/admin/settings'&&method==='POST'){
        const input=await json();
        const settings={name:clean(input.name,70),currency:clean(input.currency,3).toUpperCase(),contact:clean(input.contact),delivery:clean(input.delivery,5000),privacy:clean(input.privacy,5000),test:input.test!==false,regions:[]};
        if(!settings.name||! /^[A-Z]{3}$/.test(settings.currency))fail('Enter the store name and a three-letter currency.');
        if(!Array.isArray(input.regions)||!input.regions.length||input.regions.length>100)fail('Enter at least one delivery region.');
        settings.regions=input.regions.map(r=>{
          const name=clean(r.name,100);
          if(!name||!money(r.fee))fail('Each delivery region needs a name and a whole-unit fee.');
          return {name,fee:r.fee,cod:r.cod===true};
        });
        if(new Set(settings.regions.map(r=>r.name)).size!==settings.regions.length) fail('Delivery region names must be unique.');
        save('settings',1,settings);
        return send(200,settings);
      }
      if(path==='/api/admin/order'&&method==='POST'){
        const input=await json();
        const record=get('orders',String(input.id));
        if(!record||!stages.includes(input.status))fail('Choose a valid fulfillment status.');
        record.status=input.status;
        if(record.method==='cod') record.paid=input.paid===true;
        save('orders',record.id,record);
        return send(200,record);
      }
    }
    if(method==='GET' && /^\/skin\/(?:oily|normal|dry|sensitive|combination|aging|dryness|uneven|dark-spots|blemishes|dullness)\.jpg$/.test(path)){
      return send(200,await readFile(new URL(path.slice(1),root)),'image/jpeg');
    }
    if(method==='GET'&&(pages.test(path)||mime[path])){
      const name=mime[path]&&path!=='/'?path.slice(1):'index.html';
      return send(200,await readFile(new URL(name,root)),(mime[path]||mime['/'])+'; charset=utf-8');
    }
    fail('Page unavailable.',404);
  }catch(error){
    if(!error.status) console.error(error);
    if(!res.headersSent)send(error.status||500,{error:error.status?error.message:'The store could not complete that request.'});
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.includes('--import-cosmetics')){
    const imports=JSON.parse(await readFile(new URL('cosmetics-reference.json',root),'utf8'));
    const orderedIds=new Set(all('orders').flatMap(o=>o.items.map(line=>line.product)));
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const p of imports){
        if(!get('products',p.id) && !orderedIds.has(p.id)) save('products',p.id,p);
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(process.argv.includes('--seed-samples')){
    if(!config().test) throw new Error('Sample products require test mode.');
    const samples=JSON.parse(await readFile(new URL('sample-products.json',root),'utf8'));
    for(const p of samples){
      if(!get('products',p.id) && !all('orders').some(o=>o.items.some(line=>line.product===p.id))) save('products',p.id,p);
    }
  }
  if(process.argv.includes('--import-only')){
    console.log(`Imported reference catalog. ${all('products').filter(p=>p.sourceUrl).length} reference products are in the database.`);
    closeDatabase();
  }else{
    setInterval(()=>void sendPending().catch(console.error),15000).unref();
    createServer(handleRequest).listen(port,process.env.AURELLA_HOST||'127.0.0.1',()=>console.log(`Aurélla is running at http://localhost:${port}`));
  }
}
