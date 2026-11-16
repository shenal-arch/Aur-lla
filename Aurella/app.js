const main=document.querySelector('#main');
const path=location.pathname;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc=encodeURIComponent;
const list=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
let settings, products, admin;
let cart;
try{cart=JSON.parse(localStorage.getItem('aurella-cart'))||[];}catch{cart=[];}
let noticeTimer;
function notify(message){const el=document.querySelector('#notice');el.textContent=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el.textContent='',4500);}
async function api(url, data, method=data===undefined?'GET':'POST'){
  const options={method};
  if(data instanceof File||data instanceof Blob)options.body=data;
  else if(data!==undefined){options.body=JSON.stringify(data);options.headers={'Content-Type':'application/json'};}
  const response=await fetch('/api/'+url,options);
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error),{status:response.status});
  return result;
}
const money=(value,currency=settings.currency)=>esc(new Intl.NumberFormat('en-LK',{style:'currency',currency,minimumFractionDigits:0,maximumFractionDigits:2}).format(value));
const slug=p=>p.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'item';
const productUrl=p=>'/product/'+slug(p)+'-'+p.id;
const photo=(p,i=0)=>p.photos[i]?'<div class="photo"><img src="/media/'+esc(p.photos[i].id)+'" alt="'+esc(p.photos[i].alt)+'" loading="lazy"></div>':'<div class="photo" aria-label="No product photo">No photo</div>';
const section=(title,html)=>'<section class="shell section"><h1>'+esc(title)+'</h1>'+html+'</section>';
const shopLink=(key,value)=>'/shop?'+key+'='+enc(value);
function layout(){
  const header=document.querySelector('#header');
  header.className='store-nav';
  header.innerHTML='<div class="nav-inner"><a class="logo" href="/">'+esc(settings.name)+'</a><nav class="nav-links" aria-label="Main"><a href="/shop">Shop All</a><a href="/shop?q=cleanser">Cleansers</a><a href="/shop?q=serum">Serums</a><a href="/shop?q=hair">Hair Care</a><a href="/shop#search">Search</a><a class="nav-action" href="/cart">Cart <span id="count"></span></a></nav></div>';
  document.querySelector('#footer').innerHTML='<div class="shell bar"><div><a class="logo" href="/">'+esc(settings.name)+'</a><p class="muted small">Independent skincare &amp; cosmetics reseller</p></div><nav class="links" aria-label="Footer"><a href="/contact">Contact</a><a href="/delivery">Delivery &amp; Returns</a><a href="/privacy">Privacy</a></nav></div>';
  document.querySelector('#count').textContent='('+cart.reduce((n,l)=>n+l.qty,0)+')';
}
function persist(){localStorage.setItem('aurella-cart',JSON.stringify(cart));layout();}
function cards(items){
  if(!items.length)return '<p class="muted">No products to show.</p>';
  return '<div class="grid catalog">'+items.map(p=>{
    const prices=p.variants.map(v=>v.price);
    return '<article class="card"><a href="'+productUrl(p)+'" tabindex="-1" aria-hidden="true">'+photo(p)+'</a><div class="card-body"><div class="eyebrow">'+esc(p.brand)+'</div><h3><a href="'+productUrl(p)+'">'+esc(p.name)+'</a></h3><div class="card-meta"><div class="price">'+(Math.min(...prices)!==Math.max(...prices)?'From ':'')+money(Math.min(...prices))+'</div><span class="card-size">'+esc(p.variants.map(v=>v.label).join(' · '))+'</span></div><div class="small">'+(p.variants.some(v=>v.stock>0)?'In stock':'Out of stock')+'</div><a class="button secondary" href="'+productUrl(p)+'">'+(p.variants.length>1?'Choose Options':'View Product')+'</a></div></article>';
  }).join('')+'</div>';
}
const facets={brand:'Brand',category:'Category',skin:'Skin type',concern:'Skin concern',keyIngredients:'Ingredient'};
const values=key=>[...new Set(products.flatMap(p=>['brand','category'].includes(key)?[p[key]]:list(p[key])))].filter(Boolean).sort();
const skinTiles = [["oily","Oily Skin","oily","skin"],["normal","Normal Skin","normal","skin"],["dry","Dry Skin","dry","skin"],["sensitive","Sensitive Skin","sensitive","skin"],["combination","Combination Skin","combination","skin"],["aging","Signs of Aging","retinol","concern"],["dryness","Dryness","hydrating","concern"],["uneven","Uneven Texture","exfoliating","concern"],["dark-spots","Dark Spots","brightening","concern"],["blemishes","Blemishes","acne","concern"],["dullness","Dullness","vitamin c","concern"]];
function skinBrowse(){
  const links=skinTiles.map(([key,label,query,facet])=>{
    const match=(facet==='skin'?values('skin'):values('concern')).find(value=>value.toLowerCase()===label.toLowerCase());
    const href=match?shopLink(facet,match):shopLink('q',query);
    return '<a class="skin-tile" href="'+href+'"><img src="/skin/'+key+'.jpg" alt="" width="308" height="462" loading="lazy"><span>'+label+'</span></a>';
  }).join('');
  return '<section class="skin-browse"><div class="shell section"><h2>Browse by Skin Type &amp; Concern</h2><div class="skin-slider"><div class="skin-track">'+links+'</div><button class="skin-arrow skin-prev" type="button" aria-label="Previous skin types and concerns">‹</button><button class="skin-arrow skin-next" type="button" aria-label="Next skin types and concerns">›</button></div></div></section>';
}
function bindSkinCarousel(root){
 const track=root.querySelector('.skin-track');
 const prev=root.querySelector('.skin-prev');
 const next=root.querySelector('.skin-next');
 const update=()=>{
  prev.disabled=track.scrollLeft<=2;
  next.disabled=track.scrollLeft+track.clientWidth>=track.scrollWidth-2;
 };
 const move=direction=>{
  const first=track.firstElementChild;
  const step=first.getBoundingClientRect().width+parseFloat(getComputedStyle(track).columnGap);
  track.scrollBy({left:direction*step*Math.max(1,Math.floor((track.clientWidth+12)/step)),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 };
 prev.onclick=()=>move(-1);
 next.onclick=()=>move(1);
 track.addEventListener('scroll',update,{passive:true});
 new ResizeObserver(update).observe(track);
 update();
}
function home(){
  const featured=products.filter(p=>p.featured);
  const image=featured.find(p=>p.photos.length)?.photos[0];
  main.innerHTML='<section class="home-hero"><div class="home-hero-copy"><p class="eyebrow">Skincare &amp; cosmetics</p><h1>Start with your skin.</h1><p>Explore skincare by concern, ingredient, or brand.</p><a class="button secondary" href="/shop">Shop All Products</a></div><div class="home-hero-art">'+(image?'<img src="/media/'+esc(image.id)+'" alt="'+esc(image.alt)+'">':'')+'</div></section><section class="shell section"><div class="home-heading"><h2>Featured Products</h2><a href="/shop">View All</a></div>'+cards(featured.slice(0,4))+'</section>'+skinBrowse();
  bindSkinCarousel(document.querySelector('.skin-slider'));
}
function shop(){
  const params=new URLSearchParams(location.search);
  const q=(params.get('q')||'').trim();
  const sort=params.get('sort')||'';
  const min=params.get('min'), max=params.get('max');
  const availability=params.get('availability');
  const matches=products.filter(p=>{
    if(q&&!q.toLowerCase().split(/\s+/).every(word=>[p.name,p.brand,p.category,p.keyIngredients].join(' ').toLowerCase().includes(word)))return false;
    if(!Object.keys(facets).every(k=>!params.has(k)||params.getAll(k).some(x=>['brand','category'].includes(k)?p[k]===x:list(p[k]).includes(x))))return false;
    return p.variants.some(v=>(!min||v.price>=Number(min))&&(!max||v.price<=Number(max))&&(!availability||v.stock>0));
  });
  const price=p=>Math.min(...p.variants.map(v=>v.price));
  if(sort==='low')matches.sort((a,b)=>price(a)-price(b));
  if(sort==='high')matches.sort((a,b)=>price(b)-price(a));
  if(sort==='name')matches.sort((a,b)=>a.name.localeCompare(b.name));
  const chips=[...params.entries()].filter(([k,v])=>v&&k!=='q'&&k!=='sort').map(([key,value])=>{
    const copy=new URLSearchParams(params);copy.delete(key,value);
    const label=facets[key]||({min:'Minimum',max:'Maximum',availability:'Stock'}[key]);
    return label?'<a class="chip" href="/shop?'+esc(copy)+'" aria-label="Remove '+esc(label+' '+value)+'">'+esc(label+': '+value)+' ×</a>':'';
  }).join('');
  main.innerHTML=section('Shop products','<div class="shop-head"><form id="search" action="/shop"><label>Search products<input name="q" value="'+esc(q)+'" placeholder="Brand, product, or ingredient" type="search"></label>'+[...params.entries()].filter(([k])=>k!=='q').map(([k,v])=>'<input type="hidden" name="'+esc(k)+'" value="'+esc(v)+'">').join('')+'<button class="secondary">Search</button></form><button id="open-filters" type="button" class="secondary">Filter &amp; Sort</button></div><p>'+matches.length+' '+(matches.length===1?'product':'products')+'</p><div class="chips">'+chips+'</div>'+(matches.length?cards(matches):'<div class="panel"><p>No products match your search and filters.</p><a class="button secondary" href="/shop">Reset filters and search</a></div>')+
  '<dialog id="filters" aria-labelledby="filter-title"><form method="get" action="/shop" class="stack"><div class="row spaced"><h2 id="filter-title">Filter &amp; Sort</h2><button class="secondary" id="close-filters" type="button">Close</button></div><input type="hidden" name="q" value="'+esc(q)+'"><div class="form-grid">'+Object.entries(facets).map(([key,label])=>'<fieldset><legend>'+label+'</legend>'+values(key).map(v=>'<label class="check"><input type="checkbox" name="'+key+'" value="'+esc(v)+'" '+(params.getAll(key).includes(v)?'checked':'')+'>'+esc(v)+'</label>').join('')+'</fieldset>').join('')+'</div><div class="form-grid"><label>Minimum price<input name="min" type="number" min="0" value="'+esc(min)+'"></label><label>Maximum price<input name="max" type="number" min="0" value="'+esc(max)+'"></label><label>Sort<select name="sort">'+Object.entries({'':'Newest',low:'Price: low to high',high:'Price: high to low',name:'Name'}).map(([k,v])=>'<option value="'+k+'" '+(sort===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label></div><label class="check"><input type="checkbox" name="availability" value="In stock" '+(availability?'checked':'')+'> In stock only</label><button>Apply filters</button><a href="/shop">Clear filters</a></form></dialog>');
  const dialog=document.querySelector('#filters');
  document.querySelector('#open-filters').onclick=()=>dialog.showModal();
  document.querySelector('#close-filters').onclick=()=>dialog.close();
  if(location.hash==='#search')document.querySelector('[name=q]').focus();
}
function detail(p,preview=false){
  if(!p){main.innerHTML=section('Product unavailable','<a href="/shop">Browse the catalog</a>');return;}
  document.title=p.name+' | '+settings.name;
  main.innerHTML='<section class="shell section"><a href="/shop" id="back">Back to shop</a><div class="split"><div class="stack"><div id="primary">'+photo(p)+'</div><div class="row">'+p.photos.map((image,i)=>'<button type="button" class="secondary thumb-button" data-index="'+i+'" aria-label="View photo '+(i+1)+'"><img class="thumb" src="/media/'+esc(image.id)+'" alt=""></button>').join('')+'</div></div><div><p class="eyebrow">'+esc(p.brand)+'</p><h1>'+esc(p.name)+'</h1><p>'+esc(p.description)+'</p><form id="add" class="stack"><label>Size or shade<select id="variant">'+p.variants.map(v=>'<option value="'+esc(v.id)+'">'+esc(v.label)+'</option>').join('')+'</select></label><div id="variation" aria-live="polite"></div><label>Quantity<input id="qty" type="number" value="1" min="1" required></label><button id="add-button" '+(preview?'disabled':'')+'>'+(preview?'Admin preview':'Add to Cart')+'</button><a href="/delivery">Delivery &amp; Returns</a></form><div class="section">'+[['Who it’s for',[p.skin,p.concern].filter(Boolean).join(' · ')],['Key ingredients',p.keyIngredients],['Full ingredients',p.ingredients],['How to use',p.usage],['Manufacturer warnings',p.warnings]].map(([label,value])=>'<details><summary>'+label+'</summary><p class="prose">'+esc(value||'Details unavailable.')+'</p></details>').join('')+'</div></div></div></section>';
  const back=document.querySelector('#back');
  if(preview){back.href='/admin?view=products';back.textContent='Back to products';}
  else if(document.referrer.startsWith(location.origin+'/shop'))back.href=document.referrer;
  const select=document.querySelector('#variant'),qty=document.querySelector('#qty'),button=document.querySelector('#add-button');
  const variant=()=>p.variants.find(v=>v.id===select.value);
  const update=()=>{
    const v=variant();
    document.querySelector('#variation').innerHTML=(v.swatch?'<span class="swatch" style="background:'+esc(v.swatch)+'"></span> ':'')+'<strong>'+money(v.price)+'</strong> · '+(v.stock?'In stock':'Out of stock');
    qty.max=Math.max(1,v.stock);qty.value=Math.min(Number(qty.value)||1,Math.max(1,v.stock));
    button.disabled=preview||!v.stock;
    const i=p.photos.findIndex(image=>image.id===v.photo);
    document.querySelector('#primary').innerHTML=photo(p,Math.max(i,0));
  };
  select.onchange=update;
  update();
  for(const b of document.querySelectorAll('.thumb-button'))b.onclick=()=>document.querySelector('#primary').innerHTML=photo(p,Number(b.dataset.index));
  document.querySelector('#add').onsubmit=e=>{
    e.preventDefault();if(preview)return;
    const v=variant(),existing=cart.find(line=>line.variant===v.id);
    const next=(existing?.qty||0)+Number(qty.value);
    if(next>v.stock){notify('Only '+v.stock+' available.');return;}
    if(existing)existing.qty=next;
    else cart.push({product:p.id,variant:v.id,qty:next});
    persist();notify('Added to cart');
  };
}
function cartView(checkout){
  const lines=cart.map(line=>{
    const p=products.find(x=>x.id===line.product),v=p?.variants.find(x=>x.id===line.variant);
    return {line,p,v,valid:Boolean(v&&v.stock>=line.qty)};
  });
  const subtotal=lines.reduce((sum,{line,v})=>sum+(v?.price||0)*line.qty,0);
  const allowed=lines.length&&lines.every(l=>l.valid);
  main.innerHTML=section(checkout?'Guest checkout':'Your cart',lines.length?'<div class="split"><div class="stack">'+lines.map(({line,p,v,valid},i)=>'<article class="panel"><div class="row spaced"><strong>'+esc(p?.name||'Unavailable item')+'</strong>'+(v?money(v.price*line.qty):'')+'</div><p>'+esc(v?.label||'')+(valid?'':' <span class="error">Unavailable in this quantity</span>')+'</p>'+(!checkout?'<div class="row">'+(v?.stock?'<label>Quantity<input data-qty="'+i+'" type="number" min="1" max="'+v.stock+'" value="'+line.qty+'"></label>':'')+'<button type="button" class="secondary" data-remove="'+i+'">Remove</button></div>':'')+'</article>').join('')+'</div><div class="panel stack"><h2>Order summary</h2><div class="row spaced"><span>Subtotal</span><strong>'+money(subtotal)+'</strong></div>'+
  (checkout&&allowed?'<form id="order" class="stack"><label>Full name<input name="name" autocomplete="name" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Phone for delivery<input name="phone" type="tel" autocomplete="tel" required></label><label>Delivery address<textarea name="address" autocomplete="street-address" required></textarea></label><label>Delivery region<select name="region" required><option value="">Select region</option>'+settings.regions.map(r=>'<option value="'+esc(r.name)+'">'+esc(r.name)+'</option>').join('')+'</select></label><div class="row spaced"><span>Delivery</span><strong id="fee">Select region</strong></div><div class="row spaced rule"><span>Total</span><strong id="total">—</strong></div><p id="method" class="small" aria-live="polite"></p><p id="order-error" role="alert" class="error"></p><button disabled>Place order</button></form>':checkout?'<a class="button secondary" href="/cart">Review cart</a>':'<p class="small muted">Delivery is calculated at checkout.</p>'+(allowed?'<a class="button" href="/checkout">Guest Checkout</a>':'<p>Update your cart to continue.</p>'))+'</div></div>':'<p>Your cart is empty.</p><a class="button" href="/shop">Shop Products</a>');
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{cart.splice(Number(b.dataset.remove),1);persist();cartView(false);});
  document.querySelectorAll('[data-qty]').forEach(i=>i.onchange=()=>{if(i.reportValidity()){cart[Number(i.dataset.qty)].qty=Number(i.value);persist();cartView(false);}});
  const form=document.querySelector('#order');
  if(!form)return;
  const region=()=>settings.regions.find(r=>r.name===form.elements.region.value);
  const submit=form.querySelector('button');
  const reference=crypto.randomUUID();
  form.elements.region.onchange=()=>{
    const r=region();
    document.querySelector('#fee').textContent=r?money(r.fee):'Select region';
    document.querySelector('#total').textContent=r?money(subtotal+r.fee):'—';
    document.querySelector('#method').textContent=r?(settings.test?'Test order · no payment will be collected':r.cod?'Cash on delivery':'No payment method is available for this region.'):'';
    submit.disabled=!r||(!settings.test&&!r.cod);
  };
  form.onsubmit=async e=>{
    e.preventDefault();submit.disabled=true;
    try{
      const data=Object.fromEntries(new FormData(form));
      const result=await api('order',{...data,reference,method:settings.test?'test':'cod',items:lines.map(({line,v})=>({...line,price:v.price}))});
      cart=[];persist();
      main.innerHTML=section('Order received','<p>Order reference <strong>'+esc(result.invoice)+'</strong></p><p>'+esc(result.payment)+'</p><a href="/track/'+esc(result.tracking)+'">Track delivery</a><p>Total '+money(result.total,result.currency)+'</p><a class="button" href="/shop">Continue shopping</a>');
    }catch(error){document.querySelector('#order-error').textContent=error.message;submit.disabled=false;}
  };
}
const field=(name,label,value='',type='text')=>'<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'"></label>';
const area=(name,label,value='')=>'<label>'+esc(label)+'<textarea name="'+name+'">'+esc(value)+'</textarea></label>';
function handle(form,callback){
  form.onsubmit=async e=>{
    e.preventDefault();const button=e.submitter;
    if(button)button.disabled=true;
    const error=form.querySelector('[role=alert]');if(error)error.textContent='';
    try{await callback(new FormData(form));}catch(e){if(error)error.textContent=e.message;else notify(e.message);}
    finally{if(button)button.disabled=false;}
  };
}
const errorBox='<p class="error" role="alert"></p>';
const adminPages={overview:'Overview',orders:'Orders',products:'Products',settings:'Settings'};
const statuses=['Order received','Ready to dispatch','Dispatched','Order completed'];
const deliveryStatus=o=>({Received:statuses[0],Preparing:statuses[1],Delivered:statuses[3]}[o.status]||o.status);
const paymentStatus=o=>o.method==='test'?'Test order':o.paid?'Paid':'Payment pending';
const orderRef=o=>o.invoice||o.id;
const orderDate=o=>o.created?new Intl.DateTimeFormat('en-LK',{dateStyle:'medium',timeZone:'Asia/Colombo'}).format(new Date(o.created)):'—';
const adminUrl=(page,extra='')=>'/admin?view='+page+extra;
const badge=(label,tone='')=>'<span class="admin-badge '+tone+'">'+esc(label)+'</span>';
function table(headings, rows, empty){
 return '<div class="admin-table-wrap"><table><thead><tr>'+headings.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows.join('')||'<tr><td colspan="'+headings.length+'" class="admin-empty">'+esc(empty)+'</td></tr>')+'</tbody></table></div>';
}
function cells(values){return '<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';}
function adminFrame(page,content,action=''){
 main.innerHTML='<div class="admin-layout"><aside class="admin-sidebar"><a class="admin-brand" href="/admin">'+esc(settings.name)+'</a><nav aria-label="Administration">'+Object.entries(adminPages).map(([key,label])=>'<a href="'+adminUrl(key)+'"'+(page===key?' aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav><button id="logout" class="secondary">Sign out</button></aside><div class="admin-content"><div class="admin-heading"><h1>'+adminPages[page]+'</h1>'+action+'</div>'+content+'</div></div>';
 document.querySelector('#logout').onclick=async()=>{try{await api('admin/logout',{});await dashboard();}catch(error){notify(error.message);}};
}
function orderTable(orders,empty){
 return table(['Order','Customer','Delivery','Payment','Total'],orders.map(o=>cells([
 '<a href="'+adminUrl('orders','&order='+encodeURIComponent(o.id))+'">'+esc(orderRef(o))+'</a><small>'+esc(orderDate(o))+'</small>',
 esc(o.customer.name),badge(deliveryStatus(o),deliveryStatus(o)===statuses[3]?'good':''),badge(paymentStatus(o),o.paid?'good':''),
 money(o.total,o.currency)
 ])),empty);
}
function renderOverview(){
 const live=admin.orders.filter(o=>o.method!=='test');
 const paid=live.filter(o=>o.paid);
 const sums=new Map();
 for(const o of paid)sums.set(o.currency,(sums.get(o.currency)||0)+Math.round(o.total*100));
 const revenue=[...sums].map(([currency,total])=>money(total/100,currency)).join(' · ')||money(0,admin.settings.currency);
 const metrics=[['Payment collected',revenue,'Paid orders, including delivery'],['Products sold',paid.reduce((n,o)=>n+o.items.reduce((u,i)=>u+i.qty,0),0),'Units on paid orders'],['Orders received',live.length,'All real orders'],['Awaiting dispatch',live.filter(o=>statuses.indexOf(deliveryStatus(o))<2).length,'Received or ready to dispatch']];
 adminFrame('overview','<div class="admin-kpis">'+metrics.map(([label,value,note])=>'<div class="admin-panel admin-kpi"><span>'+label+'</span><strong>'+value+'</strong><small>'+note+'</small></div>').join('')+'</div><section class="admin-panel"><div class="admin-panel-head"><h2>Recent orders</h2><a href="'+adminUrl('orders')+'">View all orders</a></div>'+orderTable(admin.orders.slice(0,6),'Orders will appear here after checkout.')+'</section>');
}
function renderOrders(params){
 const active=admin.orders.find(o=>o.id===params.get('order'));
 adminFrame('orders','<section class="admin-panel"><div class="admin-tools"><label>Search orders<input id="order-search" type="search" placeholder="Invoice, customer or email"></label><label>Delivery status<select id="order-filter"><option value="">All statuses</option>'+statuses.map(s=>'<option>'+s+'</option>').join('')+'</select></label></div><div id="orders-list"></div></section>'+(active?'<section id="order-detail" class="admin-panel"><div class="admin-panel-head"><h2>'+esc(orderRef(active))+'</h2><a href="'+adminUrl('orders')+'">Close details</a></div><div class="admin-detail"><div><h3>Delivery address</h3><p>'+[active.customer.name,active.customer.email,active.customer.phone,active.customer.address,active.region].filter(Boolean).map(esc).join('<br>')+'</p></div><div><h3>Payment and email</h3><p>'+esc(paymentStatus(active))+'<br>'+esc(active.mail?Object.entries(active.mail).map(([k,v])=>k+' '+v).join(' · '):'Email status unavailable')+'</p>'+(active.tracking?'<a href="/track/'+esc(active.tracking)+'">Open tracking page</a>':'')+'</div></div>'+table(['Product','Quantity','Price'],active.items.map(i=>cells([esc(i.name)+'<small>'+esc(i.variant)+'</small>',i.qty,money(i.price,active.currency)])),'No items.')+'<p>Delivery '+money(active.delivery,active.currency)+' · Order total <strong>'+money(active.total,active.currency)+'</strong></p><form class="admin-tools" id="order-update"><label>Delivery status<select name="status">'+statuses.map(s=>'<option'+(s===deliveryStatus(active)?' selected':'')+'>'+s+'</option>').join('')+'</select></label>'+(active.method==='cod'?'<label class="check"><input type="checkbox" name="paid" '+(active.paid?'checked':'')+'> Payment collected</label>':'')+'<button>Save changes</button>'+errorBox+'</form></section>':''));
 const search=document.querySelector('#order-search'),filter=document.querySelector('#order-filter');
 const render=()=>{const q=search.value.trim().toLowerCase();document.querySelector('#orders-list').innerHTML=orderTable(admin.orders.filter(o=>(!filter.value||filter.value===deliveryStatus(o))&&[o.id,orderRef(o),o.customer.name,o.customer.email].join(' ').toLowerCase().includes(q)),'No matching orders.');};
 search.oninput=render;filter.onchange=render;render();
 if(active){
  document.querySelector('#order-detail').scrollIntoView({block:'nearest'});
  handle(document.querySelector('#order-update'),async d=>{await api('admin/order',{id:active.id,status:d.get('status'),paid:d.has('paid')});await dashboard();notify('Order updated');});
 }
}
function renderProducts(){
 adminFrame('products','<section class="admin-panel"><div class="admin-tools"><label>Search products<input id="admin-search" type="search" placeholder="Product, brand or SKU"></label><label>Status<select id="product-filter"><option value="">All statuses</option><option>published</option><option>draft</option><option>archived</option></select></label></div><div id="admin-products"></div></section>','<button id="new">Add product</button>');
 const search=document.querySelector('#admin-search'),filter=document.querySelector('#product-filter');
 const render=()=>{
  const matches=admin.products.filter(p=>(!filter.value||filter.value===p.status)&&[p.name,p.brand,...p.variants.map(v=>v.sku)].join(' ').toLowerCase().includes(search.value.trim().toLowerCase()));
  document.querySelector('#admin-products').innerHTML=table(['Product','Status','Price from','Units in stock',''],matches.map(p=>cells([
   '<div class="admin-product">'+(p.photos[0]?'<img src="/media/'+esc(p.photos[0].id)+'" alt="">':'')+'<div><strong>'+esc(p.name)+'</strong><small>'+esc(p.brand)+'</small></div></div>',
   badge(p.status,p.status==='published'?'good':''),money(Math.min(...p.variants.map(v=>v.price)),admin.settings.currency),p.variants.reduce((sum,v)=>sum+v.stock,0),
   '<button class="secondary" data-edit="'+esc(p.id)+'">View / edit</button>'
  ])),'No matching products.');
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editor(admin.products.find(p=>p.id===b.dataset.edit)));
 };
 search.oninput=render;filter.onchange=render;render();
 document.querySelector('#new').onclick=()=>editor();
}
async function dashboard(){
 document.body.classList.add('admin-mode');
 try{admin=await api('admin/data');}
 catch(error){
  if(error.status!==401)throw error;
  main.innerHTML='<section class="admin-login admin-panel"><p class="admin-brand">'+esc(settings.name)+'</p><h1>Admin sign in</h1><form id="login" class="stack">'+field('password','Admin password','','password')+errorBox+'<button>Sign in</button></form></section>';
  document.querySelector('#login input').autocomplete='current-password';
  handle(document.querySelector('#login'),async d=>{await api('admin/login',Object.fromEntries(d));await dashboard();});return;
 }
 const params=new URLSearchParams(location.search);
 const view=params.get('view');
 if(view==='orders')renderOrders(params);
 else if(view==='products')renderProducts();
 else if(view==='settings')settingsEditor();
 else renderOverview();
}
function editor(original){
  const p=structuredClone(original||{status:'draft',photos:[],variants:[{label:'',sku:'',price:'',stock:0,swatch:'',photo:''}]});
  adminFrame('products', '<h2>'+(original?'Edit product':'New product')+'</h2>'+'<form id="editor" class="stack"><div class="row"><button type="button" class="secondary" id="back-admin">Back to products</button>'+(original?'<button type="button" id="preview" class="secondary">Preview saved product</button><button type="button" class="secondary" id="remove-product">Delete product</button>':'')+'</div><div class="panel stack"><div class="form-grid">'+[['name','Product name'],['brand','Brand'],['category','Category'],['skin','Skin types (comma-separated)'],['concern','Skin concerns (comma-separated)'],['keyIngredients','Key ingredients (comma-separated)']].map(([k,v])=>field(k,v,p[k])).join('')+'</div>'+[['description','Description'],['ingredients','Full ingredients'],['usage','How to use'],['warnings','Manufacturer warnings']].map(([k,v])=>area(k,v,p[k])).join('')+'<label>Status<select name="status">'+['draft','published','archived'].map(s=>'<option '+(s===p.status?'selected':'')+'>'+s+'</option>').join('')+'</select></label><label class="check"><input type="checkbox" name="featured" '+(p.featured?'checked':'')+'> Featured on homepage</label></div><section class="panel stack"><h2>Photos</h2><label>Upload photos<input id="upload" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p id="upload-status" role="status"></p><div id="photos" class="stack"></div></section><section class="panel stack"><h2>Variants</h2><div id="variants" class="stack"></div><button type="button" class="secondary" id="add-variant">Add variant</button></section>'+errorBox+'<button id="save-product">Save product</button></form>');
  const form=document.querySelector('#editor');
  if(p.sourceUrl){
    const reference=document.createElement('details');
    reference.className='panel';
    reference.innerHTML='<summary>Cosmetics.lk reference</summary><p><a href="'+esc(p.sourceUrl)+'" target="_blank" rel="noopener">Original listing</a> · '+(p.priceFrom?'From ':'')+money(p.referencePrice,'LKR')+'</p><ul>'+(p.sourceImages||[]).map((url,i)=>'<li><a href="'+esc(url)+'" target="_blank" rel="noopener">Source image '+(i+1)+'</a></li>').join('')+'</ul>';
    form.prepend(reference);
  }
  const render=()=>{
    document.querySelector('#photos').innerHTML=p.photos.map((image,i)=>'<div class="row"><img class="thumb" src="/media/'+esc(image.id)+'" alt="">'+field('alt','Alt text',image.alt)+'<button type="button" class="secondary" data-photo="'+i+'" data-action="up" '+(!i?'disabled':'')+'>Up</button><button type="button" class="secondary" data-photo="'+i+'" data-action="down" '+(i===p.photos.length-1?'disabled':'')+'>Down</button><button type="button" class="secondary" data-photo="'+i+'" data-action="remove">Remove</button></div>').join('');
    document.querySelectorAll('#photos [name=alt]').forEach((input,i)=>input.oninput=()=>p.photos[i].alt=input.value);
    document.querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>{
      const i=Number(b.dataset.photo);
      if(b.dataset.action==='remove'){const [removed]=p.photos.splice(i,1);p.variants.forEach(v=>{if(v.photo===removed.id)v.photo='';});}
      else{const j=i+(b.dataset.action==='up'?-1:1);[p.photos[i],p.photos[j]]=[p.photos[j],p.photos[i]];}
      render();
    });
    document.querySelector('#variants').innerHTML=p.variants.map((v,i)=>'<fieldset class="form-grid variant"><legend>Variant '+(i+1)+'</legend>'+field('label','Size or shade',v.label)+field('sku','SKU',v.sku)+field('price','Price',v.price,'number').replace('type="number"','type="number" step="0.01"')+field('stock','Stock',v.stock,'number')+field('swatch','Shade hex (optional)',v.swatch)+'<label>Variant photo<select name="photo"><option value="">Default photo</option>'+p.photos.map((im,j)=>'<option value="'+esc(im.id)+'" '+(v.photo===im.id?'selected':'')+'>'+esc(im.alt||'Photo '+(j+1))+'</option>').join('')+'</select></label><button type="button" class="secondary" data-remove-variant="'+i+'" '+(p.variants.length===1?'disabled':'')+'>Remove variant</button></fieldset>').join('');
    document.querySelectorAll('.variant').forEach((group,i)=>group.querySelectorAll('input,select').forEach(input=>input.oninput=()=>p.variants[i][input.name]=input.value));
    document.querySelectorAll('[data-remove-variant]').forEach(b=>b.onclick=()=>{p.variants.splice(Number(b.dataset.removeVariant),1);render();});
  };
  render();
  document.querySelector('#back-admin').onclick=dashboard;
  document.querySelector('#add-variant').onclick=()=>{p.variants.push({label:'',sku:'',price:'',stock:0,swatch:'',photo:''});render();};
  const preview=document.querySelector('#preview');
  if(preview)preview.onclick=()=>{detail(original,true);document.querySelector('#back').onclick=e=>{e.preventDefault();editor(original);};};
  const remove=document.querySelector('#remove-product');
  if(remove)remove.onclick=async()=>{
    if(!confirm('Remove this product from the store? Products with order history will be archived.'))return;
    try{const result=await api('admin/product/'+p.id,undefined,'DELETE');await dashboard();notify(result.archived?'Product archived':'Product deleted');}catch(e){notify(e.message);}
  };
  document.querySelector('#upload').onchange=async e=>{
    const input=e.target,status=document.querySelector('#upload-status'),save=document.querySelector('#save-product');
    const files=[...input.files];input.disabled=true;save.disabled=true;status.textContent='Uploading…';
    try{
      if(p.photos.length+files.length>12)throw new Error('Use up to 12 photos.');
      for(const file of files){
        let image=file;
        if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG or WebP image.');
        const bitmap=await createImageBitmap(file);
        const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
        image=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.85))||file;
        const result=await api('admin/photo',image);
        p.photos.push({id:result.id,alt:''});
      }
      status.textContent='Photos uploaded. Save the product to keep them in its gallery.';
    }catch(error){status.textContent=error.message;}
    finally{render();input.value='';input.disabled=false;save.disabled=false;}
  };
  handle(form,async data=>{
    const values=Object.fromEntries(data);
    delete values.alt;delete values.photo;delete values.label;delete values.sku;delete values.price;delete values.stock;delete values.swatch;
    await api('admin/product',{...p,...values,featured:data.has('featured'),variants:p.variants.map(v=>({...v,price:Number(v.price),stock:v.stock===''?-1:Number(v.stock)}))});
    await dashboard();notify('Product saved');
  });
}
function settingsEditor(){
  const s=admin.settings;
  adminFrame('settings','<form id="configuration" class="panel stack">'+field('name','Store name',s.name)+field('currency','Currency code',s.currency)+field('contact','Contact details',s.contact)+area('delivery','Delivery & Returns policy',s.delivery)+area('privacy','Privacy policy',s.privacy)+area('regions','Delivery regions (one per line: name | fee | yes/no for cash on delivery)',s.regions.map(r=>r.name+' | '+r.fee+' | '+(r.cod?'yes':'no')).join('\n'))+'<label class="check"><input name="test" type="checkbox" '+(s.test?'checked':'')+'> Test mode</label>'+errorBox+'<div class="row"><button>Save settings</button><button class="secondary" type="button" id="settings-back">Back</button></div></form>');
  document.querySelector('#settings-back').onclick=()=>location.assign(adminUrl('overview'));
  handle(document.querySelector('#configuration'),async data=>{
    const values=Object.fromEntries(data);
    const regions=listLines(values.regions).map(line=>{const [name,fee,cod]=line.split('|').map(x=>x.trim());return {name,fee:fee?Number(fee):-1,cod:cod==='yes'};});
    settings=await api('admin/settings',{...values,test:data.has('test'),regions});
    layout();await dashboard();notify('Store settings saved');
  });
}
const listLines=value=>value.split('\n').map(x=>x.trim()).filter(Boolean);
try{
  ({settings,products}=await api('catalog'));layout();
  const titles={'/shop':'Shop products','/cart':'Cart','/checkout':'Guest checkout','/admin':'Store admin','/contact':'Contact','/delivery':'Delivery & Returns','/privacy':'Privacy'};
  document.title=titles[path]?titles[path]+' | '+settings.name:settings.name+' | Skincare & Cosmetics';
  if(path==='/')home();
  else if(path.startsWith('/track/')){
    try{
      const o=await api(path.slice(1));
      const current=o.stages.indexOf(o.status);
      main.innerHTML=section('Track your order','<p>Invoice '+esc(o.invoice)+'</p><p><strong>'+esc(o.status)+'</strong></p><ol>'+o.stages.map((stage,i)=>'<li'+(i===current?' aria-current="step"':'')+'>'+esc(stage)+(i<current?' ✓':'')+'</li>').join('')+'</ol>');
    }catch(error){main.innerHTML=section('Order unavailable','<p>'+esc(error.message)+'</p>');}
  }
  else if(path==='/shop')shop();
  else if(path.startsWith('/product/'))detail(products.find(p=>path.endsWith('-'+p.id)));
  else if(path==='/cart'||path==='/checkout')cartView(path==='/checkout');
  else if(path==='/admin')await dashboard();
  else if(path==='/contact')main.innerHTML=section('Contact','<p class="prose">'+esc(settings.contact||'Contact details will be added before launch.')+'</p>');
  else if(path==='/delivery'||path==='/privacy')main.innerHTML=section(titles[path],'<p class="prose">'+esc(settings[path.slice(1)])+'</p>');
}catch(error){main.innerHTML=section('Store unavailable','<p role="alert">'+esc(error.message)+'</p>');}

