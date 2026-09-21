import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('out');
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.txt':'text/plain','.woff2':'font/woff2','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    let file=resolve(root,'.'+decodeURIComponent(url.pathname));
    if(file!==root&&!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
    if((await stat(file)).isDirectory()) file=resolve(file,'index.html');
    const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream'}).end(data);
  } catch {res.writeHead(404,{'content-type':'text/html; charset=utf-8'}).end(await readFile(resolve(root,'404.html')).catch(()=> 'Not found'));}
}).listen(Number(process.env.PORT??3100),'127.0.0.1');
