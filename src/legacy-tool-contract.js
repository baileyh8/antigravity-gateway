'use strict';
const {prepareToolAdapter}=require('./agy-tool-adapter');
// Explicit historical fallback. The default path uses the bounded new contract.
function prepareLegacyToolContract(normalized,options={}){
 const adapter=prepareToolAdapter(normalized,options),source=normalized.tools||[];
 const names=new Map(source.map((tool,i)=>[tool.name,adapter.normalized.tools[i].name]));
 const reverse=new Map([...names].map(([a,b])=>[b,a]));
 return {...adapter,records:source.map(t=>({clientName:t.name,views:[{name:names.get(t.name),mode:'native'}]})),instructions:'',
  toProviderName:name=>names.get(name)||name,toProviderNames:name=>[names.get(name)||name],toClientName:name=>reverse.get(name)||name,
  toProviderReferences:items=>items,toClientReferences:items=>items,
  toProviderResult:(result,issued)=>({...result,name:issued?.name||names.get(result.name)||result.name}),
  toClientResult:result=>({...result,name:reverse.get(result.name)||result.name}),
  resultContract:name=>({clientName:reverse.get(name)||name,clientKind:source.find(t=>t.name===(reverse.get(name)||name))?.kind||'function',mode:'native'})};
}
async function prepareLegacyToolContractAsync(normalized, options = {}) {
 const {validateSchemaAsync}=require('./schema-contract'),{GatewayError}=require('./protocol');
 const adapter=prepareLegacyToolContract(normalized,{...options,validator:()=>true});
 const validate=async(call,strict)=>{const tool=(normalized.tools||[]).find(t=>t.name===call.name);if(!tool)return true;
  let args=call.arguments;
  if(typeof args==='string'&&tool.schema?.type==='object'){try{args=JSON.parse(args);}catch{ /* Worker rejects incomplete JSON. */ }}
  const valid=await validateSchemaAsync(args,tool.schema||{}, {signal:options.signal});
  if(!valid&&strict)throw new GatewayError('工具参数不符合客户端契约。',{code:'invalid_tool_arguments',status:502});return valid;};
 return {...adapter,toClient:async call=>{const result=adapter.toClient(call);await validate(result,true);return result;},
  toProvider:async call=>await validate(call,false)?adapter.toProvider(call):call};
}
module.exports={prepareLegacyToolContract,prepareLegacyToolContractAsync};
