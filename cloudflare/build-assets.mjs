import {cp,mkdir,readdir} from 'node:fs/promises';
await mkdir('.worker-assets/Aurella',{recursive:true});
for(const name of await readdir('.')){
  if(name==='index.html'||/^Aurella-.*\.html$/.test(name)) await cp(name,'.worker-assets/'+name);
}
for(const name of ['app.js','style.css']) await cp('Aurella/'+name,'.worker-assets/'+name);
await cp('Aurella/index.html','.worker-assets/store-app.html');
await cp('Aurella/skin','.worker-assets/skin',{recursive:true});
await cp('Aurella/skin','.worker-assets/Aurella/skin',{recursive:true});
await cp('public','.worker-assets/public',{recursive:true});
