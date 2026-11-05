import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const token=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function jsonBody(req) {
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw Error('请求过大');}return JSON.parse(body||'{}');
}
export async function startTaskApi(store,config) {
  const scopes=new Map();
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    try {
      if(req.headers.origin)throw Error('不接受浏览器跨域调用');
      if(req.method!=='POST'||req.headers['content-type']!=='application/json')throw Error('无效请求');
      const secret=(req.headers.authorization||'').replace(/^Bearer /,'');
      const found=[...scopes].find(([key])=>equal(secret,key));if(!found)throw Error('未授权');
      const task=found[1],body=await jsonBody(req);let result;
      if(req.url==='/consult/open')result=store.open({task,app:config.appId,chat:config.chatId,approver:body.approver,proposal:body.proposal});
      else if(req.url==='/consult/revise'){
        if(store.consult(body.id).task!==task)throw Error('不能修改其他任务');result=store.revise(body.id,body.proposal);
      }else if(req.url==='/consult/status')result=store.all('SELECT id,version,state,proposal FROM consults WHERE task=?',task);
      else throw Error('未知操作');
      res.end(JSON.stringify({ok:true,result}));
    }catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:e.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`,issue(task){const t=token();scopes.set(t,task);return t;},revoke(t){scopes.delete(t);}};
}
