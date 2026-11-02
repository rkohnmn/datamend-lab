import './handoff-protocol.js';
const protocol=globalThis.DataSenseHandoff;

/** Bind the transfer to explicit module APIs, never to a guessed global state. */
export async function initCompassTransfer({prepareImport, exportDataset}) {
  const id=new URLSearchParams(location.search).get('compass_handoff');
  if(!id) return;
  const banner=document.createElement('section');
  banner.id='compass-transfer';banner.className='module';banner.setAttribute('aria-label','Compass dataset transfer');
  banner.style.cssText='margin:1rem;padding:1rem;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap';
  const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='flex:1;min-width:0;overflow-wrap:anywhere';
  banner.append(status);document.body.prepend(banner);
  status.textContent='Reading Compass transfer…';
  try {
    const record=await protocol.read(id);
    protocol.validateEnvelope(record,id,record?.state==='ACCEPTED'?'ACCEPTED':'READY_FOR_TARGET');
    const load=document.createElement('button');load.className='btn btn-primary';load.type='button';load.textContent='Load transferred dataset';
    const back=document.createElement('button');back.className='btn';back.type='button';back.textContent='Return cleaned dataset to Compass';back.disabled=true;
    banner.append(load,back);
    status.textContent=`Compass transfer: ${record.dataset.name || 'Dataset'} · ${record.dataset.rows.length} rows. Load it to begin cleaning. Existing workspace datasets remain available.`;
    let importedId;
    load.addEventListener('click',async()=>{
      load.disabled=true;
      try {
        protocol.validateEnvelope(record,id,record.state);
        const prepared=prepareImport(record.dataset);
        await protocol.write({...record,state:'ACCEPTED'});
        importedId=prepared.commit();record.state='ACCEPTED';back.disabled=false;
        status.textContent='Transferred dataset loaded. Review and apply cleaning operations, then return it to Compass.';
      } catch(e){status.textContent=e.message;load.disabled=false;}
    });
    back.addEventListener('click',async()=>{
      back.disabled=true;
      try {
        const current=await protocol.read(id);
        protocol.validateEnvelope(current,id,'ACCEPTED');
        const {dataset,auditSummary}=exportDataset(importedId);
        protocol.validateDataset(dataset);
        await protocol.write({...current,state:'RETURN_READY',cleanedDataset:dataset,auditSummary});
        const url=protocol.safeReturnUrl(current.returnUrl);url.searchParams.set('compass_return',id);location.assign(url.href);
      } catch(e){status.textContent=e.message;back.disabled=false;}
    });
  } catch(e) {status.textContent=`${e.message} You can still import a CSV file using the Import workspace.`;}
}
