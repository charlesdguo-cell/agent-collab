import {createInterface} from 'node:readline';
const tools=[
  {name:'consult_open',description:'Open a versioned Feishu consultation and suspend dependent work.',inputSchema:{type:'object',properties:{approver:{type:'string'},proposal:{type:'string'}},required:['approver','proposal'],additionalProperties:false}},
  {name:'consult_revise',description:'Replace the complete proposal of a pending consultation.',inputSchema:{type:'object',properties:{id:{type:'string'},proposal:{type:'string'}},required:['id','proposal'],additionalProperties:false}},
  {name:'consult_status',description:'Read consultations belonging to this task.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
export async function mcp(){
  for await(const line of createInterface({input:process.stdin})){
    let request;try{request=JSON.parse(line);}catch{continue;}
    if(request.id===undefined)continue;
    let response;
    try {
      if(request.method==='initialize')response={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'agent-collab',version:'0.1.0-alpha.1'}};
      else if(request.method==='ping')response={};
      else if(request.method==='tools/list')response={tools};
      else if(request.method==='tools/call'){
        const name=request.params?.name;if(!tools.some(t=>t.name===name))throw Error('Unknown tool');
        const url=process.env.AGENT_COLLAB_URL,key=process.env.AGENT_COLLAB_TOKEN;
        if(!url?.startsWith('http://127.0.0.1:')||!key)throw Error('Managed task context missing');
        const res=await fetch(url+'/consult/'+name.slice(8),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(request.params.arguments||{})});
        const data=await res.json();response={content:[{type:'text',text:JSON.stringify(data)}],isError:!data.ok};
      }else throw Error('Method not found');
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:response})+'\n');
    }catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:e.message}})+'\n');}
  }
}
