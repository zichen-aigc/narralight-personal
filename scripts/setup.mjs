import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
function run(command,args,cwd){const r=spawnSync(command,args,{cwd,stdio:'inherit',shell:process.platform==='win32'&&command==='npm',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
for(const name of ['local-platform','canvas-agent','plugins/canvas/registry'])run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],join(root,name));
run(process.env.NARRALIGHT_BUN||(process.platform==='win32'?'bun.exe':'bun'),['install','--frozen-lockfile','--ignore-scripts'],join(root,'web'));
run(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.json'],join(root,'canvas-agent'));
run(process.execPath,['build.mjs'],join(root,'plugins/canvas/registry'));
mkdirSync(join(root,'web/public/plugins'),{recursive:true});
cpSync(join(root,'plugins/canvas/registry/dist'),join(root,'web/public/plugins'),{recursive:true});
run(process.execPath,['node_modules/vite/bin/vite.js','build'],join(root,'web'));
console.log('准备完成。运行 node start-personal.mjs');
