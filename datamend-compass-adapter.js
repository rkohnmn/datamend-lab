/**
 * DataSense Compass × DataMend Lab — Same-Origin Browser Handoff Adapter
 * File: datamend-compass-adapter.js
 * Protocol: datasense_compass_handoff_v1
 *
 * Drop-in integration module for https://rkohnmn.github.io/datamend-lab/
 * Reads incoming handoff envelopes from IndexedDB / localStorage (`datasense_compass_handoff_v1`),
 * transitions state (`READY_FOR_TARGET` -> `ACCEPTED` -> `IN_PROGRESS` -> `RETURN_READY`),
 * and returns the cleaned dataset + audit log back to DataSense Compass (`/compass/`).
 */
(function (root) {
  'use strict';

  const DB_NAME = 'datasense_compass_handoff_v1';
  const STORE_NAME = 'handoffs';
  const CHANNEL_NAME = 'datasense_compass_channel_v1';

  function openHandoffDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is unavailable in this browser context.'));
      }
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'handoffId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function readHandoffEnvelope(handoffId) {
    try {
      const db = await openHandoffDB();
      const envelope = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(handoffId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (envelope) return envelope;
    } catch (_) {
      // Fall through to localStorage
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(`datasense_compass_handoff_${handoffId}`);
        if (stored) return JSON.parse(stored);
      } catch (_) {}
    }
    return null;
  }

  async function updateHandoffState(handoffId, patch) {
    let existing = null;
    try {
      existing = await readHandoffEnvelope(handoffId);
    } catch (_) {}

    const updated = Object.assign({}, existing || { handoffId }, patch, {
      updatedAt: new Date().toISOString()
    });

    try {
      const db = await openHandoffDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(updated);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`datasense_compass_handoff_${handoffId}`, JSON.stringify(updated));
      } catch (_) {}
    }

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel(CHANNEL_NAME);
        ch.postMessage({ type: updated.state, handoffId: updated.handoffId });
        ch.close();
      } catch (_) {}
    }

    return updated;
  }

  async function checkIncomingHandoff() {
    const params = new URLSearchParams(window.location.search);
    const handoffId = params.get('compass_handoff');
    const returnTo = params.get('return_to') || 'https://rkohnmn.github.io/datasense-studio/compass/';
    if (!handoffId) return null;

    let envelope = await readHandoffEnvelope(handoffId);
    if (!envelope) {
      console.warn(`[DataMendCompassAdapter] Handoff envelope ${handoffId} not found in IndexedDB/localStorage.`);
    }

    await updateHandoffState(handoffId, {
      state: 'ACCEPTED',
      acceptedAt: new Date().toISOString()
    });

    // Render persistent Handoff Return banner in DOM
    renderHandoffBanner(handoffId, returnTo, envelope);

    return { envelope, returnTo, handoffId };
  }

  function renderHandoffBanner(handoffId, returnTo, envelope) {
    if (typeof document === 'undefined') return;
    if (document.getElementById('compass-handoff-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'compass-handoff-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'DataSense Compass Round-Trip Status');
    banner.style.cssText = 'background: #0D1014; color: #F6F4EE; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #10B981; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; z-index: 10000; position: sticky; top: 0; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';

    const rowCount = (envelope && envelope.dataset && envelope.dataset.rows) ? envelope.dataset.rows.length : 'Staged';
    const targetVar = (envelope && envelope.targetVariable) ? ` · Target: <strong>${envelope.targetVariable}</strong>` : '';

    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="background:#10B981; color:#0D1014; font-weight:700; padding:2px 6px; border-radius:3px; font-size:11px;">COMPASS ACTIVE</span>
        <span>Handoff: <code style="font-family:monospace; color:#38BDF8;">${handoffId}</code> (${rowCount} rows${targetVar})</span>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <button id="btn-compass-roundtrip-return" type="button" class="btn btn-sm" style="background:#10B981; color:#0D1014; font-weight:700; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:13px; display:flex; align-items:center; gap:6px;">
          ✓ Return Cleaned Dataset to DataSense Compass
        </button>
      </div>
    `;

    document.body.insertBefore(banner, document.body.firstChild);

    const btn = document.getElementById('btn-compass-roundtrip-return');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.textContent = 'Preparing clean export…';
        btn.disabled = true;

        let cleanedDataset = null;
        if (root.APP_STATE && Array.isArray(root.APP_STATE.datasets)) {
          const ds = root.APP_STATE.datasets.find(d => d.id === root.APP_STATE.activeDatasetId) || root.APP_STATE.datasets[0];
          if (ds) {
            const headers = ds.columns.map(c => c.displayName || c.id);
            const rows = ds.rows.map(r => ds.columns.map(c => {
              const cell = r.cells[c.id];
              return cell ? (cell.transformed !== undefined ? cell.transformed : cell.parsed) : null;
            }));
            cleanedDataset = { headers, rows, title: ds.title, rowCount: rows.length };
          }
        }

        const auditSummary = {
          returnedAt: new Date().toISOString(),
          status: 'CLEANED'
        };

        await completeRoundTrip(handoffId, cleanedDataset, auditSummary, returnTo);
      });
    }
  }

  async function completeRoundTrip(handoffId, cleanedDataset, auditSummary, returnToUrl) {
    const updated = await updateHandoffState(handoffId, {
      state: 'RETURN_READY',
      completedAt: new Date().toISOString(),
      cleanedDataset,
      auditSummary
    });

    const dest = returnToUrl || 'https://rkohnmn.github.io/datasense-studio/compass/';
    const sep = dest.includes('?') ? '&' : '?';
    window.location.href = `${dest}${sep}compass_return=${encodeURIComponent(handoffId)}`;
    return updated;
  }

  root.DataMendCompassAdapter = {
    DB_NAME,
    STORE_NAME,
    CHANNEL_NAME,
    checkIncomingHandoff,
    acceptIncomingCompassHandoff: checkIncomingHandoff,
    readHandoffEnvelope,
    updateHandoffState,
    completeRoundTrip,
    completeRoundTripAndReturn: completeRoundTrip
  };

  // Wire auto-execution on DOMContentLoaded
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => checkIncomingHandoff());
    } else {
      checkIncomingHandoff();
    }
  }
})(typeof self !== 'undefined' ? self : this);
