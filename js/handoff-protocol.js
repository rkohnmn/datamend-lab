/* Versioned, same-origin exchange shared with DataMend; datasets never leave the browser. */
(function(root) {
  const DB='datasense_compass_handoff_v1', STORE='handoffs';
  function validateDataset(data) {
    if (!data || !Array.isArray(data.headers) || !Array.isArray(data.rows)) throw new Error('Invalid handoff dataset.');
    const {headers,rows}=data;
    if (!headers.length || headers.length>40 || !rows.length || rows.length>5000 || rows.length*headers.length>100000) throw new Error('Handoff exceeds interactive table limits or is empty.');
    if (headers.some(h=>typeof h!=='string'||!h.trim()) || new Set(headers).size!==headers.length) throw new Error('Handoff columns must be unique, non-empty names.');
    for(const row of rows) {
      if (!row || typeof row!=='object' || Array.isArray(row) || headers.some(h=>!Object.hasOwn(row,h))) throw new Error('Handoff rows must contain every named column.');
      if (Object.keys(row).some(k=>!headers.includes(k))) throw new Error('Handoff contains undeclared columns.');
      for(const h of headers) {
        const v=row[h];
        if (!(v===null || typeof v==='string' || typeof v==='boolean' || typeof v==='number'&&Number.isFinite(v))) throw new Error('Handoff cells must be finite numbers, text, booleans or null.');
      }
    }
    if (new TextEncoder().encode(JSON.stringify({headers,rows})).length>2*1024*1024) throw new Error('Handoff exceeds 2 MB. Use a smaller subset.');
    return data;
  }
  function safeReturnUrl(value, origin=root.location.origin) {
    const u=new URL(value,origin);
    if (u.origin!==origin || !['/','/compass/','/datasense-studio/','/datasense-studio/compass/'].includes(u.pathname) || !['http:','https:'].includes(u.protocol)) throw new Error('Return address must be this origin’s DataSense Studio.');
    u.search='';u.hash='compass';return u;
  }
  function validateEnvelope(record,id,state,origin=root.location.origin) {
    if (!record || record.protocol!==DB || record.schemaVersion!=='1.0.0' || record.handoffId!==id || !/^ds_handoff_[a-zA-Z0-9_-]{1,100}$/.test(id) || record.targetApp!=='datamend' || record.sourceApp!=='datasense-compass') throw new Error('Handoff is missing or incompatible. Open it again from Compass.');
    const expires=Date.parse(record.expiresAt);
    if (!Number.isFinite(expires)||expires<=Date.now()) throw new Error('This handoff has expired. Open a fresh transfer from Compass.');
    if (record.state!==state) throw new Error('This handoff has already been used or is not ready.');
    safeReturnUrl(record.returnUrl,origin);validateDataset(record.dataset);
    if(state==='RETURN_READY') validateDataset(record.cleanedDataset);
    return record;
  }
  function transaction(mode,action) {
    return new Promise((resolve,reject)=>{
      let db, settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();error?reject(error):resolve(value);};
      const timer=setTimeout(()=>finish(new Error('Browser storage is unavailable. Use CSV export and import.')),4000);
      try {
        const request=indexedDB.open(DB,1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'handoffId'});};
        request.onerror=()=>finish(new Error('Browser storage is unavailable. Use CSV export and import.'));
        request.onsuccess=()=>{
          db=request.result;if(settled){db.close();return;}
          try {
            const tx=db.transaction(STORE,mode), req=action(tx.objectStore(STORE));
            tx.oncomplete=()=>finish(null,req.result);
            tx.onerror=tx.onabort=()=>finish(new Error('Could not save the handoff. Your active data is unchanged.'));
          } catch(e){finish(e);}
        };
      } catch(e){finish(new Error('Browser storage is unavailable. Use CSV export and import.'));}
    });
  }
  const api={validateDataset,validateEnvelope,safeReturnUrl,read:id=>transaction('readonly',s=>s.get(id)),write:record=>transaction('readwrite',s=>s.put(record))};
  root.DataSenseHandoff=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
