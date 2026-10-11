// Daily Compass. The screens and actions come from the original Claude artifact;
// storage now goes to Supabase (see "store" below), plus a Next 5 queue on the To-do tab.
import { importToDocs, backupJSON } from "./importData.js";

const PRIO=[["asap","ASAP"],["high","High"],["normal","Normal"],["low","Low"]];
const PRANK={asap:0,high:1,normal:2,low:3};
const CATS=["Investment","Personal"];
// Older tasks may still say Finance, Work or Family: Finance shows as Investment, the others as Personal.
const catOf=x=>x.cat==="Finance"||x.cat==="Investment"?"Investment":"Personal";
const TABS=[
 ["today","Today",'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
 ["timeline","Timeline",'<path d="M4 6h3M4 12h3M4 18h3"/><circle cx="11" cy="6" r="1.6"/><circle cx="11" cy="12" r="1.6"/><circle cx="11" cy="18" r="1.6"/><path d="M15 6h5M15 12h5M15 18h5"/>'],
 ["tasks","To-do",'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>'],
 ["goals","Mind",'<path d="M7 18a4 4 0 0 1-.7-7.9A5.5 5.5 0 0 1 17 8.5a4.2 4.2 0 0 1 .5 8.4z"/><circle cx="6" cy="21" r="1"/>'],
 ["plans","Plans",'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
 ["wishes","Wish list",'<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7c-2-4-6-4-6-1s6 1 6 1zM12 7c2-4 6-4 6-1s-6 1-6 1z"/>'],
 ["portfolio","Portfolio",'<path d="M3 20h18M6 16l4-5 3 3 5-7"/><path d="M15 7h3v3"/>'],
 ["notes","Notes",'<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>']
];
const ICON_CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
const NEXT_LIMIT=5;
const ICON_UP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 15l6-6 6 6"/></svg>';
const ICON_DOWN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';

const S={addKind:"decide",addWt:3,showParked:false,items:[],checkins:{},holdings:[],pf:{},snaps:{},hadd:null,hopen:null,live:{},pfSort:{key:"value",dir:"desc"},fopen:null,tab:"today",open:null,adding:null,confirmDel:null,draft:[],addPrio:"normal",addCat:"Personal",loaded:false,mode:"loading",err:""};
try{const o=JSON.parse(localStorage.getItem("dc-pfsort")||"null");if(o&&["ticker","value","gain"].includes(o.key))S.pfSort=o}catch(e){}
try{const t=localStorage.getItem("dc-tab");if(t&&TABS.some(x=>x[0]===t))S.tab=t}catch(e){}

/* ---------- dates ---------- */
const pad=n=>String(n).padStart(2,"0");
const key=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse=k=>{const[y,m,d]=k.split("-").map(Number);return new Date(y,m-1,d)};
const today=()=>key(new Date());
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const fmt=k=>parse(k).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
const daysTo=k=>Math.round((parse(k)-parse(today()))/864e5);
function dueLabel(k){if(!k)return"";const n=daysTo(k);
 if(n<0)return'<span class="overdue">overdue '+(-n)+'d</span>';
 if(n===0)return'<span class="overdue">today</span>';
 if(n===1)return"tomorrow";return fmt(k)+' <span class="mono">· '+n+'d</span>'}
function weekStart(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d.getTime()}
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>"i"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

/* ---------- store: Supabase, with an offline outbox ---------- */
// Every change shows at once and is kept on this device. It is also queued in an "outbox"
// that is sent to Supabase in order. While offline the queue waits and is sent when you're back.
// Changes made on your other devices arrive live.
let sb=null,userId=null,busy=false,again=false,outbox=[];
const CACHE_KEY="dc-data",OUTBOX_KEY="dc-outbox";
function local(){try{const v=JSON.parse(localStorage.getItem(CACHE_KEY)||"{}");S.items=v.items||[];S.checkins=v.checkins||{};S.holdings=v.holdings||[];S.pf=v.pf||{};S.snaps=v.snaps||{};return !!v.items}catch(e){return false}}
function saveLocal(){try{localStorage.setItem(CACHE_KEY,JSON.stringify({items:S.items,checkins:S.checkins,holdings:S.holdings,pf:S.pf,snaps:S.snaps}))}catch(e){}}
function saveOutbox(){try{localStorage.setItem(OUTBOX_KEY,JSON.stringify(outbox))}catch(e){}}
// data = null means delete
function applyDoc(coll,id,data){
 if(coll==="items"||coll==="holdings"){const L=S[coll],i=L.findIndex(x=>x.id===id);
  if(!data){if(i>=0)L.splice(i,1)}else if(i<0)L.push({id,...data});else L[i]={id,...data}}
 else if(S[coll]){if(data)S[coll][id]=data;else delete S[coll][id]}}
function queue(op){if(!sb)return;outbox.push(op);saveOutbox();sync()}
async function put(coll,id,data){applyDoc(coll,id,data);saveLocal();render();queue({set:[{coll,id,data}]})}
async function del(coll,id){applyDoc(coll,id,null);saveLocal();render();queue({del:{coll,id}})}
// Many writes at once (used by import)
function putMany(docs){docs.forEach(d=>applyDoc(d.coll,d.id,d.data));saveLocal();render();
 for(let i=0;i<docs.length;i+=500)queue({set:docs.slice(i,i+500)})}
function setSync(s){if(S.sync!==s){S.sync=s;render()}}
async function sync(){
 if(!sb)return;
 if(busy){again=true;return}
 busy=true;setSync("syncing");
 try{
  // 1. send queued changes, oldest first
  while(outbox.length){const op=outbox[0];
   const r=op.del
    ?await sb.from("docs").delete().match({user_id:userId,collection:op.del.coll,id:op.del.id})
    :await sb.from("docs").upsert(op.set.map(d=>({user_id:userId,collection:d.coll,id:d.id,data:d.data,updated_at:new Date().toISOString()})));
   if(r.error)throw r.error;
   outbox.shift();saveOutbox()}
  // 2. download everything, 1000 rows at a time
  const rows=[];
  for(let from=0;;from+=1000){const r=await sb.from("docs").select("collection,id,data").order("collection").order("id").range(from,from+999);
   if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<1000)break}
  if(!outbox.length){S.items=[];S.holdings=[];S.checkins={};S.pf={};S.snaps={};rows.forEach(r=>applyDoc(r.collection,r.id,r.data));saveLocal();render()}
  setSync("synced");refreshPrices()
 }catch(e){console.warn("Sync failed:",e);setSync(navigator.onLine?"error":"offline")}
 finally{busy=false;if(!S.loaded){S.loaded=true;render()}if(again){again=false;sync()}}
}
async function init(){
 S.loaded=local();
 try{outbox=JSON.parse(localStorage.getItem(OUTBOX_KEY)||"[]")}catch(e){outbox=[]}
 if(!sb){S.mode="local";S.loaded=true;render();return}
 S.mode="db";S.sync=navigator.onLine?"syncing":"offline";render();sync();
 window.addEventListener("online",sync);
 window.addEventListener("offline",()=>setSync("offline"));
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")sync()});
 setInterval(()=>{if(outbox.length)sync()},30000);
 const pending=(coll,id)=>outbox.some(o=>o.del?o.del.coll===coll&&o.del.id===id:o.set.some(d=>d.coll===coll&&d.id===id));
 sb.channel("docs-live").on("postgres_changes",{event:"*",schema:"public",table:"docs"},p=>{
  const r=p.eventType==="DELETE"?p.old:p.new;
  if(!r||!r.collection||pending(r.collection,r.id))return;
  applyDoc(r.collection,r.id,p.eventType==="DELETE"?null:r.data);saveLocal();render()}).subscribe();
}
const item=id=>S.items.find(x=>x.id===id);
function patch(id,changes){const it=item(id);if(!it)return;const v={...it,...changes};delete v.id;put("items",id,v)}

/* ---------- selectors ---------- */
const of=t=>S.items.filter(x=>x.type===t);
const byPrio=(a,b)=>(PRANK[a.prio]??2)-(PRANK[b.prio]??2)||((a.due||"9")<(b.due||"9")?-1:(a.due||"9")>(b.due||"9")?1:0)||(a.createdAt||0)-(b.createdAt||0);
// Next 5 order: priority, then oldest first
const byPrioAge=(a,b)=>(PRANK[a.prio]??2)-(PRANK[b.prio]??2)||(a.createdAt||0)-(b.createdAt||0);
function streak(){let d=new Date();if(!S.checkins[key(d)])d=addDays(d,-1);let n=0;while(S.checkins[key(d)]){n++;d=addDays(d,-1)}return n}

/* ---------- render helpers ---------- */
function prioSeg(name,val){return'<div class="seg" role="group" aria-label="Priority">'+PRIO.map(([k,l])=>'<button type="button" data-act="seg" data-name="'+name+'" data-val="'+k+'" aria-pressed="'+(val===k)+'">'+l+'</button>').join("")+'</div>'}
function catSeg(name,val){return'<div class="seg" role="group" aria-label="Category">'+CATS.map(c=>'<button type="button" data-act="seg" data-name="'+name+'" data-val="'+c+'" aria-pressed="'+(val===c)+'">'+c+'</button>').join("")+'</div>'}
function pill(p){const l=(PRIO.find(x=>x[0]===p)||PRIO[2])[1];return'<span class="pill '+esc(p||"normal")+'">'+l+'</span>'}

function editor(it){
 const t=it.type;let h='<div class="edit">';
 h+='<div class="field"><label for="e-title">Title</label><input type="text" id="e-title" value="'+esc(it.title)+'"></div>';
 if(t==="tasks")h+='<div class="field"><label>Category</label>'+catSeg("e-cat",catOf(it))+'</div>';
 if(t!=="notes"&&t!=="goals")h+='<div class="field"><label>Priority</label>'+prioSeg("e-prio",it.prio||"normal")+'</div>';
 if(t==="tasks"||t==="plans"||t==="wishes")h+='<div class="field"><label for="e-due">'+(t==="tasks"?"Due":"Target date")+'</label><input type="date" id="e-due" value="'+esc(it.due||"")+'"></div>';
 if(t==="wishes")h+='<div class="frow"><div class="field"><label for="e-price">Price (KD)</label><input type="number" inputmode="decimal" id="e-price" value="'+esc(it.price??"")+'"></div><div class="field"><label for="e-link">Link</label><input type="url" id="e-link" value="'+esc(it.link||"")+'"></div></div>';
 h+='<div class="field"><label for="e-note">'+(t==="goals"?"Why it matters":"Details")+'</label><textarea id="e-note">'+esc(it.note||"")+'</textarea></div>';
 h+='<div class="actions"><button class="btn danger" data-act="del" data-id="'+it.id+'">'+(S.confirmDel===it.id?"Tap again to delete":"Delete")+'</button><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="save" data-id="'+it.id+'">Save</button></div></div>';
 return h}

function row(it,opts={}){
 const done=!!it.done,p=it.prio||"normal";let meta=[];
 if(opts.cat&&it.type==="tasks")meta.push(catOf(it));
 if(it.due&&!done)meta.push(dueLabel(it.due));
 if(it.type==="wishes"&&it.price)meta.push('<span class="mono">'+esc(it.price)+' KD</span>');
 if(it.type==="wishes"&&it.link)meta.push('<a href="'+esc(it.link)+'" target="_blank" rel="noopener">link</a>');
 if(it.note&&it.type!=="wishes")meta.push(esc(it.note.length>60?it.note.slice(0,60)+"…":it.note));
 const open=S.open===it.id;
 return'<div class="row p-'+esc(p)+(done?" done":"")+'"><div class="row-top">'+
  '<button class="check'+(done?" on":"")+'" data-act="toggle" data-id="'+it.id+'" aria-label="'+(done?"Mark not done":"Mark done")+'">'+(done?ICON_CHECK:"")+'</button>'+
  '<button class="row-main" data-act="open" data-id="'+it.id+'" aria-expanded="'+open+'"><span class="row-title">'+esc(it.title)+'</span>'+(meta.length?'<span class="row-meta">'+meta.join(" · ")+'</span>':"")+'</button>'+
  (opts.noPill?"":pill(p))+
  (it.type==="tasks"&&!done?'<button class="star'+(it.star?" on":"")+'" data-act="star" data-id="'+it.id+'" aria-pressed="'+!!it.star+'" aria-label="'+(it.star?"Remove from Next 5":"Add to Next 5")+'">'+(it.star?"★":"☆")+'</button>':"")+
  '</div>'+(open?editor(it):"")+'</div>'}

/* ---------- views ---------- */
function vToday(){
 const k=today(),ci=S.checkins[k],hr=new Date().getHours();
 const greet=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
 let h='<header class="head"><div><div class="eyebrow">'+new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})+'</div><h1>'+greet+', Meshari</h1></div><div class="streak">Streak <b>'+streak()+'</b> '+(streak()===1?"day":"days")+'</div></header>';
 if(!ci){
  const picked=new Set(S.draft.map(d=>d.itemId).filter(Boolean));
  const sugg=[...of("tasks"),...of("plans")].filter(x=>!x.done&&(x.prio==="asap"||x.prio==="high"||(x.due&&daysTo(x.due)<=2))).sort(byPrio).slice(0,10);
  h+='<section class="card commit" aria-labelledby="ci-h"><div><div class="eyebrow">Morning check-in</div><h2 id="ci-h">Pick 3 things that make today a win</h2></div>';
  h+='<div class="slots">'+[0,1,2].map(i=>{const d=S.draft[i];return d?'<div class="slot"><span class="n">'+(i+1)+'</span><span class="t">'+esc(d.t)+'</span><button class="x" data-act="undraft" data-i="'+i+'" aria-label="Remove">×</button></div>':'<div class="slot empty-slot"><span class="n">'+(i+1)+'</span><span class="t">Empty</span></div>'}).join("")+'</div>';
  if(S.draft.length<3){
   if(sugg.length)h+='<div class="field"><label>From your lists</label><div class="chips">'+sugg.map(x=>'<button class="chip" data-act="draft" data-id="'+x.id+'"'+(picked.has(x.id)?" disabled":"")+'>'+esc(x.title)+'</button>').join("")+'</div></div>';
   h+='<div class="frow"><div class="field" style="flex:3 1 200px"><label for="ci-add">Or type one</label><input type="text" id="ci-add" placeholder="e.g. Send forms review to GM"></div><button class="btn ghost" data-act="draftText" style="flex:0 0 auto;align-self:flex-end">Add</button></div>';
  }
  h+='<div class="field"><label for="ci-int">One line: what would make today count?</label><input type="text" id="ci-int" placeholder="e.g. Finish before lunch, family time after 6"></div>';
  h+='<button class="btn brick" data-act="commit"'+(S.draft.length?"":" disabled")+'>Commit to today</button></section>';
 }else{
  const f=ci.focus||[],n=f.filter(x=>x.done).length;
  h+='<section class="card commit" aria-labelledby="cm-h"><div class="section-h"><div><div class="eyebrow">Today\'s commitment</div><h2 id="cm-h">'+(n===f.length&&f.length?"All done. Well kept.":n+" of "+f.length+" done")+'</h2></div><button class="btn ghost" data-act="recommit" style="padding:6px 10px;font-size:13px">Change</button></div>';
  h+='<div class="progress" aria-hidden="true"><i style="width:'+(f.length?n/f.length*100:0)+'%"></i></div>';
  if(ci.intention)h+='<p class="intent" style="margin:0">'+esc(ci.intention)+'</p>';
  h+='<div class="slots">'+f.map((x,i)=>'<div class="slot'+(x.done?" done":"")+'"><button class="check'+(x.done?" on":"")+'" data-act="focusToggle" data-i="'+i+'" aria-label="Toggle">'+(x.done?ICON_CHECK:"")+'</button><span class="t">'+esc(x.t)+'</span></div>').join("")+'</div>';
  h+='<div class="field"><label for="ci-ref">Evening close: what worked, what got in the way?</label><input type="text" id="ci-ref" value="'+esc(ci.reflection||"")+'"></div><div class="actions"><button class="btn ghost" data-act="reflect">Save note</button></div></section>';
 }
 // week
 const w=[];for(let i=6;i>=0;i--){const d=addDays(new Date(),-i),kk=key(d),c=S.checkins[kk];const f=c?.focus||[];const full=c&&f.length&&f.every(x=>x.done);
  w.push('<div class="day"><span>'+d.toLocaleDateString("en-GB",{weekday:"narrow"})+'</span><span class="dot'+(full?" full":c?" in":"")+(i===0?" today":"")+'">'+(c?f.filter(x=>x.done).length:"")+'</span></div>')}
 h+='<section class="section"><div class="section-h"><h3>Last 7 days</h3><span class="muted" style="font-size:12.5px">filled = checked in, green = all 3 done</span></div><div class="week">'+w.join("")+'</div></section>';
 const asap=of("tasks").filter(x=>!x.done&&x.prio==="asap").sort(byPrio);
 h+='<section class="section"><div class="section-h"><h3 style="color:var(--brick)">Must do ASAP</h3><span class="mono muted">'+asap.length+'</span></div>'+(asap.length?'<div class="list">'+asap.map(x=>row(x,{cat:true,noPill:true})).join("")+'</div>':'<div class="empty">Nothing marked ASAP.</div>')+'</section>';
 const soon=dated().filter(x=>daysTo(x.due)<=7&&!(x.type==="tasks"&&x.prio==="asap"));
 if(soon.length)h+='<section class="section"><div class="section-h"><h3>Coming up this week</h3><button class="linkbtn" data-act="tab" data-tab="timeline">Full timeline →</button></div><div class="tl">'+soon.slice(0,6).map(tlRow).join("")+'</div></section>';
 const pinned=of("notes").filter(x=>x.pinned);
 if(pinned.length)h+='<section class="section"><h3>Remember</h3>'+pinned.map(x=>'<div class="card"><div class="note">'+esc(x.title)+(x.note?"\n"+esc(x.note):"")+'</div></div>').join("")+'</section>';
 return h}

