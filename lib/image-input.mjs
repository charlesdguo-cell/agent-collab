// Images stay in memory and are never fetched from URLs supplied in chat text.
// A resource is requested only with the message/key pair returned by Feishu.
function imageMime(b){
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()))return 'image/gif';
  if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';
  throw Error('图片格式不可识别');
}
export async function prepareImages(context,fetchResource,{limit=4,maxBytes=6*1024*1024,totalBytes=12*1024*1024,timeoutMs=15000}={}){
  const sources=[context.event,...(context.topic?.items||[])].filter(Boolean),seen=new Set(),inputs=[],report=[];let used=0,attempted=0;
  for(const source of sources)for(const a of source.attachments||[]){
    if(a.type!=='image')continue;
    const id=source.id,key=a.key,pair=JSON.stringify([id,key]);if(seen.has(pair))continue;seen.add(pair);
    const entry={messageId:id,key,status:'unavailable'};report.push(entry);
    if(!/^om_[\w-]+$/.test(id)||!/^img_[\w-]+$/.test(key)){entry.reason='资源标识无效';continue;}
    if(attempted++>=limit||used>=totalBytes){entry.reason='图片数量或总大小上限';continue;}
    let timer,stream,expired=false;
    try{
      const bytes=await Promise.race([
        (async()=>{
          const resource=await fetchResource(id,key);
          stream=resource.getReadableStream();if(expired){stream.destroy();throw Error('图片读取超时');}
          const chunks=[];let size=0;
          for await(const chunk of stream){size+=chunk.length;if(size>Math.min(maxBytes,totalBytes-used)){stream.destroy();throw Error('图片超过大小上限');}chunks.push(chunk);}
          return Buffer.concat(chunks);
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;stream?.destroy();reject(Error('图片读取超时'));},timeoutMs);})
      ]);
      const mime=imageMime(bytes);used+=bytes.length;
      inputs.push({type:'image',url:`data:${mime};base64,${bytes.toString('base64')}`});
      Object.assign(entry,{status:'attached',inputIndex:inputs.length,bytes:bytes.length});
    }catch(e){entry.reason=['图片读取超时','图片超过大小上限','图片格式不可识别'].includes(e.message)?e.message:'图片下载失败（权限、资源或网络）；未看到图片内容';}
    finally{clearTimeout(timer);}
  }
  return {inputs,report};
}
