const mongoose = require('mongoose');
const DailyReport = require('../models/DailyReport');
const Contract = require('../models/Contract');
const Received = require('../models/Received');
const Material = require('../models/Material');
const IsolationTest = require('../models/IsolationTest');

function toObjectId(id) {
  if (!id) return null;
  try {
    return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
  } catch {
    return null;
  }
}

function getRowCell(row, key) {
  const c = row.cells;
  if (!c) return '';
  if (c instanceof Map) return String(c.get(key) ?? '').trim();
  return String(c[key] ?? '').trim();
}

function setRowCell(row, key, val) {
  if (!row.cells) {
    row.cells = new Map();
  }
  if (row.cells instanceof Map) {
    row.cells.set(key, val);
  } else {
    row.cells[key] = val;
  }
}

function clonePanelColumns(cols) {
  if (!cols || !cols.length) return [];
  return cols.map((c) => {
    const o = typeof c.toObject === 'function' ? c.toObject() : c;
    return { id: o.id, title: o.title };
  });
}

/**
 * After a Material rename, refresh denormalized materialName (and matching summary)
 * on daily reports, contracts, and received records for this company/site.
 */
async function syncMaterialDenormAfterRename({ company, site, materialId, oldName, newName }) {
  if (!oldName || !newName || String(oldName).trim() === String(newName).trim()) return;

  const oid = toObjectId(materialId);
  if (!oid) return;

  const midStr = oid.toString();

  // Match by materialId (ObjectId or string). Also match legacy rows with no id but correct oldName.
  const reportFilter = {
    company,
    site,
    $or: [
      { materialId: oid },
      { materialId: midStr },
      {
        materialName: oldName,
        $or: [{ materialId: { $exists: false } }, { materialId: null }]
      }
    ]
  };

  await DailyReport.updateMany(reportFilter, {
    $set: { materialName: newName, materialId: oid }
  });

  await DailyReport.updateMany(
    { company, site, materialId: oid, summary: oldName },
    { $set: { summary: newName } }
  );

  await Contract.updateMany(
    {
      company,
      site,
      $or: [
        { materialId: oid },
        { materialId: midStr }
      ]
    },
    { $set: { materialName: newName, materialId: oid } }
  );

  await Received.updateMany({ company, site, materialName: oldName }, { $set: { materialName: newName } });
}

/**
 * When material unit changes, keep active contracts aligned for reporting consistency.
 */
async function syncMaterialUnitToContracts({ company, site, materialId, newUnit }) {
  if (newUnit !== 'pcs' && newUnit !== 'm') return;
  const oid = toObjectId(materialId);
  if (!oid) return;
  const midStr = oid.toString();
  await Contract.updateMany(
    { company, site, $or: [{ materialId: oid }, { materialId: midStr }] },
    { $set: { unit: newUnit } }
  );
}

/**
 * After a Panel row (name/circuit/cableSize) changes, update daily reports, materials,
 * and isolation test rows that referenced the old panel+circuit.
 */
async function syncPanelDenormAfterUpdate({
  company,
  site,
  oldName,
  oldCircuit,
  newName,
  newCircuit,
  newCableSize
}) {
  const on = String(oldName ?? '').trim();
  const oc = String(oldCircuit ?? '').trim();
  const nn = String(newName ?? '').trim();
  const nc = String(newCircuit ?? '').trim();

  if (!on || !oc) return;

  const panelOrCircuitChanged = on !== nn || oc !== nc;
  const cableOnly =
    !panelOrCircuitChanged && newCableSize !== undefined && newCableSize !== null;

  if (panelOrCircuitChanged) {
    await DailyReport.updateMany(
      { company, site, panel: on, circuit: oc },
      { $set: { panel: nn, circuit: nc } }
    );

    await Material.updateMany(
      { company, site, panel: on, circuit: oc },
      { $set: { panel: nn, circuit: nc } }
    );
  }

  if (!panelOrCircuitChanged && !cableOnly) return;

  const doc = await IsolationTest.findOne({ company, site });
  if (!doc || !doc.panels?.length) return;

  const srcPanelIdx = doc.panels.findIndex((p) => p.name === on);
  if (srcPanelIdx === -1) return;

  const sourcePanel = doc.panels[srcPanelIdx];
  const keptRows = [];
  const touchedRows = [];

  for (const row of sourcePanel.rows) {
    if (getRowCell(row, 'col_2') === oc) {
      setRowCell(row, 'col_2', nc);
      if (newCableSize !== undefined && newCableSize !== null) {
        setRowCell(row, 'col_3', String(newCableSize));
      }
      touchedRows.push(row);
    } else {
      keptRows.push(row);
    }
  }

  if (touchedRows.length === 0) return;

  if (nn === on) {
    sourcePanel.rows = [...keptRows, ...touchedRows];
  } else {
    sourcePanel.rows = keptRows;
    let target = doc.panels.find((p) => p.name === nn);
    if (!target) {
      doc.panels.push({
        id: `panel_sync_${Date.now()}`,
        name: nn,
        columns: clonePanelColumns(sourcePanel.columns),
        rows: [],
        collapsed: false
      });
      target = doc.panels[doc.panels.length - 1];
    }
    target.rows.push(...touchedRows);
  }

  doc.markModified('panels');
  await doc.save();
}

module.exports = {
  syncMaterialDenormAfterRename,
  syncMaterialUnitToContracts,
  syncPanelDenormAfterUpdate
};
