import {createHash,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
const digest=value=>createHash('sha256').update(value).digest();
function store(env){
const defaults = {name:'Aurélla',currency:'LKR',contact:'',regions:[{name:'Colombo',fee:450,cod:false},{name:'Other districts',fee:650,cod:false}],test:true,delivery:'Delivery and return policies will be confirmed before launch.',privacy:'This preview stores test order details locally.'};
const db=env.DB;
const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
const get=async(table,id)=>JSON.parse((await stmt('SELECT body FROM '+table+' WHERE id=?',id).first())?.body||'null');
const all=async table=>(await stmt('SELECT body FROM '+table+' ORDER BY rowid DESC').all()).results.map(row=>JSON.parse(row.body));
const write=(table,id,value)=>stmt('INSERT INTO '+table+' VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',id,JSON.stringify(value));
const save=(...args)=>write(...args).run();
const config=async()=>await get('settings',1)||defaults;
const id=()=>crypto.randomUUID().replaceAll('-','');
const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
const clean = (x,max=1000) => typeof x==='string' ? x.trim().slice(0,max) : '';
const money = x => Number.isSafeInteger(x) && x>=0 && x<=100000000;
const validPrice = x => typeof x==='number' && Number.isFinite(x) && x>0 && x<=100000000 && Math.abs(x*100-Math.round(x*100))<0.000001;
const tags = x => clean(x).split(',').map(t=>t.trim()).filter(Boolean).join(', ');
const password=env.AURELLA_ADMIN_PASSWORD;
async function product(input,key) {
  const fields = ['name','brand','category','description','skin','concern','keyIngredients','ingredients','usage','warnings'];
  const p = Object.fromEntries(fields.map(f=>[f,clean(input[f],5000)]));
  if(!p.name || !p.brand || !p.category) fail('Name, brand and category are required.');
  if(!['draft','published','archived'].includes(input.status)) fail('Choose a publication status.');
  p.id=key;
  p.status=input.status;
  p.featured=input.featured===true;
  for(const f of ['skin','concern','keyIngredients']) p[f]=tags(p[f]);
  if(!Array.isArray(input.photos)||input.photos.length>12) fail('Use up to 12 photos.');
  p.photos=await Promise.all(input.photos.map(async photo=>{
    if(!env.IMAGES||!/^[a-f0-9]{32}$/.test(photo.id)||!await env.IMAGES.head(photo.id)) fail('Upload the photo before saving.');
    return {id:photo.id,alt:clean(photo.alt,180)};
  }));
  if(!Array.isArray(input.variants)||!input.variants.length||input.variants.length>40) fail('Add 1 to 40 variants.');
  const previous=await get('products',key);
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
  const existing=(await all('products')).filter(item=>item.id!==key).flatMap(item=>item.variants.map(v=>v.sku.toLowerCase()));
  const skus=p.variants.map(v=>v.sku.toLowerCase());
  if(new Set(skus).size!==skus.length||skus.some(s=>existing.includes(s))) fail('Each SKU must be unique.');
  if(new Set(p.variants.map(v=>v.id)).size!==p.variants.length) fail('Duplicate variant.');
  return p;
}

const stages=['Order received','Ready to dispatch','Dispatched','Order completed'];
const legacy={Received:stages[0],Preparing:stages[1],Delivered:stages[3]};
const payment=o=>o.method==='cod'?(o.paid?'Paid':'Awaiting cash on delivery'):'Test order — no payment collected';
const summary=o=>({id:o.id,invoice:o.invoice,tracking:o.tracking,status:legacy[o.status]||o.status,payment:payment(o),total:o.total,currency:o.currency});
async function sendPending(){
 if(!env.RESEND_API_KEY||!env.AURELLA_EMAIL_FROM||!env.AURELLA_PUBLIC_URL)return;
 for(const o of await all('orders')){
  if(!o.mail)continue;
  for(const kind of ['merchant','customer']){
   if(o.mail[kind]==='sent')continue;
   try{
    const link=new URL('/track/'+o.tracking,env.AURELLA_PUBLIC_URL).href;
    const lines=o.items.map(i=>i.name+' / '+i.variant+' × '+i.qty+' — '+o.currency+' '+(i.price*i.qty).toFixed(2));
    const body=[o.invoice,payment(o),...lines,'Delivery: '+o.currency+' '+o.delivery.toFixed(2),'Total: '+o.currency+' '+o.total.toFixed(2),'Amount paid: '+o.currency+' '+(o.paid?o.total:0).toFixed(2),'Track order: '+link];
    if(kind==='merchant')body.push(o.customer.name,o.customer.email,o.customer.phone,o.customer.address,o.region);
    const response=await fetch('https://api.resend.com/emails',{
     method:'POST',signal:AbortSignal.timeout(10000),
     headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':o.id+'/'+kind},
     body:JSON.stringify({from:env.AURELLA_EMAIL_FROM,to:[kind==='merchant'?'shenalrdemel@gmail.com':o.customer.email],subject:'Aurélla '+o.invoice+' — '+(kind==='merchant'?'New order':'Order confirmation'),text:body.join('\n')})
    });
    if(!response.ok)throw Error('Email provider HTTP '+response.status);
    await stmt("UPDATE orders SET body=json_set(body, ?, 'sent') WHERE id=?",'$.mail.'+kind,o.id).run();
   }catch(error){console.error('Order email pending',o.invoice,kind,error.message);}
  }
 }

}
async function order(input){
  const c=await config();
  const region=c.regions.find(r=>r.name===input.region);
  if(!region || (c.test?input.method!=='test':input.method!=='cod'||!region.cod)) fail('Choose an available delivery region and payment method.');
  const customer=Object.fromEntries(['name','phone','address','email'].map(k=>[k,clean(input[k],300)]));
  if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(customer.email)) fail('Enter a valid email address.');
  if(!customer.name||!customer.address||!/^\+?[\d ()-]{7,24}$/.test(customer.phone)) fail('Enter your name, a valid phone number and delivery address.');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>100) fail('Your cart is empty or too large.');
  if(!/^[a-f0-9-]{36}$/.test(input.reference||'')) fail('Invalid checkout reference.');

    const existing=await get('orders',input.reference);
    if(existing){
      if(JSON.stringify(customer)!==JSON.stringify(existing.customer)) fail('Checkout reference was already used.',409);
      return summary(existing);
    }
    const products=new Map();
    const items=[];
    for(const line of input.items){
      let p=products.get(line.product)||await get('products',String(line.product));
      const v=p?.variants.find(option=>option.id===line.variant);
      if(p?.status!=='published'||!v||!Number.isSafeInteger(line.qty)||line.qty<1||v.stock<line.qty) fail('An item is no longer available in the requested quantity.',409);
      if(v.price!==line.price) fail('A price changed. Review your cart and try again.',409);
      v.stock-=line.qty;
      products.set(p.id,p);
      items.push({product:p.id,name:p.name,brand:p.brand,variant:v.label,sku:v.sku,price:v.price,qty:line.qty});
    }
    const subtotalMinor=items.reduce((sum,line)=>sum+Math.round(line.price*100)*line.qty,0);
    if(!Number.isSafeInteger(subtotalMinor+region.fee*100)) fail('Order total is too large.');
    const subtotal=subtotalMinor/100;
    const record={id:input.reference,customer,items,region:region.name,method:input.method,subtotal,delivery:region.fee,total:subtotal+region.fee,currency:c.currency,invoice:'AUR-'+id().toUpperCase(),tracking:id(),mail:{merchant:'pending',customer:'pending'},status:stages[0],created:new Date().toISOString()};
    const changes=[];
    for(const [key,p] of products){
      changes.push(guard(key,p.revision||0));
      p.revision=(p.revision||0)+1;
      changes.push(write('products',key,p));
    }
    changes.push(stmt('INSERT INTO orders VALUES (?,?)',record.id,JSON.stringify(record)));
    await atomic(changes);
    return summary(record);
}

