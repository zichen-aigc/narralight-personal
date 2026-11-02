import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const data=resolve(process.env.NARRALIGHT_PERSONAL_DATA_ROOT||join(homedir(),'.narralight-personal'));
for(const port of [3000,17371,17372])await new Promise((done,reject)=>{const s=createServer();s.once('error',()=>reject(Error(`端口 ${port} 已占用，请先关闭冲突服务。`)));s.listen(port,'127.0.0.1',()=>s.close(done));});
const env={...process.env,INFINITE_CANVAS_DATA_ROOT:data,INFINITE_CANVAS_DEPLOYMENT_PROFILE:'personal_local',INFINITE_CANVAS_INSTANCE_KIND:'standard',INFINITE_CANVAS_HOST:'127.0.0.1',INFINITE_CANVAS_PLATFORM_PORT:'17372',PORT:'17371',INFINITE_CANVAS_WEB_PORT:'3000',INFINITE_CANVAS_PLATFORM_URL:'http://127.0.0.1:17372',INFINITE_CANVAS_MANAGED_PROXY:'true',INFINITE_CANVAS_VOLC_ASSET_PROJECT_NAME:'narralight-personal'};
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();process.exitCode=code;}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
for(const [directory,args] of [['local-platform',['src/server.mjs']],['canvas-agent',['dist/index.js']],['web',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','3000','--strictPort']]]){
 const child=spawn(process.execPath,args,{cwd:join(root,directory),env,stdio:'inherit',windowsHide:true});children.push(child);child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',()=>{if(!stopping)stop(1);});
}
console.log('叙光个人版：http://127.0.0.1:3000；数据目录：'+data);
