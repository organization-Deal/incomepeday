// Shared pure classification; a real zero is distinct from unavailable revenue.
globalThis.DealRevenueGroups=(()=>{
 function windowDays(asOf){
  const value=new Date(asOf).getTime();if(!Number.isFinite(value))return [];
  const day=new Date(value+7*3600000).toISOString().slice(0,10);
  return [3,2,1].map(n=>new Date(Date.parse(day+'T00:00:00Z')-n*86400000).toISOString().slice(0,10));
 }
 function classify({month,status,daily,unavailable,asOf}){
  const dates=windowDays(asOf);if(dates.length!==3||unavailable||!['ONLINE','OFFLINE'].includes(status))return 'unknown';
  const now=new Date(new Date(asOf).getTime()+7*3600000).toISOString();
  if(month!==now.slice(5,7)+'-'+now.slice(0,4))return 'unknown';
  // The dashboard has one month's daily cells; do not reuse same day labels from another month.
  if(dates.some(d=>d.slice(5,7)+'-'+d.slice(0,4)!==month))return 'unknown';
  const cells=dates.map(d=>daily?.[d.slice(8,10)+'/'+d.slice(5,7)]);
  if(cells.some(c=>!c||c.closed!==true||typeof c.d!=='number'||!Number.isFinite(c.d)||c.d<0))return 'unknown';
  return (status==='ONLINE'?'online':'offline')+'-'+(cells.some(c=>c.d>0)?'money':'zero');
 }
 return {windowDays,classify};
})();