// Round + button in a page header: opens that page's add box, and turns into × to close it
function addToggle(key){const on=S.adding===key;
 return'<button class="addbtn'+(on?' on':'')+'" data-act="addToggle" data-key="'+key+'" aria-label="'+(on?"Close":"Add")+'" aria-expanded="'+on+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'+(on?'<path d="M6 6l12 12M18 6L6 18"/>':'<path d="M12 5v14M5 12h14"/>')+'</svg></button>'}
function quickAdd(type){
 if(S.adding!==type)return"";
 let h='<section class="card"><div class="field"><label for="q-title">'+({tasks:"New task",goals:"New priority",plans:"New plan",wishes:"Add to wish list",notes:"New note"})[type]+'</label>';
 h+=type==="notes"?'<textarea id="q-title" placeholder="Something to remember"></textarea>':'<input type="text" id="q-title" placeholder="'+({tasks:"What needs doing?",goals:"e.g. Family stability first",plans:"e.g. Classic Porsche import",wishes:"e.g. Outdoor jacket"})[type]+'">';
 h+='</div>';
 if(type==="tasks")h+=catSeg("addCat",S.addCat);
 if(type==="tasks"||type==="plans"||type==="wishes")h+=prioSeg("addPrio",S.addPrio);
 if(type==="tasks"||type==="plans"||type==="wishes")h+='<div class="field"><label for="q-due">'+(type==="tasks"?"Due (optional)":"Target date (optional)")+'</label><input type="date" id="q-due"></div>';
 if(type==="wishes")h+='<div class="frow"><div class="field"><label for="q-price">Price (KD)</label><input type="number" inputmode="decimal" id="q-price"></div><div class="field"><label for="q-link">Link</label><input type="url" id="q-link"></div></div>';
 if(type==="goals")h+='<div class="field"><label for="q-note">Why it matters</label><input type="text" id="q-note"></div>';
 h+='<div class="actions"><button class="btn" data-act="add" data-type="'+type+'">Add</button></div></section>';
 return h}

const SRC={tasks:"To-do",plans:"Plan",wishes:"Wish",mind:"Mind"};
const SRC_TAB={tasks:"tasks",plans:"plans",wishes:"wishes",mind:"goals"};
function dated(){return S.items.filter(x=>SRC[x.type]&&!x.done&&x.due).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:byPrio(a,b))}
function tlRow(x){const n=daysTo(x.due),d=parse(x.due),late=n<0;
 const left=late?(-n)+"d late":n===0?"today":n===1?"tomorrow":"in "+n+"d";
 const lab=x.type==="mind"?DATE_LABEL[x.kind]+" · ":"";
 return'<div class="tl-row'+(late?" late":"")+'"><div class="tl-date"><b>'+d.getDate()+'</b><span>'+d.toLocaleDateString("en-GB",{month:"short"})+'</span></div>'+
  '<button class="row-main" data-act="goto" data-id="'+x.id+'"><span class="row-title">'+esc(x.title)+'</span><span class="row-meta"><span class="src s-'+x.type+'">'+SRC[x.type]+'</span>'+(x.type==="tasks"?catOf(x):"")+(x.prio&&x.type!=="mind"?" "+pill(x.prio):"")+'<span>'+lab+d.toLocaleDateString("en-GB",{weekday:"short"})+'</span></span></button>'+
  '<span class="tl-left'+(late?" late":"")+'">'+left+'</span></div>'}
