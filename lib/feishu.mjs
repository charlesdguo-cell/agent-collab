import * as lark from '@larksuiteoapi/node-sdk';
const quietLogger={error(){},warn(){},info(){},debug(){},trace(){}};

export function normalize(app,data,botId) {
  const m=data.message,s=data.sender;
  if(!m || !s || m.message_type!=='text')return null;
  let text;try{text=JSON.parse(m.content).text;}catch{return null;}
  const mentions=(m.mentions||[]).map(m=>({...m,id:typeof m.id==='string'?{open_id:m.id}:m.id}));
  for(const mention of mentions)if(mention.id?.open_id===botId)text=text.replaceAll(mention.key,'');
  return {app,id:m.message_id,chat:m.chat_id,root:m.root_id||null,parent:m.parent_id||null,
    chatType:m.chat_type,
    thread:m.thread_id||null,sender:s.sender_id?.open_id,senderType:s.sender_type==='bot'?'app':s.sender_type,
    mentions:mentions.map(m=>({id:m.id?.open_id||m.id,name:m.name})),
    text:text.trim(),mentioned:mentions.some(m=>m.id?.open_id===botId)};
}
export class Feishu {
  static async discover(appId,appSecret){
    const auth=await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret}),signal:AbortSignal.timeout(15000)});
    const a=await auth.json();if(a.code!==0||!a.tenant_access_token)throw Error('应用认证失败，请核对 App ID 和 App Secret');
    const r=await fetch('https://open.feishu.cn/open-apis/bot/v3/info',{headers:{Authorization:'Bearer '+a.tenant_access_token},signal:AbortSignal.timeout(15000)});
    const b=await r.json();if(b.code!==0||!b.bot?.open_id)throw Error('未发现机器人能力，请先启用并发布应用机器人');
    return {botId:b.bot.open_id,name:b.bot.app_name||'开发助手'};
  }
  constructor(config) {
    this.config=config;
    this.client=new lark.Client({appId:config.appId,appSecret:config.appSecret,logger:quietLogger,loggerLevel:lark.LoggerLevel.error});
  }
  async send(out) {
    const data={msg_type:'text',content:JSON.stringify({text:out.body}),uuid:out.id};
    const response=out.root
      ?await this.client.im.message.reply({path:{message_id:out.root},data:{...data,reply_in_thread:true}})
      :await this.client.im.message.create({params:{receive_id_type:'chat_id'},data:{...data,receive_id:out.chat}});
    if(response.code!==0 || !response.data?.message_id)throw Error(`飞书发送失败 (${response.code})`);
    return response.data.message_id;
  }
  async bots(chat){
    let r;try{r=await this.client.request({method:'GET',url:`/open-apis/im/v1/chats/${encodeURIComponent(chat)}/members/bots`});}catch(e){throw Error('群机器人名录读取失败（'+(e.response?.data?.code||'network')+'）');}
    if(r.code!==0)throw Error('无法读取群机器人身份');
    return r.data?.items||[];
  }
  async history(chat,{start,limit=50}={}) {
    const params={container_id_type:'chat',container_id:chat,page_size:Math.min(50,limit),sort_type:'ByCreateTimeDesc'};
    if(start)params.start_time=String(start);
    const r=await this.client.im.message.list({params});
    if(r.code!==0)throw Error(`历史读取失败 (${r.code})`);
    return {items:r.data?.items||[],hasMore:!!r.data?.has_more};
  }
  async replay(container,type,start,{maxPages=10}={}) {
    const items=[];let page_token;
    for(let page=0;page<maxPages;page++){
      const params={container_id_type:type,container_id:container,page_size:50,sort_type:'ByCreateTimeAsc',start_time:String(start)};
      if(page_token)params.page_token=page_token;
      const r=await this.client.im.message.list({params});if(r.code!==0)throw Error(`补取消息失败 (${r.code})`);
      items.push(...r.data?.items||[]);if(!r.data?.has_more)return {items,complete:true};page_token=r.data.page_token;
      if(!page_token)throw Error('飞书分页缺少游标，不能宣称消息已补齐');
    }
    return {items,complete:false};
  }
  async thread(root){
    const r=await this.client.im.message.get({path:{message_id:root}});if(r.code!==0)throw Error('无法读取原咨询消息');
    return r.data?.items?.[0]?.thread_id||null;
  }
  async topicContext(root){
    // Read only this topic. Never fill missing context with unrelated group traffic.
    try{
      const r=await this.client.im.message.get({path:{message_id:root}});
      if(r.code!==0||!r.data?.items?.length)return {available:false,reason:'原消息不可读'};
      const first=r.data.items[0];let items=[first],partial=false;
      if(first.thread_id){
        try{
          const replies=await this.client.im.message.list({params:{container_id_type:'thread',container_id:first.thread_id,page_size:20,sort_type:'ByCreateTimeDesc'}});
          if(replies.code===0){items.push(...[...(replies.data?.items||[])].reverse());partial=!!replies.data?.has_more;}else partial=true;
        }catch{partial=true;}
      }
      const seen=new Set();return {available:true,partial,items:items.filter(m=>!m.deleted&&!seen.has(m.message_id)&&seen.add(m.message_id)).map(m=>{
        let text='';try{text=JSON.parse(m.body?.content||'{}').text||'';}catch{}
        return {id:m.message_id,sender:m.sender,type:m.msg_type,text:text.slice(0,16000)};
      })};
    }catch{return {available:false,reason:'话题上下文读取失败；不能假定已读到原文'};}
  }
  fromHistory(m,root){
    return normalize(this.config.appId,{message:{...m,message_type:m.msg_type,chat_id:m.chat_id||this.config.chatId,root_id:m.root_id||root,content:m.body?.content},sender:{sender_type:m.sender?.sender_type,sender_id:{open_id:m.sender?.open_bot_id||m.sender?.id}}},this.config.botId);
  }
  listen(handler) {
    this.ws=new lark.WSClient({appId:this.config.appId,appSecret:this.config.appSecret,logger:quietLogger,loggerLevel:lark.LoggerLevel.error});
    return this.ws.start({eventDispatcher:new lark.EventDispatcher({}).register({
      'im.message.receive_v1':async data=>{const e=normalize(this.config.appId,data,this.config.botId);if(e)await handler(e);}
    })});
  }
}