async function atomic(changes){
  try{await db.batch(changes);}catch(error){
    if(String(error).includes('CHECK constraint failed'))fail('The store changed. Refresh and try again.',409);
    throw error;
  }
}
const guard=(key,revision)=>stmt("INSERT INTO write_guard SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM products WHERE id=? AND coalesce(json_extract(body,'$.revision'),0)=?)",key,revision);
async function handleRequest(req){
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"});
  const send=(status,value,type='application/json')=>{
    headers.set('Content-Type',type);
    return new Response(type==='application/json'?JSON.stringify(value):value,{status,headers});
  };
  try {
    const {pathname:path}=new URL(req.url,'http://localhost');
    const method=req.method;
    const token=req.headers.get('cookie')?.match(/(?:^|;\s*)aurella=([a-f0-9]{32})(?:;|$)/)?.[1];
    const admin=token && await stmt('SELECT id FROM sessions WHERE id=? AND expires>?',token,Date.now()).first();
    const body=async (limit=6_000_000)=>{
      const chunks=[];let size=0;
      for await(const chunk of req.body||[]){size+=chunk.length;if(size>limit) fail('Upload is too large.',413);chunks.push(chunk);}
      return Buffer.concat(chunks);
    };
    const json=async()=>{try{return JSON.parse(await body(200_000));}catch(e){if(e.status)throw e;fail('Invalid request.');}};
    if(!['GET','HEAD'].includes(method)&&req.headers.get('sec-fetch-site') && !['same-origin','none'].includes(req.headers.get('sec-fetch-site'))) fail('Request rejected.',403);
    if(method==='GET'&&path==='/api/catalog')return send(200,{settings:await config(),products:(await all('products')).filter(p=>p.status==='published')});
    if(method==='POST'&&path==='/api/order')return send(201,await order(await json()));
    if(method==='GET'&&/^\/api\/track\/[a-f0-9]{32}$/.test(path)){
      const record=await stmt("SELECT body FROM orders WHERE json_extract(body, '$.tracking')=?",path.split('/').pop()).first();
      if(!record)fail('Order unavailable.',404);
      const o=JSON.parse(record.body);
      return send(200,{invoice:o.invoice,status:legacy[o.status]||o.status,stages});
    }
    if(method==='GET'&&/^\/media\/[a-f0-9]{32}$/.test(path)){
      const key=path.split('/').pop();
      const visible=admin||(await all('products')).some(p=>p.status==='published'&&p.photos.some(photo=>photo.id===key));
      const photo=visible&&env.IMAGES&&await env.IMAGES.get(key);
      if(!photo)fail('Photo unavailable.',404);
      return send(200,photo.body,photo.httpMetadata.contentType);
    }
    if(path==='/api/admin/login'&&method==='POST'){
      if(!password||password.length<14)fail('Set an admin password of at least 14 characters on the server.',503);
      const now=Date.now();
      const window=Math.floor(now/60000);
      const source=req.headers.get('CF-Connecting-IP')||'unknown';
      const attempt=await stmt('INSERT INTO login_attempts VALUES (?,?,1) ON CONFLICT(ip) DO UPDATE SET window=excluded.window, attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END RETURNING attempts',source,window).first();
      if(attempt.attempts>8)fail('Too many attempts. Try again in a minute.',429);
      const input=await json();
      if(!timingSafeEqual(digest(clean(input.password)),digest(password)))fail('Incorrect password.',401);
      const session=id();
      await stmt('DELETE FROM sessions WHERE expires<=? OR id=?',now,token||'').run();
      await stmt('INSERT INTO sessions VALUES (?,?)',session,now+8*3600000).run();
      headers.set('Set-Cookie',`aurella=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure`);
      return send(200,{ok:true});
    }
    if(path.startsWith('/api/admin/')){
      if(!admin) fail('Sign in as the store administrator.',401);
      if(path==='/api/admin/logout'&&method==='POST'){
        await stmt('DELETE FROM sessions WHERE id=?',token).run();
        headers.set('Set-Cookie','aurella=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure');
        return send(200,{ok:true});
      }
      if(path==='/api/admin/data'&&method==='GET')return send(200,{products:await all('products'),orders:await all('orders'),settings:await config()});
      if(path==='/api/admin/photo'&&method==='POST'){
        const bytes=await body();
        const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
        const jpg=bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));
        const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
        if(!png&&!jpg&&!webp) fail('Upload a JPG, PNG or WebP image under 6 MB.');
        const key=id();
        if(!env.IMAGES)fail('Product image storage is not configured.',503);
        await env.IMAGES.put(key,bytes,{httpMetadata:{contentType:png?'image/png':jpg?'image/jpeg':'image/webp'}});
        return send(201,{id:key});
      }
      if(path==='/api/admin/product'&&method==='POST'){
        const input=await json();
        const key=input.id||id();
        if(input.id&&!await get('products',String(key)))fail('Product unavailable.',404);
        const p=await product(input,key);
        const changes=[stmt("INSERT INTO write_guard SELECT 0 WHERE EXISTS (SELECT 1 FROM products, json_each(body,'$.variants') WHERE products.id<>? AND lower(json_extract(value,'$.sku')) IN (SELECT value FROM json_each(?)))",key,JSON.stringify(p.variants.map(v=>v.sku.toLowerCase())))];
        if(input.id)changes.push(guard(key,p.revision-1));
        await atomic([...changes,write('products',key,p)]);
        return send(200,p);
      }
      if(path.startsWith('/api/admin/product/')&&method==='DELETE'){
        const key=path.split('/').pop();
        const p=await get('products',key);
        if(!p)fail('Product unavailable.',404);
        const used=(await all('orders')).some(o=>o.items.some(line=>line.product===key));
        const revision=p.revision||0;
        if(used){p.status='archived';p.revision=revision+1;await atomic([guard(key,revision),write('products',key,p)]);}
        else await atomic([guard(key,revision),stmt('DELETE FROM products WHERE id=?',key)]);
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
        await save('settings',1,settings);
        return send(200,settings);
      }
      if(path==='/api/admin/order'&&method==='POST'){
        const input=await json();
        const record=await get('orders',String(input.id));
        if(!record||!stages.includes(input.status))fail('Choose a valid fulfillment status.');
        record.status=input.status;
        if(record.method==='cod') record.paid=input.paid===true;
        await stmt("UPDATE orders SET body=json_set(body,'$.status',?,'$.paid',json(?)) WHERE id=?",record.status,JSON.stringify(record.paid===true),record.id).run();
        return send(200,record);
      }
    }
    if(method==='GET'&&!path.startsWith('/api/')&&!path.startsWith('/media/')){
      const appRoute=/^\/(?:admin|shop|cart|checkout|contact|delivery|privacy|product\/[a-z0-9-]+|track\/[a-f0-9]{32})$/.test(path);
      if(!appRoute)return env.ASSETS.fetch(req); const asset=await env.ASSETS.fetch(new Request(new URL('/store-app.html',req.url))); return send(asset.status,asset.body,'text/html; charset=utf-8');
    }
    fail('Page unavailable.',404);
  }catch(error){
    if(!error.status) console.error(error);
    return send(error.status||500,{error:error.status?error.message:'The store could not complete that request.'});
  }
}


return {handleRequest,sendPending};
}
export default {fetch(req,env){return store(env).handleRequest(req);},scheduled(event,env,ctx){ctx.waitUntil(store(env).sendPending());}};