function vTimeline(){
 const all=dated(),undated=S.items.filter(x=>SRC[x.type]&&!x.done&&!x.due).length;
 const groups=[["Overdue",x=>daysTo(x.due)<0],["Today",x=>daysTo(x.due)===0],["Tomorrow",x=>daysTo(x.due)===1],["Next 7 days",x=>{const n=daysTo(x.due);return n>=2&&n<=7}],["Next 30 days",x=>{const n=daysTo(x.due);return n>7&&n<=30}],["Later",x=>daysTo(x.due)>30]];
 const soon=all.filter(x=>daysTo(x.due)<=7).length;
 let h='<header class="head"><div><div class="eyebrow">Everything with a date</div><h1>Timeline</h1></div><div class="mono muted">'+soon+' in the next 7 days</div></header>';
 if(!all.length)h+='<div class="empty">Nothing dated yet. Add a due or target date to tasks, plans, wishes or On my mind items and they appear here in order.</div>';
 groups.forEach(([g,f])=>{const L=all.filter(f);if(!L.length)return;
  h+='<section class="section"><div class="section-h"><h3'+(g==="Overdue"?' style="color:var(--brick)"':"")+'>'+g+'</h3><span class="mono muted">'+L.length+'</span></div><div class="tl">'+L.map(tlRow).join("")+'</div></section>'});
 if(undated)h+='<p class="hint">'+undated+' open items have no date, so they don\'t show here. Give a date to anything that has a real deadline.</p>';
 return h}

function vTasks(){
 const t=of("tasks"),open=t.filter(x=>!x.done).sort(byPrio),ws=weekStart();
 const doneW=t.filter(x=>x.done&&(x.doneAt||0)>=ws).sort((a,b)=>b.doneAt-a.doneAt);
 let h='<header class="head"><div><div class="eyebrow">'+open.length+' open</div><h1>To-do</h1></div>'+addToggle("tasks")+'</header>'+quickAdd("tasks");
 const next=open.filter(x=>x.star).sort(byPrioAge),rest=open.filter(x=>!x.star);
 if(next.length<NEXT_LIMIT)S.nextFull=false;
 h+='<section class="section"><div class="section-h"><h3 style="color:var(--brick)">★ Next 5 to do</h3><span class="mono muted">'+next.length+'/'+NEXT_LIMIT+'</span></div>'+
  (S.nextFull?'<div class="notice" role="status">Next 5 is full — finish or unstar one first.</div>':"")+
  (next.length?'<div class="list">'+next.map(x=>row(x,{cat:true})).join("")+'</div>':'<div class="empty next-empty">Tap ☆ on any task to line up your next five.</div>')+'</section>';
 const asap=rest.filter(x=>x.prio==="asap");
 h+='<section class="section"><div class="section-h"><h3 style="color:var(--brick)">Must do ASAP</h3><span class="mono muted">'+asap.length+'</span></div>'+(asap.length?'<div class="list">'+asap.map(x=>row(x,{cat:true,noPill:true})).join("")+'</div>':'<div class="empty">Nothing marked ASAP.</div>')+'</section>';
 CATS.forEach(c=>{const l=rest.filter(x=>x.prio!=="asap"&&catOf(x)===c);
  h+='<section class="section"><div class="section-h"><h3>'+c+'</h3><span class="mono muted">'+l.length+'</span></div>'+(l.length?'<div class="list">'+l.map(x=>row(x)).join("")+'</div>':'<div class="empty">No open tasks.</div>')+'</section>'});
 h+='<section class="section"><div class="section-h"><h3 class="muted">Done this week</h3><span class="mono muted">'+doneW.length+'</span></div>'+(doneW.length?'<div class="list">'+doneW.map(x=>row(x,{cat:true,noPill:true})).join("")+'</div>':'<div class="empty">Ticked tasks land here until Saturday night.</div>')+'</section>';
 return h}

const KINDS=[["decide","Decide","A choice you're stuck on. Name the missing fact and set a deadline."],["act","Act","The path is clear. Turn the next step into a task."],["wait","Waiting","Out of your hands for now. Parked until the check-back date."]];
const NEXT_LABEL={decide:"Missing fact",act:"Next step",wait:"Waiting on"};
const DATE_LABEL={decide:"Decide by",act:"Start by",wait:"Check back on"};
function wtBar(w){w=w||1;return'<span class="wt" aria-label="Weight '+w+' of 5">'+[1,2,3,4,5].map(i=>'<i class="'+(i<=w?"on":"")+'"></i>').join("")+'</span>'}
function wtSeg(name,v){return'<div class="seg" role="group" aria-label="Weight">'+[1,2,3,4,5].map(i=>'<button type="button" data-act="seg" data-name="'+name+'" data-val="'+i+'" aria-pressed="'+(String(v)===String(i))+'">'+i+'</button>').join("")+'</div>'}
function kindSeg(name,v){return'<div class="seg" role="group" aria-label="Type">'+KINDS.map(([k,l])=>'<button type="button" data-act="seg" data-name="'+name+'" data-val="'+k+'" aria-pressed="'+(v===k)+'">'+l+'</button>').join("")+'</div>'}
const parked=x=>x.kind==="wait"&&x.due&&daysTo(x.due)>0;
function mindEditor(x){
 return'<div class="edit"><div class="field"><label for="m-title">What\'s on your mind</label><input type="text" id="m-title" value="'+esc(x.title)+'"></div>'+
 '<div class="field"><label>Type</label>'+kindSeg("m-kind",x.kind)+'</div>'+
 '<div class="field"><label>Weight: how much headspace it takes</label>'+wtSeg("m-wt",x.weight||3)+'</div>'+
 '<div class="field"><label for="m-next">'+NEXT_LABEL[x.kind||"act"]+'</label><input type="text" id="m-next" value="'+esc(x.next||"")+'"></div>'+
 '<div class="field"><label for="m-due">'+DATE_LABEL[x.kind||"act"]+'</label><input type="date" id="m-due" value="'+esc(x.due||"")+'"></div>'+
 '<div class="actions"><button class="btn danger" data-act="del" data-id="'+x.id+'">'+(S.confirmDel===x.id?"Tap again to drop it":"Drop it")+'</button><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="msave" data-id="'+x.id+'">Save</button></div></div>'}
