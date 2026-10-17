import {useCallback,useEffect,useRef,useState} from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import {File} from 'expo-file-system';
import {addAssistantMessage,addUserMessage,getAssistantForRequest,getMessageById,getMessagesPage,initDatabase,markDelivered,markSyncing,seedBenchmarkMessages,setAssistantToken,THREAD_ID,updateMessage} from './db';
import {mergeMessages} from './history';
import type {ChatMessage,StreamMetrics} from './types';

const API_BASE=process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/,'');
const emptyMetrics:StreamMetrics={ttftMs:null,tokensPerSecond:0,tokenCount:0};
export function useChat(){
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [online,setOnline]=useState(false);
  const [ready,setReady]=useState(false);
  const [hasOlder,setHasOlder]=useState(false);
  const [loadingOlder,setLoadingOlder]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const ref=useRef<ChatMessage[]>([]);
  const busy=useRef(false);
  const mounted=useRef(true);
  const replace=useCallback((next:ChatMessage[])=>{ref.current=next;if(mounted.current)setMessages(next);},[]);
  const patch=useCallback((id:string,change:Partial<ChatMessage>)=>replace(ref.current.map(item=>item.id===id?{...item,...change}:item)),[replace]);
  const refresh=useCallback(async()=>{const page=await getMessagesPage();replace(page.messages);setHasOlder(page.hasOlder);},[replace]);
  const loadOlder=useCallback(async()=>{if(loadingOlder||!hasOlder||!ref.current.length)return;setLoadingOlder(true);try{const first=ref.current[0];const page=await getMessagesPage({createdAt:first.createdAt,id:first.id});replace(mergeMessages(ref.current,page.messages));setHasOlder(page.hasOlder);}catch{setError('Purane messages nahi khule.');}finally{setLoadingOlder(false);}},[hasOlder,loadingOlder,replace]);
  const seedBenchmark=useCallback(async()=>{if(__DEV__){await seedBenchmarkMessages();await refresh();}},[refresh]);
  useEffect(()=>{mounted.current=true;void initDatabase().then(refresh).then(()=>{if(mounted.current)setReady(true);}).catch(()=>setError('Chat storage nahi khula.'));const subscription=NetInfo.addEventListener(state=>setOnline(Boolean(state.isConnected&&state.isInternetReachable!==false)));return()=>{mounted.current=false;subscription();};},[refresh]);

  const requestReply=useCallback(async(user:ChatMessage,previous?:ChatMessage)=>{
    if(busy.current)return;
    if(!API_BASE){setError('Backend URL configure karo.');return;}
    busy.current=true;
    const assistant:ChatMessage=previous?{...previous,content:'',status:'streaming',error:null}:{id:Crypto.randomUUID(),threadId:THREAD_ID,role:'assistant',content:'',createdAt:Date.now(),status:'streaming',replyToId:user.id,requestId:user.id,error:null};
    try{
      await markSyncing(user.id);patch(user.id,{status:'syncing',error:null});
      if(previous)await updateMessage(assistant.id,assistant);else await addAssistantMessage(assistant);
      if(previous)patch(assistant.id,assistant);else replace(mergeMessages(ref.current,[assistant]));
      const history=ref.current.filter(item=>item.id!==user.id&&item.id!==assistant.id&&item.kind!=='audio'&&item.status==='delivered'&&item.content.trim()).slice(-10).map(item=>({role:item.role,content:item.content}));
      const requestId=Crypto.randomUUID();
      let response:Response;
      if(user.kind==='audio'){
        const file=new File(user.audioUri!);
        if(!file.exists||file.size>3_000_000)throw new Error('Recording nahi mili ya 3 MB se badi hai.');
        const extension=user.audioUri?.split('.').pop()?.toLowerCase();
        const mime=extension==='m4a'||extension==='mp4'?'audio/mp4':extension==='aac'?'audio/aac':extension==='wav'?'audio/wav':extension==='webm'?'audio/webm':extension==='3gp'?'audio/3gpp':null;
        if(!mime)throw new Error('Recording format supported nahi hai.');
        const form=new FormData();form.append('audio',{uri:user.audioUri!,name:`recording.${extension}`,type:mime} as unknown as Blob);form.append('durationSeconds',String((user.audioDurationMs||0)/1000));form.append('history',JSON.stringify(history));form.append('requestId',requestId);
        response=await fetch(`${API_BASE}/api/voice`,{method:'POST',body:form});
      }else response=await fetch(`${API_BASE}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:user.content,history,requestId})});
      const result=await response.json() as {reply?:string;audioToken?:string;error?:{message?:string;retryAfterSeconds?:number}};
      if(!response.ok||!result.reply)throw new Error((result.error?.message||'AI se jawab nahi mila.')+(result.error?.retryAfterSeconds&&response.status===429?` ${Math.ceil(result.error.retryAfterSeconds/60)} min baad try karo.`:''));
      await markDelivered(user.id);patch(user.id,{status:'delivered',error:null});
      const delivered={...assistant,content:result.reply,status:'delivered' as const,audioToken:user.kind==='audio'&&typeof result.audioToken==='string'?result.audioToken:null};await updateMessage(assistant.id,delivered);if(delivered.audioToken)await setAssistantToken(assistant.id,delivered.audioToken);patch(assistant.id,delivered);
    }catch(cause){const reason=cause instanceof Error?cause.message:'Network error. Dobara try karo.';await markDelivered(user.id).catch(()=>undefined);patch(user.id,{status:'delivered'});const failed={...assistant,content:'',status:'failed' as const,error:reason};await updateMessage(assistant.id,failed).catch(()=>undefined);patch(assistant.id,failed);setError(reason);}finally{busy.current=false;}
  },[patch,replace]);
  const send=useCallback(async(input:string,replyToId:string|null):Promise<boolean>=>{const content=input.trim();if(!content||content.length>2000||!ready||busy.current)return false;const user:ChatMessage={id:Crypto.randomUUID(),threadId:THREAD_ID,role:'user',content,createdAt:Date.now(),status:'pending',replyToId,requestId:null,error:null};try{await addUserMessage(user);replace(mergeMessages(ref.current,[user]));setError(null);if(online)void requestReply(user);return true;}catch{setError('Message save nahi hua.');return false;}},[online,ready,replace,requestReply]);
  const sendVoice=useCallback(async(audioUri:string,audioDurationMs:number,audioWaveform:number[],replyToId:string|null):Promise<boolean>=>{if(!ready||busy.current||audioDurationMs<500||audioDurationMs>120000)return false;const user:ChatMessage={id:Crypto.randomUUID(),threadId:THREAD_ID,role:'user',content:'',createdAt:Date.now(),status:'pending',replyToId,requestId:null,error:null,kind:'audio',audioUri,audioDurationMs,audioWaveform};try{await addUserMessage(user);replace(mergeMessages(ref.current,[user]));setError(null);if(online)void requestReply(user);return true;}catch{setError('Voice message save nahi hua.');return false;}},[online,ready,replace,requestReply]);
  const retry=useCallback(async(message:ChatMessage)=>{if(busy.current)return;if(!online){setError('Online aane par dobara try karo.');return;}const user=message.role==='user'?message:message.requestId?await getMessageById(message.requestId):null;if(!user)return;const previous=await getAssistantForRequest(user.id);if(previous?.status==='delivered')return;await requestReply(user,previous||undefined);},[online,requestReply]);
  return{messages,online,ready,hasOlder,loadingOlder,loadOlder,seedBenchmark,error,metrics:emptyMetrics,send,sendVoice,retry,clearError:()=>setError(null)};
}
