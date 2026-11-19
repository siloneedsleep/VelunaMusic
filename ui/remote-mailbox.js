function remoteMailbox({request,owner,device,status,execute,canReceive=()=>true,renderConflict}) {
  let running=null,again=false,epoch=0,retry=0;
  const cancel=()=>{if(retry)clearTimeout(retry);retry=0;};
  const key=()=>"remote-operations/"+owner();
  function pending(){try{return JSON.parse(localStorage.getItem(key()) || "[]");}catch{return [];}}
  function store(list){localStorage.setItem(key(),JSON.stringify(list));}
  function change(id,fn){store(pending().flatMap(op=>op.id===id?fn(op):[op]));}
  function enqueue(command){
    const ops=pending();
    if(ops.length>=100){status("Hoàn tất các lệnh đang chờ trước khi gửi thêm.");return;}
    ops.push({...command,deadline:Date.now()+(command.action==="move"?86400000:20000)});
    store(ops);sync();
  }
  async function pass(turn){
    const me=device();
    const valid=()=>epoch===turn && !!owner();
    const now=Date.now();
    for(const op of pending()){
      if(!valid())return;
      if(op.conflict){renderConflict(op);continue;}
      if(op.deadline<now && !op.submitted){change(op.id,()=>[]);status("Lệnh đã hết hạn.");continue;}
      if(!op.submitted){
        await request("/rest/v1/rpc/veluna_command","POST",{p_id:op.id,p_sender:me,p_recipient:op.to,
          p_instance:op.instance,p_version:op.version,p_action:op.action,p_value:op.value,p_destination:op.destination || 0,
          p_deadline:new Date(op.deadline).toISOString()});
        if(!valid())return;
        change(op.id,x=>[{...x,submitted:true}]);
      }
      const [row]=await request("/rest/v1/veluna_commands?select=result&id=eq."+op.id);
      if(!valid())return;
      if(row?.result!=null){
        if(row.result && op.action==="move"){
          change(op.id,x=>[{...x,conflict:true}]);renderConflict(op);
        }else{change(op.id,()=>[]);status(row.result || "Máy phát đã thực hiện.");}
      }else if(op.deadline<Date.now()){change(op.id,()=>[]);status("Máy phát chưa xác nhận trước khi lệnh hết hạn.");}
      else status("Đang chờ máy phát xác nhận.");
    }
    if(!execute || !canReceive() || !valid())return;
    const rows=await request("/rest/v1/veluna_commands?select=*&recipient=eq."+me+"&result=is.null&expires_at=gt.now&order=created_at,id&limit=32");
    for(const row of rows){
      if(!valid())return;
      const result=Date.parse(row.expires_at)>Date.now()?await execute({...row,from:row.sender,to:me}):"Lệnh đã hết hạn.";
      if(!valid() || result==null)return;
      await request("/rest/v1/rpc/veluna_command_ack","POST",{p_id:row.id,p_recipient:me,p_result:result});
    }
    if(rows.length===32)again=true;
  }
  function sync(){
    if(!owner())return;
    if(running){again=true;return running;}
    cancel();
    const turn=epoch;
    running=(async()=>{
      do {again=false;await pass(turn);}while(again && epoch===turn);
    })().catch(()=>{if(epoch===turn && pending().length)status("Đã lưu thao tác trên máy. Sẽ thử lại khi kết nối.");})
      .finally(()=>{
        if(epoch!==turn)return;
        running=null;
        if(typeof setTimeout==="function" && pending().some(op=>!op.conflict))retry=setTimeout(sync,10000);
      });
    return running;
  }
  return {enqueue,sync,reset(){cancel();epoch++;running=null;again=false;},discard(id){change(id,()=>[]);},pendingCount:()=>pending().length};
}