function mindRow(x){
 const open=S.open===x.id,stale=Date.now()-(x.updatedAt||x.createdAt||Date.now())>21*864e5;
 let meta=[];if(x.due)meta.push(DATE_LABEL[x.kind]+" "+dueLabel(x.due));
 if(stale)meta.push('<span class="flag">Stuck 3+ weeks: decide, delegate or drop</span>');
 let h='<div class="row k-'+esc(x.kind)+'"><div class="row-top"><button class="row-main" data-act="open" data-id="'+x.id+'" aria-expanded="'+open+'"><span class="row-title">'+esc(x.title)+'</span>'+
  (x.next?'<span class="nextline"><em>'+NEXT_LABEL[x.kind]+'</em>'+esc(x.next)+'</span>':'<span class="row-meta"><span class="flag">No '+NEXT_LABEL[x.kind].toLowerCase()+' yet</span></span>')+
  (meta.length?'<span class="row-meta">'+meta.join(" · ")+'</span>':"")+'</button>'+wtBar(x.weight)+'</div>';
 if(!open){const btns=[];
  if(x.kind==="act"&&x.next)btns.push('<button class="linkbtn" data-act="mtask" data-id="'+x.id+'">Make it a task →</button>');
  btns.push('<button class="linkbtn" data-act="mresolve" data-id="'+x.id+'" style="color:var(--ok)">'+(x.kind==="decide"?"Decided":"Resolved")+'</button>');
  h+='<div style="display:flex;gap:16px;justify-content:flex-end;padding:0 12px 8px">'+btns.join("")+'</div>'}
 return h+(open?mindEditor(x):"")+'</div>'}
function vGoals(){
 const all=of("mind"),active=all.filter(x=>!x.done),ws=weekStart();
 const visible=active.filter(x=>!parked(x)),hidden=active.filter(parked);
 const load=visible.reduce((s,x)=>s+(x.weight||1),0);
 const closed=all.filter(x=>x.done&&(x.doneAt||0)>=ws);
 let h='<header class="head"><div><div class="eyebrow">Open loops</div><h1>On my mind</h1></div><div class="head-r"><div class="load"><span class="eyebrow">Mental load</span><span class="big">'+load+'</span><span class="mono muted">/ '+(visible.length*5||35)+'</span></div>'+addToggle("mind")+'</div></header>';
 if(visible.length>7)h+='<div class="notice">'+visible.length+' active loops. Keep it to 7: move clear actions to To-do and bigger projects to Plans.</div>';
 if(S.adding==="mind")h+='<section class="card"><div class="field"><label for="m-new">Brain dump</label><input type="text" id="m-new" placeholder="What keeps coming back to you?"></div>'+kindSeg("addKind",S.addKind)+'<div class="field"><label>Weight</label>'+wtSeg("addWt",S.addWt)+'</div><div class="actions"><button class="btn" data-act="madd">Add</button></div></section>';
 KINDS.forEach(([k,l,desc])=>{const L=visible.filter(x=>x.kind===k).sort((a,b)=>(b.weight||0)-(a.weight||0)||((a.due||"9")<(b.due||"9")?-1:(a.due||"9")>(b.due||"9")?1:0));
  h+='<section class="section"><div class="kind-h"><div><h3>'+l+'</h3><p>'+desc+'</p></div><span class="mono muted">'+L.length+'</span></div>'+(L.length?'<div class="list">'+L.map(mindRow).join("")+'</div>':'<div class="empty">Nothing here.</div>')+'</section>'});
 if(hidden.length){h+='<section class="section"><button class="linkbtn" data-act="mparked">'+(S.showParked?"Hide":"Show")+' '+hidden.length+' parked until their check-back date</button>'+(S.showParked?'<div class="list">'+hidden.sort((a,b)=>a.due<b.due?-1:1).map(mindRow).join("")+'</div>':"")+'</section>'}
 h+='<section class="section"><div class="section-h"><h3 class="muted">Closed this week</h3><span class="mono muted">'+closed.length+'</span></div>'+(closed.length?'<div class="list">'+closed.map(x=>'<div class="row done"><div class="row-top"><span class="row-main"><span class="row-title">'+esc(x.title)+'</span><span class="row-meta">'+esc(x.closedAs||"Resolved")+'</span></span><button class="linkbtn" data-act="mreopen" data-id="'+x.id+'">Reopen</button></div></div>').join("")+'</div>':'<div class="empty">Loops you close land here. Each one is headspace back.</div>')+'</section>';
 h+='<p class="hint">Weekly review: re-score each weight and check anything flagged as stuck.</p>';
 return h}

function vPlans(){
 const p=of("plans"),open=p.filter(x=>!x.done).sort((a,b)=>(a.due||"9")<(b.due||"9")?-1:1),done=p.filter(x=>x.done);
 let h='<header class="head"><div><div class="eyebrow">'+open.length+' active</div><h1>Plans</h1></div>'+addToggle("plans")+'</header>'+quickAdd("plans");
 h+=open.length?'<div class="list">'+open.map(x=>row(x)).join("")+'</div>':'<div class="empty">Bigger things with a target date: a trip, a purchase, a project.</div>';
 if(done.length)h+='<section class="section"><h3 class="muted">Completed</h3><div class="list">'+done.map(x=>row(x,{noPill:true})).join("")+'</div></section>';
 return h}

function vWishes(){
 const w=of("wishes"),open=w.filter(x=>!x.done).sort(byPrio),got=w.filter(x=>x.done);
 const total=open.reduce((s,x)=>s+(parseFloat(x.price)||0),0);
 let h='<header class="head"><div><div class="eyebrow">'+open.length+' items</div><h1>Wish list</h1></div><div class="head-r">'+(total?'<div class="total">'+total.toLocaleString("en-GB",{maximumFractionDigits:3})+' KD priced</div>':"")+addToggle("wishes")+'</div></header>'+quickAdd("wishes");
 h+=open.length?'<div class="list">'+open.map(x=>row(x)).join("")+'</div>':'<div class="empty">Nothing on the list yet.</div>';
 if(got.length)h+='<section class="section"><h3 class="muted">Got it</h3><div class="list">'+got.map(x=>row(x,{noPill:true})).join("")+'</div></section>';
 return h}

function vNotes(){
 const n=of("notes").sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||(b.createdAt||0)-(a.createdAt||0));
 let h='<header class="head"><div><div class="eyebrow">Pinned notes show on Today</div><h1>Notes</h1></div>'+addToggle("notes")+'</header>'+quickAdd("notes");
 h+=n.length?'<div class="list">'+n.map(x=>{const open=S.open===x.id;return'<div class="row p-'+(x.pinned?"asap":"low")+'"><div class="row-top"><button class="row-main" data-act="open" data-id="'+x.id+'"><span class="row-title note">'+esc(x.title)+'</span>'+(x.note?'<span class="row-meta note">'+esc(x.note)+'</span>':"")+'<span class="row-meta">'+new Date(x.createdAt||Date.now()).toLocaleDateString("en-GB",{day:"numeric",month:"short"})+'</span></button><button class="btn ghost" style="padding:5px 10px;font-size:12.5px;flex:none" data-act="pin" data-id="'+x.id+'">'+(x.pinned?"Unpin":"Pin")+'</button></div>'+(open?editor(x):"")+'</div>'}).join("")+'</div>':'<div class="empty">Thoughts, reminders, things you don\'t want to lose.</div>';
 return h}

/* ---------- portfolio ---------- */
// [id, name, currency, decimals, colour in the allocation bar]
const ACCTS=[["us","USA portfolio","USD",2,1],["etf","ETFs","USD",2,5],["kw","Kuwait portfolio","KWD",3,2]];
const FUNDS=[["gatehouse","Gatehouse Fund",3],["arabi","Arabi Holding",4]];
const ccyOf=a=>(ACCTS.find(x=>x[0]===a)||[])[2]||"USD";
const num=v=>{const n=parseFloat(String(v??"").replace(/,/g,""));return isFinite(n)?n:null};
const nf=(n,dp)=>n==null?"—":n.toLocaleString("en-US",{minimumFractionDigits:dp,maximumFractionDigits:dp});
const pct=n=>n==null||!isFinite(n)?"—":(n>=0?"+":"")+(n*100).toFixed(1)+"%";
const gain=(pl,cost,dp)=>pl==null?"—":(pl>=0?"+":"")+nf(pl,dp)+'<small>'+pct(cost?pl/cost:null)+'</small>';
const cls=n=>n==null||!isFinite(n)||Math.abs(n)<1e-9?"":n>0?"up":"down";
const fxRate=()=>num(S.pf.fx&&S.pf.fx.usdkwd)||0.307;
const toKWD=(v,ccy)=>v==null?null:ccy==="USD"?v*fxRate():v;
// Last price: the live quote when it is newer than the one saved on the holding.
function lastPx(h){const q=S.live[yahooSymbol(h)];return q&&q.at>=(h.priceAt||0)?{px:q.price,at:q.at}:{px:num(h.price),at:h.priceAt}}
function acctStats(a){
 const rows=S.holdings.filter(h=>h.acct===a).map(h=>{const sh=num(h.shares)||0,avg=num(h.avg)||0,{px,at}=lastPx(h);
  const cost=sh*avg,value=px==null?cost:sh*px;return{...h,sh,avg,px,pxAt:at,cost,value,pl:px==null?null:value-cost}}).sort((x,y)=>y.value-x.value);
 const cost=rows.reduce((s,r)=>s+r.cost,0),value=rows.reduce((s,r)=>s+r.value,0),shares=rows.reduce((s,r)=>s+r.sh,0);
 return{rows,cost,value,shares,unpriced:rows.filter(r=>r.px==null).length}}
function fundStats(id){const f=S.pf[id]||{};const inv=num(f.invested),val=num(f.value);return{f,inv,val,ccy:f.ccy||"KWD",pl:inv!=null&&val!=null?val-inv:null}}

