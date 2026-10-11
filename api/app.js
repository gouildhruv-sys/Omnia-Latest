const K=process.env.SUPABASE_KEY,U=process.env.SUPABASE_URL+'/rest/v1/',E=encodeURIComponent;
const db=async(p,m='GET',b,up)=>{const r=await fetch(U+p,{method:m,headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json',Prefer:(up?'resolution=merge-duplicates,':'')+'return=minimal'},body:b&&JSON.stringify(b)});const t=await r.text();return t?JSON.parse(t):null};
const jf=(u,h,b)=>fetch(u,{method:b?'POST':'GET',headers:{'Content-Type':'application/json',...h},body:b&&JSON.stringify(b)}).then(r=>r.json());
const gem=(m,b)=>jf(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${process.env.GEMINI_KEY}`,{},b);
const conf=async()=>{const c={};(await db('kv?select=*')||[]).forEach(x=>c[x.k]=x.v);return c};

async function ai(req,res,b){
  const{uid,kind,prompt}=b,hist=Array.isArray(b.hist)?b.hist.slice(-10):[];
  if(!/^[\w-]{4,40}$/.test(uid||'')||!prompt||!['chat','code','image','video'].includes(kind))return res.status(400).json({error:'Bad request'});
  const cfg=await conf();
  if(cfg.maintenance)return res.json({error:'App is under maintenance. Try again soon.'});
  if(cfg.off&&cfg.off[kind])return res.json({error:'This section is turned off.'});
  const u=(await db(`users?uid=eq.${E(uid)}&select=blocked,n`))[0]||{};
  if(u.blocked)return res.json({error:'Your account is blocked.'});
  if(cfg.limit>0){const day=new Date().toISOString().slice(0,10);const used=(await db(`logs?uid=eq.${E(uid)}&ts=gte.${day}&select=id`)).length;if(used>=cfg.limit)return res.json({error:'Daily limit reached. Come back tomorrow.'})}
  await db('users?on_conflict=uid','POST',{uid,name:String(b.name||'Guest').slice(0,30),country:req.headers['x-vercel-ip-country']||'?',city:decodeURIComponent(req.headers['x-vercel-ip-city']||''),last_seen:new Date().toISOString(),n:(u.n||0)+1},true);
  let out;
  if(kind==='chat'){
    const d=await gem(process.env.GEMINI_MODEL||'gemini-2.5-flash',{contents:[...hist,{role:'user',parts:[{text:prompt}]}]});
    out={text:d.candidates?.[0]?.content?.parts?.[0]?.text||d.error?.message||'No reply'};
  }else if(kind==='code'){
    const d=await jf('https://api.groq.com/openai/v1/chat/completions',{Authorization:'Bearer '+process.env.GROQ_KEY},{model:process.env.GROQ_MODEL||'llama-3.3-70b-versatile',messages:[{role:'system',content:'You are an expert programmer. Answer with clean code in markdown code blocks and a short explanation.'},...hist.map(m=>({role:m.role==='model'?'assistant':'user',content:m.parts?.[0]?.text||''})),{role:'user',content:prompt}]});
    out={text:d.choices?.[0]?.message?.content||d.error?.message||'No reply'};
  }else if(kind==='image'){
    const d=await gem(process.env.IMAGE_MODEL||'gemini-2.5-flash-image',{contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}});
    const p=(d.candidates?.[0]?.content?.parts||[]).find(x=>x.inlineData);
    out=p?{img:`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`}:{error:d.error?.message||'Image was not generated. Try another prompt.'};
  }else{
    const d=await jf('https://api.heygen.com/v2/video/generate',{'X-Api-Key':process.env.HEYGEN_KEY},{video_inputs:[{character:{type:'avatar',avatar_id:process.env.HEYGEN_AVATAR,avatar_style:'normal'},voice:{type:'text',input_text:prompt,voice_id:process.env.HEYGEN_VOICE}}],dimension:{width:1280,height:720}});
    out=d.data?.video_id?{vid:d.data.video_id}:{error:d.error?.message||'Video failed to start'};
  }
  await db('logs','POST',{uid,kind,prompt:prompt.slice(0,4000),reply:out.text||(out.img?'[image]':out.vid?'[video '+out.vid+']':out.error)});
  return res.json(out);
}

module.exports=async(req,res)=>{
  const a=req.query.a,b=req.body||{};
  try{
    if(a==='config')return res.json(await conf());
    if(a==='ai')return await ai(req,res,b);
    if(a==='vs'){const d=await jf('https://api.heygen.com/v1/video_status.get?video_id='+E(b.id),{'X-Api-Key':process.env.HEYGEN_KEY});return res.json({status:d.data?.status,url:d.data?.video_url})}
    if(!process.env.ADMIN_PASSWORD||req.headers['x-admin']!==process.env.ADMIN_PASSWORD)return res.status(401).json({error:'Wrong password'});
    if(a==='hg'){const h={'X-Api-Key':process.env.HEYGEN_KEY},[av,vo]=await Promise.all([jf('https://api.heygen.com/v2/avatars',h),jf('https://api.heygen.com/v2/voices',h)]);return res.json({error:av.error?.message||vo.error?.message,avatars:(av.data?.avatars||[]).slice(0,100).map(x=>({id:x.avatar_id,name:x.avatar_name,gender:x.gender,img:x.preview_image_url})),voices:(vo.data?.voices||[]).slice(0,400).map(x=>({id:x.voice_id,name:x.name,lang:x.language,gender:x.gender}))})}
    if(a==='stats'){const us=await db('users?select=blocked,last_seen&limit=10000'),ls=await db('logs?select=kind&limit=20000'),kinds={};ls.forEach(l=>kinds[l.kind]=(kinds[l.kind]||0)+1);const t=Date.now()-3e5;return res.json({users:us.length,blocked:us.filter(u=>u.blocked).length,active:us.filter(u=>new Date(u.last_seen)>t).length,logs:ls.length,kinds})}
    if(a==='users')return res.json(await db('users?select=*&order=last_seen.desc&limit=300'));
    if(a==='logs'){let f='';if(b.uid)f+=`&uid=eq.${E(b.uid)}`;if(b.kind)f+=`&kind=eq.${E(b.kind)}`;if(b.q)f+=`&prompt=ilike.*${E(b.q)}*`;return res.json(await db('logs?select=*&order=ts.desc&limit=150'+f))}
    if(a==='block'){await db(`users?uid=eq.${E(b.uid)}`,'PATCH',{blocked:!!b.blocked});return res.json({ok:1})}
    if(a==='wipe'){await db(`logs?uid=eq.${E(b.uid)}`,'DELETE');return res.json({ok:1})}
    if(a==='set'){await db('kv?on_conflict=k','POST',{k:String(b.k),v:b.v},true);return res.json({ok:1})}
    res.status(404).json({error:'Unknown action'});
  }catch(e){res.status(500).json({error:e.message})}
};
