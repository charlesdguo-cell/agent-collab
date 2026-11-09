// One projection for receive events, replay and quoted topic context. Body text
// is external data; only the platform's mention list controls routing.
export function messageContent(type,content,platformMentions=[],botId) {
  let body;try{body=typeof content==='string'?JSON.parse(content):content;}catch{return {text:'[消息正文解析失败]',attachments:[],partial:true};}
  const mentions=(Array.isArray(platformMentions)?platformMentions:[]).map(m=>({...m,id:typeof m.id==='string'?m.id:m.id?.open_id}));
  const attachments=[],warnings=new Set();
  const str=x=>typeof x==='string'?x:'';
  const mentionText=m=>botId&&m?.id===botId?'':`@${m?.name||'参与者'}`;
  const replaceMentions=text=>{for(const m of mentions)if(m.key)text=text.replaceAll(m.key,mentionText(m));return text;};
  const resource=(kind,key)=>{
    if(!str(key)){warnings.add('资源键缺失');return `[${kind}：资源键缺失]`;}
    if(!attachments.some(x=>x.type===kind&&x.key===key))attachments.push({type:kind,key});
    return `[${kind==='image'?'图片':'媒体'}：${key}]`;
  };
  if(!body||typeof body!=='object')return {text:'[消息正文解析失败]',attachments,partial:true};
  let text='';
  if(type==='text'){
    if(typeof body.text!=='string')warnings.add('文本正文缺失');
    text=replaceMentions(str(body.text));
  }else if(type==='image')text=resource('image',body.image_key);
  else if(type==='post'){
    const post=Array.isArray(body.content)||Array.isArray(body.content_v2)?body:
      [body.zh_cn,body.en_us,...Object.values(body)].find(x=>x&&typeof x==='object'&&(Array.isArray(x.content)||Array.isArray(x.content_v2)));
    if(!post)warnings.add('富文本正文缺失');
    else {
      const node=n=>{
        if(!n||typeof n!=='object'){warnings.add('富文本节点无效');return '';}
        switch(n.tag){
          case 'text':case 'md':case 'markdown':return replaceMentions(str(n.text));
          case 'a':return `${str(n.text)||str(n.href)}${n.text&&n.href?` (${str(n.href)})`:''}`;
          case 'at':return mentionText(mentions.find(m=>m.key===n.user_id||m.id===n.user_id)||{name:str(n.user_name)||str(n.user_id)});
          case 'img':return resource('image',n.image_key);
          case 'media':return resource('file',n.file_key);
          case 'emotion':return `[表情：${str(n.emoji_type)}]`;
          case 'code_block':return `\n\`\`\`${str(n.language)}\n${str(n.text)}\n\`\`\`\n`;
          case 'hr':return '\n---\n';
          default:warnings.add('未支持的富文本节点');return str(n.text)||'[未支持的富文本节点]';
        }
      };
      const rows=Array.isArray(post.content)?post.content:post.content_v2;
      text=[str(post.title),...rows.map(row=>Array.isArray(row)?row.map(node).join(''):(warnings.add('富文本行无效'),''))].filter(Boolean).join('\n');
    }
  }else {text=`[${str(type)||'unknown'} 消息：未解析]`;warnings.add('未支持的消息类型');}
  if(warnings.size)text+=`\n[读取不完整：${[...warnings].join('；')}]`;
  return {text:text.trim(),attachments,partial:warnings.size>0};
}
