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
module.exports={prepareLegacyToolContract};
