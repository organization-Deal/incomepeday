// Validate provider event history; update_time and report timestamps are not state transitions.
export function latestCemEvents(data,now=Date.now()){
 if(!Array.isArray(data?.result)||data.result.length>100||!data.pagination||!Number.isInteger(data.pagination.total_page)||data.pagination.total_page<0)throw new Error('Invalid state history');
 let previous=Infinity,latestOnlineAt=null,latestOfflineAt=null;
 for(const row of data.result){
  if(typeof row.record_at!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(row.record_at))throw new Error('Missing history timezone');
  const at=Date.parse(row.record_at);if(!Number.isFinite(at)||at>now+60000||at>previous)throw new Error('Invalid history ordering');previous=at;
  if(row.state==='ONLINE'&&latestOnlineAt===null)latestOnlineAt=at;
  if(row.state==='OFFLINE'&&latestOfflineAt===null)latestOfflineAt=at;
 }
 return {latestOnlineAt,latestOfflineAt};
}