function totals(){
 const parts=[];
 ACCTS.forEach(([a,n,c,,col])=>{const s=acctStats(a);parts.push({n,c,col,cost:toKWD(s.cost,c),value:toKWD(s.value,c),has:s.rows.length>0})});
 FUNDS.forEach(([id,n,col])=>{const s=fundStats(id);parts.push({n,c:s.ccy,col,cost:toKWD(s.inv,s.ccy),value:toKWD(s.val??s.inv,s.ccy),has:s.inv!=null||s.val!=null})});
 const tv=parts.reduce((s,p)=>s+(p.value||0),0),tc=parts.reduce((s,p)=>s+(p.cost||0),0);
 return{parts,tv,tc}}
// one point per day: the total after your latest update that day
async function snapshot(){
 await new Promise(r=>setTimeout(r,400)); // let the saved change arrive
 const {tv,tc}=totals(),k=today(),old=S.snaps[k];
 if(!(tv>0))return;
 const v=+tv.toFixed(3);if(old&&old.total===v)return;
 await put("snaps",k,{date:k,total:v,cost:+tc.toFixed(3),at:Date.now()})}
let CH=null;
function niceTicks(lo,hi,n){if(hi===lo){const p=Math.max(Math.abs(hi)*.02,1);lo-=p;hi+=p}
 const raw=(hi-lo)/n,mag=Math.pow(10,Math.floor(Math.log10(raw))),st=[1,2,2.5,5,10].map(m=>m*mag).find(x=>x>=raw);
 const a=Math.floor(lo/st)*st,b=Math.ceil(hi/st)*st,t=[];for(let v=a;v<=b+st/2;v+=st)t.push(+v.toFixed(6));return t}
