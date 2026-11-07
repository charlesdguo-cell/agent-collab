// The WebSocket lifecycle must never gate durable history or job scheduling.
export function startBackground(service,transport,{processInterval=2000,syncInterval=30000,onError=()=>{}}={}){
  let stopped=false;
  const run=(name,fn)=>Promise.resolve().then(()=>{if(!stopped)return fn();}).catch(()=>onError(name));
  const timer=setInterval(()=>run('tick',()=>service.tick()),processInterval);
  const syncTimer=setInterval(()=>run('reconcile',()=>service.reconcile()),syncInterval);
  run('introduce',async()=>{await service.introduce();await service.flush();});
  run('listen',()=>transport.listen(e=>service.receive(e),()=>service.announcements.refresh({force:true})));
  run('reconcile',()=>service.reconcile());
  return ()=>{stopped=true;clearInterval(timer);clearInterval(syncTimer);};
}
