import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
function git(args){const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||'Git failed');return r.stdout.trim();}
if(git(['status','--porcelain']))throw Error('工作区有本地修改，请先保存并提交，再更新。');
if(git(['branch','--show-current'])!=='main')throw Error('请切换到 main 分支再更新。');
const origin=git(['remote','get-url','origin']);
if(!['https://github.com/zichen-aigc/narralight-personal.git','git@github.com:zichen-aigc/narralight-personal.git'].includes(origin))throw Error('origin 不是官方个人版仓库，已停止。');
git(['pull','--ff-only','origin','main']);
const r=spawnSync(process.execPath,['scripts/setup.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});if(r.error)throw r.error;process.exitCode=r.status===0?0:(r.status||1);