function trendChart(){
 const days=[];for(let i=29;i>=0;i--)days.push(key(addDays(new Date(),-i)));
 const keys=Object.keys(S.snaps).sort();
 let carry=null;const before=keys.filter(k=>k<days[0]);if(before.length)carry=S.snaps[before[before.length-1]].total;
 const pts=days.map(d=>{const s=S.snaps[d];if(s){carry=s.total;return{d,v:s.total,rec:true}}return{d,v:carry,rec:false}});
 const have=pts.filter(p=>p.v!=null),recs=pts.filter(p=>p.rec).length;
 let h='<section class="card"><div class="acct-h"><div><div class="eyebrow">Total value, last 30 days, KWD</div><h2>30-day trend</h2></div>';
 if(have.length>=2){const a=have[0].v,b=have[have.length-1].v,ch=b-a;h+='<div class="mono '+cls(ch)+'">'+(ch>=0?"+":"")+nf(ch,3)+' · '+pct(a?ch/a:null)+'</div>'}
 h+='</div>';
 if(have.length<2||recs<1){h+='<div class="empty">The chart builds itself. Each day you update a price, holding or fund value, today\'s total is recorded. Two days of updates draw the first line.</div></section>';CH=null;return h}
 const W=600,H=210,L=64,R=14,T=12,B=26,iw=W-L-R,ih=H-T-B;
 const vals=have.map(p=>p.v),ticks=niceTicks(Math.min(...vals),Math.max(...vals),4),y0=ticks[0],y1=ticks[ticks.length-1];
 const X=i=>L+i*iw/29,Y=v=>T+ih-(v-y0)/(y1-y0)*ih;
 const idx=pts.map((p,i)=>p.v==null?null:i).filter(i=>i!=null);
 const line=idx.map((i,j)=>(j?"L":"M")+X(i).toFixed(1)+" "+Y(pts[i].v).toFixed(1)).join(" ");
 const area=line+" L"+X(idx[idx.length-1]).toFixed(1)+" "+(T+ih)+" L"+X(idx[0]).toFixed(1)+" "+(T+ih)+"Z";
 let g=ticks.map(t=>'<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(t)+'" y2="'+Y(t)+'"/><text class="ax" x="'+(L-8)+'" y="'+(Y(t)+4)+'" text-anchor="end">'+nf(t,t%1?1:0)+'</text>').join("");
 g+=[0,7,14,21,29].map(i=>'<text class="ax" x="'+X(i)+'" y="'+(H-6)+'" text-anchor="'+(i===0?"start":i===29?"end":"middle")+'">'+fmt(pts[i].d)+'</text>').join("");
 const dots=pts.map((p,i)=>p.rec&&i!==idx[idx.length-1]?'<circle class="pt" cx="'+X(i)+'" cy="'+Y(p.v)+'" r="4"/>':"").join("");
 const li=idx[idx.length-1];
 h+='<div class="chart" id="trend"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Total portfolio value over the last 30 days">'+g+'<path class="ar" d="'+area+'"/><path class="ln" d="'+line+'"/>'+dots+'<circle class="end" cx="'+X(li)+'" cy="'+Y(pts[li].v)+'" r="5"/><line class="xh" id="xh" y1="'+T+'" y2="'+(T+ih)+'" x1="-10" x2="-10"/><rect x="'+L+'" y="0" width="'+iw+'" height="'+H+'" fill="transparent" id="hit"/></svg><div class="tip" id="tip" hidden></div></div>';
 h+='<p class="hint">Dots are days you updated values; between them the last total carries forward.</p></section>';
 CH={pts,X,Y,W,L,iw};return h}
function bindChart(){
 const wrap=document.getElementById("trend");if(!wrap||!CH)return;
 const svg=wrap.querySelector("svg"),tip=document.getElementById("tip"),xh=document.getElementById("xh");
 const move=e=>{const r=svg.getBoundingClientRect(),sx=(e.clientX-r.left)/r.width*CH.W;
  let i=Math.round((sx-CH.L)/CH.iw*29);i=Math.max(0,Math.min(29,i));const p=CH.pts[i];
  if(p.v==null){tip.hidden=true;xh.setAttribute("x1",-10);xh.setAttribute("x2",-10);return}
  const x=CH.X(i);xh.setAttribute("x1",x);xh.setAttribute("x2",x);
  tip.innerHTML=esc(fmt(p.d))+(p.rec?"":" · carried")+'<b>'+nf(p.v,3)+' KWD</b>';tip.hidden=false;
  const px=x/CH.W*r.width;tip.style.left=Math.max(60,Math.min(r.width-60,px))+"px"};
 const out=()=>{tip.hidden=true;xh.setAttribute("x1",-10);xh.setAttribute("x2",-10)};
 svg.addEventListener("pointermove",move);svg.addEventListener("pointerdown",move);svg.addEventListener("pointerleave",out)}

function holdingForm(a,h){
 const p=h?"he-":"h-";
 return'<div class="frow">'+(h?"":'<div class="field"><label for="h-ticker">Ticker</label><input type="text" id="h-ticker" autocapitalize="characters" placeholder="'+(a==="kw"?"e.g. NBK":a==="etf"?"e.g. SPUS":"e.g. MSFT")+'"></div>')+
  '<div class="field"><label for="'+p+'name">Company (optional)</label><input type="text" id="'+p+'name" value="'+esc(h?h.name:"")+'"></div></div>'+
  '<div class="frow"><div class="field"><label for="'+p+'shares">'+(h?"Shares held":"Shares bought")+'</label><input type="number" inputmode="decimal" id="'+p+'shares" value="'+esc(h?h.shares:"")+'"></div>'+
  '<div class="field"><label for="'+p+'avg">'+(h?"Average cost":"Price paid")+' ('+ccyOf(a)+')</label><input type="number" inputmode="decimal" id="'+p+'avg" value="'+esc(h?h.avg:"")+'"></div>'+
  '<div class="field"><label for="'+p+'price">'+(sb?"Last price (updates automatically)":"Last price (optional)")+'</label><input type="number" inputmode="decimal" id="'+p+'price" value="'+esc(h?lastPx(h).px??"":"")+'"></div></div>'+
  (h&&ccyOf(a)==="USD"?'<div class="field"><label for="he-acct">Category</label><select id="he-acct">'+ACCTS.filter(x=>x[2]==="USD").map(([id,n])=>'<option value="'+id+'"'+(id===a?" selected":"")+'>'+esc(n)+'</option>').join("")+'</select></div>':"")+
  (a==="kw"?'<p class="hint">Enter prices in KWD: 845 fils is 0.845.</p>':"")}

/* ---------- automatic prices ---------- */
// The Supabase Edge Function "quotes" fetches prices from Yahoo Finance.
// Live: every 30 seconds while the Portfolio tab is open and on screen, plus when the app opens and from the Refresh button.
// Live quotes are kept in memory (S.live); they are saved to the holdings every 10 minutes,
// so other devices, offline use and the daily chart get them without a database write every 30 seconds.
const LIVE_MS=30e3,SAVE_MS=10*60e3;
const yahooSymbol=h=>String(h.ticker||"").toUpperCase()+(h.acct==="kw"?".KW":"");
let pxBusy=false,pxSavedAt=0;
async function refreshPrices(force){
 if(!sb||!navigator.onLine||pxBusy||!S.holdings.length)return;
 if(!force&&Date.now()-(S.pxAt||0)<LIVE_MS-2000)return;
 pxBusy=true;
 if(force||!S.pxAt){S.pxState="loading";if(S.tab==="portfolio")render()}
 try{
  const {data,error}=await sb.functions.invoke("quotes",{body:{symbols:[...new Set(S.holdings.map(yahooSymbol))]}});
  if(error)throw error;
  for(const [sym,q] of Object.entries(data||{}))
   S.live[sym]={price:+(q.currency==="KWF"?q.price/1000:q.price).toFixed(4),at:q.time?q.time*1000:Date.now()}; // Kuwait prices come in fils
  S.pxAt=Date.now();S.pxState="ok";S.pxMissing=S.holdings.filter(h=>!(data&&data[yahooSymbol(h)])).map(h=>h.ticker);
  const docs=[];
  if(force||Date.now()-pxSavedAt>=SAVE_MS){pxSavedAt=Date.now();
   S.holdings.forEach(h=>{const q=S.live[yahooSymbol(h)];if(!q||(num(h.price)===q.price&&h.priceAt===q.at))return;
    const v={...h,price:q.price,priceAt:q.at};delete v.id;docs.push({coll:"holdings",id:h.id,data:v})})}
  if(docs.length){putMany(docs);snapshot()}else liveRender();
 }catch(e){console.warn("Price update failed:",e);S.pxState="error";liveRender()}
 finally{pxBusy=false}
}
// Redraw for a price tick, unless you're typing in a field.
function liveRender(){const el=document.activeElement;if(S.tab==="portfolio"&&!(el&&/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))render()}
setInterval(()=>{if(S.tab==="portfolio"&&document.visibilityState==="visible")refreshPrices()},LIVE_MS);
document.addEventListener("visibilitychange",()=>{if(S.tab==="portfolio"&&document.visibilityState==="visible")refreshPrices()});
function priceStatus(){
 if(!sb)return'<p class="hint">Demo mode: prices are entered by hand.</p>';
 const t=S.pxAt?new Date(S.pxAt).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"";
 const msg=S.pxState==="loading"?"Updating prices…":S.pxState==="error"?"Couldn't update prices just now. Trying again shortly.":t?"Live prices, updated "+t+". Refreshes every 30 seconds (Yahoo Finance).":"Prices update automatically.";
 let h='<div class="frow" style="align-items:center"><p class="hint" style="flex:1 1 200px">'+msg+'</p><button class="btn ghost" data-act="px" style="flex:0 0 auto;padding:6px 12px;font-size:13px"'+(S.pxState==="loading"?" disabled":"")+'>Refresh prices</button></div>';
 if(S.pxMissing&&S.pxMissing.length)h+='<p class="hint stale">No automatic price found for '+esc(S.pxMissing.join(", "))+'. Check the ticker, or tap it to enter a price by hand.</p>';
 return h}

// Sortable columns: Ticker (A–Z), Total value and Total gain (amount). Holdings without a price sort last by gain.
function sortTh(k,label){const o=S.pfSort,on=o.key===k,arrow=on?(o.dir==="asc"?"▲":"▼"):"";
 return'<th'+(on?' aria-sort="'+(o.dir==="asc"?"ascending":"descending")+'"':"")+'><button class="th-sort'+(on?" on":"")+'" data-act="pfsort" data-key="'+k+'">'+label+'<span aria-hidden="true">'+arrow+'</span></button></th>'}
function sortRows(rows){const {key,dir}=S.pfSort,m=dir==="asc"?1:-1;
 return[...rows].sort((x,y)=>{
  if(key==="ticker")return m*String(x.ticker).localeCompare(String(y.ticker));
  if(key==="gain"){if(x.pl==null||y.pl==null)return(x.pl==null)-(y.pl==null);return m*(x.pl-y.pl)}
  return m*(x.value-y.value)})}
function vPortfolio(){
 const fx=fxRate();
 const {parts,tv,tc}=totals(),pl=tv-tc;
 let h='<header class="head"><div><div class="eyebrow">Total value, KWD</div><div class="big">'+nf(tv,3)+'</div></div><div class="'+cls(pl)+' mono" style="font-size:15px">'+(pl>=0?"+":"")+nf(pl,3)+' · '+pct(tc?pl/tc:null)+'</div></header>';
 if(tv>0){h+='<section class="section"><div class="alloc" role="img" aria-label="Allocation by account">'+parts.map(p=>p.value?'<i class="c'+p.col+'" style="width:'+(p.value/tv*100)+'%"></i>':"").join("")+'</div><div class="legend">'+parts.map(p=>'<span><b class="c'+p.col+'"></b>'+esc(p.n)+'<span class="mono">'+(p.value?(p.value/tv*100).toFixed(1)+"%":"—")+'</span></span>').join("")+'</div></section>'}
 h+=priceStatus();
 h+=trendChart();
 h+='<div class="frow" style="align-items:flex-end"><div class="field"><label for="fx-rate">USD to KWD rate (1 USD =)</label><input type="number" inputmode="decimal" id="fx-rate" value="'+esc(S.pf.fx&&S.pf.fx.usdkwd||"")+'" placeholder="'+fx+'"></div><button class="btn ghost" data-act="fx" style="flex:0 0 auto">Save rate</button></div>';
 if(!S.pf.fx)h+='<p class="hint">Using 0.307 until you save today\'s rate.</p>';

 ACCTS.forEach(([a,n,c,dp])=>{const s=acctStats(a);
  h+='<section class="card"><div class="acct-h"><div><div class="eyebrow">'+c+' · '+s.rows.length+' positions</div><h2>'+n+'</h2></div><div class="mono">'+nf(s.value,dp)+' '+c+'</div></div>';
  if(s.rows.length){
   h+='<div class="tbl-wrap"><table class="tbl tbl-pf"><thead><tr>'+sortTh("ticker","Ticker")+sortTh("value","Total value")+'<th>Last price</th>'+sortTh("gain","Total gain")+'</tr></thead><tbody>';
   sortRows(s.rows).forEach(r=>{const stale=r.pxAt&&(Date.now()-r.pxAt)>7*864e5;
    h+='<tr><td><button class="tk" data-act="hopen" data-id="'+r.id+'">'+esc(r.ticker)+'</button></td><td>'+nf(r.value,dp)+'</td><td class="'+(stale?"stale":"")+'">'+(r.px==null?'<span class="muted">add</span>':nf(r.px,dp))+'</td><td class="'+cls(r.pl)+'">'+gain(r.pl,r.cost,dp)+'</td></tr>';
    if(S.hopen===r.id)h+='<tr><td class="formcell" colspan="4"><div style="display:flex;flex-direction:column;gap:10px;padding-block:4px">'+
     (r.name?'<div class="muted" style="font-size:13px">'+esc(r.name)+'</div>':"")+
     '<dl class="hstats"><div><dt>Shares</dt><dd>'+nf(r.sh,r.sh%1?2:0)+'</dd></div><div><dt>Average cost</dt><dd>'+nf(r.avg,dp)+'</dd></div><div><dt>Total cost</dt><dd>'+nf(r.cost,dp)+'</dd></div><div><dt>Weight</dt><dd>'+(s.value?(r.value/s.value*100).toFixed(1)+"%":"—")+'</dd></div></dl>'+
     holdingForm(a,r)+'<div class="actions"><button class="btn danger" data-act="hdel" data-id="'+r.id+'">'+(S.confirmDel===r.id?"Tap again to remove":"Remove")+'</button><button class="btn ghost" data-act="hclose">Cancel</button><button class="btn" data-act="hsave" data-id="'+r.id+'">Save</button></div></div></td></tr>'});
   const spl=s.value-s.cost;
   h+='</tbody><tfoot><tr><td>Total</td><td>'+nf(s.value,dp)+'</td><td></td><td class="'+cls(spl)+'">'+gain(spl,s.cost,dp)+'</td></tr></tfoot></table></div>';
   if(s.unpriced)h+='<p class="hint">'+s.unpriced+' without a last price are valued at cost. Tap a ticker to update.</p>';
  }else h+='<div class="empty">No holdings yet. Add each ticker with shares and average cost.</div>';
  if(S.hadd===a){h+='<div style="display:flex;flex-direction:column;gap:10px">'+holdingForm(a,null)+'<p class="hint">Adding a ticker you already hold records a new buy and recalculates its average cost.</p><div class="actions"><button class="btn ghost" data-act="hcancel">Cancel</button><button class="btn" data-act="hadd" data-acct="'+a+'">Save holding</button></div></div>'}
  else h+='<div class="actions"><button class="btn ghost" data-act="hnew" data-acct="'+a+'">Add holding or buy</button></div>';
  h+='</section>'});

 FUNDS.forEach(([id,n])=>{const s=fundStats(id),f=s.f,dp=s.ccy==="USD"?2:3;
  h+='<section class="card"><div class="acct-h"><div><div class="eyebrow">'+s.ccy+(f.asOf?' · as of '+fmt(f.asOf):"")+'</div><h2>'+n+'</h2></div><button class="btn ghost" data-act="fopen" data-id="'+id+'" style="padding:6px 12px;font-size:13px">'+(S.fopen===id?"Close":"Update")+'</button></div>';
  if(S.fopen===id){
   h+='<div class="frow"><div class="field"><label for="f-inv">Amount invested</label><input type="number" inputmode="decimal" id="f-inv" value="'+esc(f.invested??"")+'"></div><div class="field"><label for="f-val">Current value</label><input type="number" inputmode="decimal" id="f-val" value="'+esc(f.value??"")+'"></div></div>'+
   '<div class="frow"><div class="field"><label for="f-units">Units or shares (optional)</label><input type="number" inputmode="decimal" id="f-units" value="'+esc(f.units??"")+'"></div><div class="field"><label for="f-asof">Value as of</label><input type="date" id="f-asof" value="'+esc(f.asOf||today())+'"></div></div>'+
   '<div class="field"><label>Currency</label><div class="seg" role="group" aria-label="Currency">'+["KWD","USD"].map(c=>'<button type="button" data-act="seg" data-name="f-ccy" data-val="'+c+'" aria-pressed="'+(s.ccy===c)+'">'+c+'</button>').join("")+'</div></div>'+
   '<div class="field"><label for="f-note">Notes</label><input type="text" id="f-note" value="'+esc(f.note||"")+'"></div><div class="actions"><button class="btn" data-act="fsave" data-id="'+id+'">Save</button></div>';
  }else if(s.inv==null&&s.val==null)h+='<div class="empty">Tap Update to enter what you invested and the latest statement value.</div>';
  else{const u=num(f.units);
   h+='<div class="fund-grid"><div class="kpi"><span class="eyebrow">Invested</span><span class="v">'+nf(s.inv,dp)+'</span></div><div class="kpi"><span class="eyebrow">Value</span><span class="v">'+nf(s.val,dp)+'</span></div><div class="kpi"><span class="eyebrow">Gain</span><span class="v '+cls(s.pl)+'">'+(s.pl==null?"—":(s.pl>=0?"+":"")+nf(s.pl,dp))+'</span></div><div class="kpi"><span class="eyebrow">Return</span><span class="v '+cls(s.pl)+'">'+pct(s.inv&&s.pl!=null?s.pl/s.inv:null)+'</span></div>'+(u?'<div class="kpi"><span class="eyebrow">Units</span><span class="v">'+nf(u,u%1?3:0)+'</span></div><div class="kpi"><span class="eyebrow">Value per unit</span><span class="v">'+nf(s.val!=null?s.val/u:null,4)+'</span></div>':"")+'</div>';
   if(f.note)h+='<p class="hint">'+esc(f.note)+'</p>';
   if(f.asOf&&daysTo(f.asOf)<-35)h+='<p class="hint stale">Value is over a month old. Update from your latest statement.</p>'}
  h+='</section>'});
 h+='<p class="hint">Returns compare current value with cost; dividends and fees are not included.</p>';
 return h}

/* ---------- import, backup, footer ---------- */
function vImport(){
 return'<header class="head"><div><div class="eyebrow">Bring data in</div><h1>Import</h1></div></header>'+
 '<section class="card"><p class="hint">Paste either a Daily Compass backup (from "Export backup") or the old task list: a JSON array of {text, area, priority, done, pinned, created}. Imported items are added to what you already have.</p>'+
 '<div class="field"><label for="imp-json">JSON</label><textarea id="imp-json" rows="8" placeholder="[ … ] or { &quot;items&quot;: [ … ] }"></textarea></div>'+
 (S.importMsg?'<div class="notice">'+esc(S.importMsg)+'</div>':"")+
 '<div class="actions"><button class="btn ghost" data-act="importClose">Cancel</button><button class="btn" data-act="importRun">Import</button></div></section>'}
const SYNC_LABEL={synced:"Synced",syncing:"Syncing…",offline:"Offline",error:"Sync error"};
function footer(){
 const st=S.mode==="local"?'<span class="sync-dot s-offline"></span>Demo':'<span class="sync-dot s-'+(S.sync||"syncing")+'"></span>'+SYNC_LABEL[S.sync||"syncing"];
 return'<footer class="foot"><span>'+st+'</span><button class="linkbtn" data-act="import">Import</button><button class="linkbtn" data-act="export">Export backup</button>'+
  (S.mode==="db"?'<button class="linkbtn" data-act="signout">Sign out</button>':"")+'</footer>'}

/* ---------- render with input preservation ---------- */
function render(){
 if(!S.started)return; // still on the sign-in screen
 const app=document.getElementById("app");
 const keep={};app.querySelectorAll("input[id],textarea[id]").forEach(el=>keep[el.id]=el.value);
 const act=document.activeElement&&document.activeElement.id;
 let h="";
 if(S.mode==="local")h+='<div class="notice">Demo mode: saving on this device only. Add your Supabase keys to sync between devices.</div>';
 if(S.sync==="offline")h+='<div class="notice">Offline. Your changes are saved on this device and will sync when you\'re back online.</div>';
 if(S.sync==="error")h+='<button class="notice notice-btn" data-act="retry">Couldn\'t sync just now. Tap to try again.</button>';
 if(S.err)h+='<div class="notice">'+esc(S.err)+'</div>';
 if(!S.loaded)h+='<p class="muted">Loading your board…</p>';
 else if(S.panel==="import")h+=vImport();
 else h+=({today:vToday,timeline:vTimeline,tasks:vTasks,goals:vGoals,plans:vPlans,wishes:vWishes,notes:vNotes,portfolio:vPortfolio})[S.tab]();
 if(S.loaded)h+=footer();
 app.innerHTML=h;
 if(!S.fresh)for(const id in keep){const el=document.getElementById(id);if(el)el.value=keep[id]}
 S.fresh=false;
 if(act){const el=document.getElementById(act);if(el)el.focus()}
 if(S.tab==="portfolio")bindChart();
 const c=of("tasks").filter(x=>!x.done&&x.prio==="asap").length,tc=dated().filter(x=>daysTo(x.due)<=0).length;
 document.getElementById("tabs").innerHTML=TABS.map(([k,l,svg])=>'<button class="tab" data-act="tab" data-tab="'+k+'"'+(S.tab===k?' aria-current="page"':"")+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+svg+'</svg>'+l+(k==="tasks"&&c?' <span class="badge">'+c+'</span>':k==="timeline"&&tc?' <span class="badge">'+tc+'</span>':"")+'</button>').join("");
}
const val=id=>{const el=document.getElementById(id);return el?el.value.trim():""};
const clear=(...ids)=>ids.forEach(id=>{const el=document.getElementById(id);if(el)el.value=""});
const segVal=name=>{const b=document.querySelector('[data-name="'+name+'"][aria-pressed="true"]');return b?b.dataset.val:null};

/* ---------- actions ---------- */
async function act(a,d){
 S.err="";
 switch(a){
 case"tab":S.fresh=true;S.tab=d.tab;S.open=null;S.adding=null;try{localStorage.setItem("dc-tab",S.tab)}catch(e){}render();window.scrollTo(0,0);if(S.tab==="portfolio")refreshPrices();break;
 case"px":refreshPrices(true);break;
 case"pfsort":{const o=S.pfSort;S.pfSort=o.key===d.key?{key:d.key,dir:o.dir==="asc"?"desc":"asc"}:{key:d.key,dir:d.key==="ticker"?"asc":"desc"};
  try{localStorage.setItem("dc-pfsort",JSON.stringify(S.pfSort))}catch(e){}render();break}
 case"seg":document.querySelectorAll('[data-name="'+d.name+'"]').forEach(b=>b.setAttribute("aria-pressed",b.dataset.val===d.val));if(d.name==="addPrio")S.addPrio=d.val;if(d.name==="addCat")S.addCat=d.val;if(d.name==="addKind")S.addKind=d.val;if(d.name==="addWt")S.addWt=Number(d.val);if(d.name==="m-kind"){const nl=document.querySelector('label[for="m-next"]'),dl=document.querySelector('label[for="m-due"]');if(nl)nl.textContent=NEXT_LABEL[d.val];if(dl)dl.textContent=DATE_LABEL[d.val]}break;
 case"open":S.fresh=true;S.open=S.open===d.id?null:d.id;S.confirmDel=null;render();break;
 case"goto":{const x=item(d.id);if(!x)return;if(S.tab!==SRC_TAB[x.type])S.adding=null;S.tab=SRC_TAB[x.type];S.fresh=true;S.open=x.id;S.confirmDel=null;try{localStorage.setItem("dc-tab",S.tab)}catch(e){}render();setTimeout(()=>{const el=document.querySelector('[data-act="open"][data-id="'+x.id+'"]');if(el)el.scrollIntoView({block:"center"})},30);break}
 case"close":S.open=null;S.confirmDel=null;render();break;
 case"toggle":{const it=item(d.id);if(it)patch(d.id,it.done?{done:false,doneAt:null}:{done:true,doneAt:Date.now(),star:false});break}
 case"star":{const it=item(d.id);if(!it)return;
  if(!it.star&&of("tasks").filter(x=>x.star&&!x.done).length>=NEXT_LIMIT){S.nextFull=true;render();clearTimeout(S.nextTimer);S.nextTimer=setTimeout(()=>{S.nextFull=false;render()},4000);return}
  S.nextFull=false;patch(d.id,{star:!it.star});break}
 case"retry":sync();break;
 case"import":S.fresh=true;S.panel="import";S.importMsg="";render();window.scrollTo(0,0);break;
 case"importClose":S.fresh=true;S.panel=null;render();break;
 case"importRun":{try{const docs=importToDocs(val("imp-json"),S,uid);
   if(!docs.length)throw new Error("Nothing to import was found in that text.");
   putMany(docs);S.fresh=true;S.panel=null;S.err="";render();
  }catch(e){S.importMsg=e.message;render()}break}
 case"export":{const blob=new Blob([backupJSON(S)],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="daily-compass-backup-"+today()+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);break}
 case"signout":{const n=outbox.length;
  if(!confirm(n?n+" change(s) haven't synced yet and will be lost. Sign out anyway?":"Sign out on this device?"))return;
  try{[CACHE_KEY,OUTBOX_KEY,"dc-last-user"].forEach(k=>localStorage.removeItem(k))}catch(e){}
  await sb.auth.signOut();location.reload();break}
 case"pin":{const it=item(d.id);if(it)patch(d.id,{pinned:!it.pinned});break}
 case"add":{const t=d.type,title=val("q-title");if(!title){document.getElementById("q-title").focus();return}
  const v={type:t,title,createdAt:Date.now(),done:false};
  if(t==="tasks"){v.cat=S.addCat;v.prio=S.addPrio;v.due=val("q-due")}
  if(t==="plans"){v.prio=S.addPrio;v.due=val("q-due")}
  if(t==="wishes"){v.prio=S.addPrio;v.price=val("q-price");v.link=val("q-link");v.due=val("q-due")}
  if(t==="goals"){v.note=val("q-note");v.rank=of("goals").reduce((m,x)=>Math.max(m,x.rank??0),0)+1}
  if(t==="notes")v.pinned=false;
  clear("q-title","q-due","q-price","q-link","q-note");S.addPrio="normal";
  await put("items",uid(),v);break}
 case"save":{const it=item(d.id);if(!it)return;const ch={title:val("e-title")||it.title,note:val("e-note")};
  if(segVal("e-prio"))ch.prio=segVal("e-prio");if(segVal("e-cat"))ch.cat=segVal("e-cat");
  if(document.getElementById("e-due"))ch.due=val("e-due");
  if(document.getElementById("e-price")){ch.price=val("e-price");ch.link=val("e-link")}
  S.open=null;patch(d.id,ch);break}
 case"del":if(S.confirmDel!==d.id){S.confirmDel=d.id;render();return}S.confirmDel=null;S.open=null;await del("items",d.id);break;
 case"move":{const g=of("goals").sort((a,b)=>(a.rank??0)-(b.rank??0));const i=g.findIndex(x=>x.id===d.id),j=i+Number(d.d);if(j<0||j>=g.length)return;
  const ra=g.map((x,k)=>k);[ra[i],ra[j]]=[ra[j],ra[i]];
  for(let k=0;k<g.length;k++){if((g[k].rank??-1)!==ra[k]){const v={...g[k],rank:ra[k]};delete v.id;await put("items",g[k].id,v)}}break}
 case"draft":{const it=item(d.id);if(it&&S.draft.length<3){S.draft.push({t:it.title,itemId:it.id});render()}break}
 case"draftText":{const t=val("ci-add");if(t&&S.draft.length<3){clear("ci-add");S.draft.push({t,itemId:null});render()}break}
 case"undraft":S.draft.splice(Number(d.i),1);render();break;
 case"commit":{if(!S.draft.length)return;const k=today();const v={date:k,focus:S.draft.map(x=>({t:x.t,itemId:x.itemId,done:false})),intention:val("ci-int"),at:Date.now()};clear("ci-int");S.draft=[];await put("checkins",k,v);break}
 case"recommit":{const c=S.checkins[today()];if(!c)return;S.draft=(c.focus||[]).map(x=>({t:x.t,itemId:x.itemId}));await del("checkins",today());setTimeout(()=>{const el=document.getElementById("ci-int");if(el&&c.intention)el.value=c.intention},50);break}
 case"focusToggle":{const k=today(),c=S.checkins[k];if(!c)return;const f=(c.focus||[]).map(x=>({...x}));const x=f[Number(d.i)];x.done=!x.done;
  await put("checkins",k,{...c,focus:f});if(x.itemId&&item(x.itemId))patch(x.itemId,x.done?{done:true,doneAt:Date.now(),star:false}:{done:false,doneAt:null});break}
 case"fx":{const r=num(val("fx-rate"));if(!r||r<=0){S.err="Enter the rate as KWD per 1 USD, for example 0.307.";render();return}await put("pf","fx",{usdkwd:r,at:Date.now()});snapshot();break}
 case"hnew":S.fresh=true;S.hadd=d.acct;S.hopen=null;render();setTimeout(()=>{const el=document.getElementById("h-ticker");if(el)el.focus()},30);break;
 case"addToggle":S.adding=S.adding===d.key?null:d.key;S.addPrio="normal";render();
  if(S.adding)setTimeout(()=>{const el=document.getElementById(S.adding==="mind"?"m-new":"q-title");if(el)el.focus()},30);break;
 case"hcancel":S.hadd=null;render();break;
 case"hopen":S.fresh=true;S.hopen=S.hopen===d.id?null:d.id;S.hadd=null;S.confirmDel=null;render();break;
 case"hclose":S.hopen=null;S.confirmDel=null;render();break;
 case"hadd":{const a=d.acct,t=val("h-ticker").toUpperCase(),sh=num(val("h-shares")),px=num(val("h-avg")),last=num(val("h-price")),nm=val("h-name");
  if(!t||!sh||sh<=0||px==null||px<0){S.err="Enter a ticker, the number of shares and the price paid.";render();return}
  const ex=S.holdings.find(x=>x.acct===a&&String(x.ticker).toUpperCase()===t);
  clear("h-ticker","h-shares","h-avg","h-price","h-name");S.hadd=null;
  if(ex){const s0=num(ex.shares)||0,a0=num(ex.avg)||0,ns=s0+sh,na=(s0*a0+sh*px)/ns;const v={...ex,shares:+ns.toFixed(6),avg:+na.toFixed(6)};delete v.id;if(nm)v.name=nm;if(last!=null){v.price=last;v.priceAt=Date.now()}await put("holdings",ex.id,v)}
  else{const v={acct:a,ticker:t,name:nm,shares:sh,avg:px,createdAt:Date.now()};if(last!=null){v.price=last;v.priceAt=Date.now()}await put("holdings",uid(),v)}
  snapshot();break}
 case"hsave":{const h=S.holdings.find(x=>x.id===d.id);if(!h)return;const sh=num(val("he-shares")),av=num(val("he-avg")),last=num(val("he-price"));
  if(sh==null||av==null){S.err="Shares and average cost need numbers.";render();return}
  const v={...h,shares:sh,avg:av,name:val("he-name")};delete v.id;
  const mv=val("he-acct");if(mv&&ccyOf(mv)===ccyOf(h.acct))v.acct=mv; // move between USD categories
  if(last==null){delete v.price;delete v.priceAt}else if(last!==num(h.price)){v.price=last;v.priceAt=Date.now()}
  S.hopen=null;await put("holdings",d.id,v);snapshot();break}
 case"hdel":if(S.confirmDel!==d.id){S.confirmDel=d.id;render();return}S.confirmDel=null;S.hopen=null;await del("holdings",d.id);snapshot();break;
 case"fopen":S.fresh=true;S.fopen=S.fopen===d.id?null:d.id;render();break;
 case"fsave":{const v={invested:num(val("f-inv")),value:num(val("f-val")),units:num(val("f-units")),asOf:val("f-asof"),ccy:segVal("f-ccy")||"KWD",note:val("f-note"),at:Date.now()};
  S.fopen=null;await put("pf",d.id,v);snapshot();break}
 case"madd":{const t=val("m-new");if(!t){document.getElementById("m-new").focus();return}clear("m-new");
  await put("items",uid(),{type:"mind",title:t,kind:S.addKind,weight:S.addWt,next:"",due:"",done:false,createdAt:Date.now(),updatedAt:Date.now()});break}
 case"msave":{const x=item(d.id);if(!x)return;S.open=null;patch(d.id,{title:val("m-title")||x.title,kind:segVal("m-kind")||x.kind,weight:Number(segVal("m-wt")||x.weight||3),next:val("m-next"),due:val("m-due"),updatedAt:Date.now()});break}
 case"mresolve":{const x=item(d.id);if(x)patch(d.id,{done:true,doneAt:Date.now(),closedAs:x.kind==="decide"?"Decided":"Resolved"});break}
 case"mreopen":patch(d.id,{done:false,doneAt:null,updatedAt:Date.now()});break;
 case"mtask":{const x=item(d.id);if(!x||!x.next)return;await put("items",uid(),{type:"tasks",title:x.next,note:"From: "+x.title,cat:"Personal",prio:(x.weight||0)>=4?"high":"normal",due:x.due||"",done:false,createdAt:Date.now()});
  patch(d.id,{done:true,doneAt:Date.now(),closedAs:"Moved to To-do"});break}
 case"mparked":S.showParked=!S.showParked;render();break;
 case"reflect":{const k=today(),c=S.checkins[k];if(c)await put("checkins",k,{...c,reflection:val("ci-ref")});break}
 }
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b||b.disabled)return;e.preventDefault();act(b.dataset.act,b.dataset)});
document.addEventListener("keydown",e=>{if(e.key!=="Enter"||e.shiftKey)return;const id=e.target.id;
 if(id==="q-title"&&e.target.tagName==="INPUT"){e.preventDefault();act("add",{type:S.tab})}
 else if(id==="ci-add"){e.preventDefault();act("draftText",{})}
 else if(id==="m-new"){e.preventDefault();act("madd",{})}});
// roll over at midnight if the page stays open
let day=today();setInterval(()=>{if(today()!==day){day=today();S.draft=[];render()}},60000);
export function startApp(opts){sb=opts.supabase;userId=opts.userId;S.started=true;document.body.classList.add("signed-in");render();init()}
