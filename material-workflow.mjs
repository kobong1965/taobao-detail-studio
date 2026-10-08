const copy = value => structuredClone(value);
const categories = new Set(['model', 'detail', 'size', 'unknown']);
const groups = { model: 'models', detail: 'details', size: 'size', unknown: 'unclassified' };

const clearTableValues = (table, keepLabels = true) => table && ({
  ...copy(table),
  rows: table.rows.map(row => table.columns.map((_, index) => keepLabels && index === 0 ? row[0] || '' : ''))
});

function validateReview(project, review) {
  if (!Array.isArray(review?.items) || !review.items.length) throw new Error('没有可分析的批次素材');
  const ids = new Set(review.items.map(item => item.assetId));
  if (ids.size !== review.items.length || review.items.some(item => !categories.has(item.category) || !project.assets.some(asset => asset.id === item.assetId))) throw new Error('批次素材已变化，请重新分析');
}

function prepareRecognizedSize(project, table, options) {
  if (!Array.isArray(table?.columns) || !Array.isArray(table?.rows) || !table.columns.length || !table.rows.length) throw new Error('尺码识别结果没有有效表格');
  if (options.targetRows && table.rows.length > options.targetRows) throw new Error(`当前模板最多 ${options.targetRows} 行尺码，识别结果未覆盖原数据`);
  const mapped = options.prepareSizeData ? options.prepareSizeData(table) : options.mapSizeData?.(project.sizeData.columns, table, options.preferredOrder || project.sizeData.rows.map(row => row[0]));
  if (!mapped?.data || !Array.isArray(mapped.missing)) throw new Error('没有可用的尺码字段映射');
  if (mapped.missing.includes(project.sizeData.columns[0])) throw new Error('尺码标签字段未匹配，请核对识别结果');
  return mapped.data;
}

export function normalizeBatchReview(assets, result) {
  const ids = new Set(assets.map(asset => asset.id));
  if (ids.size !== assets.length || !Array.isArray(result?.items)) throw new Error('素材分析结果无效');
  const items = new Map();
  for (const source of result.items) {
    if (!ids.has(source.assetId) || items.has(source.assetId)) throw new Error('分析结果包含未知或重复素材');
    const confidence = Number(source.confidence);
    const valid = categories.has(source.category) && Number.isFinite(confidence) && confidence >= .75;
    const reviewedSkip = source.category === 'unknown' && source.needsReview === false;
    items.set(source.assetId, { ...copy(source), category: valid ? source.category : 'unknown', confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0, needsReview: reviewedSkip ? false : !valid || source.category === 'unknown' || source.needsReview === true });
  }
  const complete = assets.map(asset => items.get(asset.id) || { assetId: asset.id, category: 'unknown', confidence: 0, needsReview: true, reason: '模型未返回此图片的分类，请核对' });
  const sizeTables = copy(result.sizeTables || []);
  if (sizeTables.some(item => !ids.has(item.assetId)) || new Set(sizeTables.map(item => item.assetId)).size !== sizeTables.length) throw new Error('尺码结果包含未知或重复素材');
  const coverAssetId = complete.some(item => item.assetId === result.coverAssetId && item.category === 'model') ? result.coverAssetId : null;
  return { ...copy(result), items: complete, sizeTables, coverAssetId, warnings: copy(result.warnings || []) };
}

export function planBatchFill(project, review, options = {}) {
  if (!review?.items?.length || review.items.some(item => item.needsReview)) throw new Error('请先确认待核对图片的分类，或选择不填入');
  const ids = new Set(review.items.map(item => item.assetId));
  if (ids.size !== review.items.length || review.items.some(item => !categories.has(item.category) || !project.assets.some(asset => asset.id === item.assetId))) throw new Error('批次素材已变化，请重新分析');
  if (review.items.every(item => item.category === 'unknown')) throw new Error('本批次没有可填入的素材');
  const tables = (review.sizeTables || []).filter(item => review.items.some(image => image.assetId === item.assetId && image.category === 'size'));
  if (tables.length > 1 && !review.selectedSizeAssetId) throw new Error('识别出多张尺码表，请选择本次使用的尺码图');
  const size = tables.find(item => item.assetId === review.selectedSizeAssetId) || (tables.length === 1 ? tables[0] : null);
  if (review.selectedSizeAssetId && !size) throw new Error('选择的尺码表没有有效数据，请重新识别');
  let sizeData = copy(project.sizeData);
  if (size) {
    if (options.targetRows && size.table.rows.length > options.targetRows) throw new Error(`当前模板最多 ${options.targetRows} 行尺码，识别结果未覆盖原数据`);
    const mapped = options.prepareSizeData ? options.prepareSizeData(size.table) : options.mapSizeData(project.sizeData.columns, size.table, options.preferredOrder || project.sizeData.rows.map(row => row[0]));
    if (mapped.missing.includes(project.sizeData.columns[0])) throw new Error('尺码标签字段未匹配，请核对识别结果');
    sizeData = mapped.data;
  }
  const next = copy(project), byId = new Map(review.items.map(item => [item.assetId, item]));
  next.assets = next.assets.map(asset => {
    const item = byId.get(asset.id);
    if (item) return { ...asset, group: groups[item.category], analysis: { category: item.category, confidence: item.confidence, reason: item.reason || '', confirmed: true } };
    return ['hero', 'models', 'details', 'size'].includes(asset.group) ? { ...asset, group: 'library' } : asset;
  });
  const models = review.items.filter(item => item.category === 'model');
  next.coverId = models.some(item => item.assetId === review.coverAssetId) ? review.coverAssetId : models[0]?.assetId || null;
  next.sizeData = sizeData;
  const selectedSizeId = size?.assetId || review.items.find(item => item.category === 'size')?.assetId;
  if (selectedSizeId) next.sizeSource = next.assets.find(asset => asset.id === selectedSizeId).src;
  else delete next.sizeSource;
  next.demo = false; next.referenceExample = false;
  next.batchAnalysis = copy(review);
  return next;
}

/** Fast classification fills usable photos before the slower size-table pass finishes. */
export function planQuickFill(project, review, options = {}) {
  validateReview(project, review);
  const batchId = options.batchId ?? review.batchId;
  if (typeof batchId !== 'string' || !batchId.trim()) throw new Error('素材批次标识缺失，请重新分析');
  const sameBatch = project.batchAnalysis?.batchId === batchId;
  const previousItems = new Map((sameBatch ? project.batchAnalysis.items || [] : []).map(item => [item.assetId, item]));
  const effective = review.items.map(item => {
    const previous = previousItems.get(item.assetId);
    const unchangedAutoFill = previous?.autoFilled && previous.category === item.category && previous.provisionalCategory === item.category;
    const accepted = item.confirmed === true || unchangedAutoFill || (Number(item.confidence) >= .75 && item.needsReview !== true);
    const category = accepted ? item.category : 'unknown';
    const autoFilled = accepted && item.confirmed !== true && category !== 'unknown';
    return { ...copy(item), category, autoFilled, provisionalCategory: autoFilled ? category : null, confirmed: item.confirmed === true, needsReview: item.confirmed === true ? false : category === 'unknown' || item.needsReview === true };
  });
  const next = copy(project), byId = new Map(effective.map(item => [item.assetId, item]));
  next.assets = next.assets.map(asset => {
    const item = byId.get(asset.id);
    if (item) return { ...asset, group: groups[item.category], analysis: { category: item.category, confidence: item.confidence, reason: item.reason || '', confirmed: item.confirmed } };
    return ['hero', 'models', 'details', 'size'].includes(asset.group) ? { ...asset, group: 'library' } : asset;
  });
  const models = effective.filter(item => item.category === 'model');
  next.coverId = models.some(item => item.assetId === review.coverAssetId) ? review.coverAssetId : models[0]?.assetId || null;
  const candidates = effective.filter(item => item.category === 'size').map(item => item.assetId);
  let explicitId = review.selectedSizeAssetId;
  if (explicitId && !candidates.includes(explicitId)) {
    // A human may correct the selected chart into a photo or leave it unused.
    // Discard that stale selection, while still rejecting unrelated IDs.
    if (review.items.some(item => item.assetId === explicitId && item.category !== 'size')) explicitId = null;
    else throw new Error('选择的尺码图已变化，请重新选择');
  }
  const selectedId = explicitId || (sameBatch && candidates.includes(project.sizeSourceAssetId) ? project.sizeSourceAssetId : candidates.length === 1 ? candidates[0] : null);
  const sourceChanged = sameBatch && project.sizeSourceAssetId && project.sizeSourceAssetId !== selectedId;
  const resetSize = (options.resetSize ?? !sameBatch) || sourceChanged;
  if (resetSize) {
    next.sizeData = clearTableValues(next.sizeData);
    if (next.recommendationData) next.recommendationData = clearTableValues(next.recommendationData, false);
    delete next.sizeRecognition;
    delete next.sizeScan;
    next.sizeRevision = (next.sizeRevision || 0) + 1;
  }
  if (selectedId) {
    next.sizeSourceAssetId = selectedId;
    next.sizeSource = next.assets.find(asset => asset.id === selectedId).src;
  } else {
    delete next.sizeSourceAssetId;
    delete next.sizeSource;
  }
  next.sizeCandidates = candidates;
  next.demo = false; next.referenceExample = false;
  next.batchAnalysis = { ...copy(review), items: effective, batchId, sizeCandidateIds: candidates, selectedSizeAssetId: selectedId, sizeStatus: next.sizeRecognition ? 'complete' : selectedId ? 'pending' : candidates.length > 1 ? 'selection-required' : 'missing' };
  return next;
}

/** Capture only fields whose later changes would make an OCR response obsolete. */
export function captureSizeRecognition(project, options = {}) {
  if (!project.sizeSource) throw new Error('请先选择尺码原图');
  return {
    projectId: project.id,
    batchId: options.batchId ?? project.batchAnalysis?.batchId ?? null,
    source: project.sizeSource,
    sourceAssetId: project.sizeSourceAssetId || project.assets.find(asset => asset.src === project.sizeSource)?.id || null,
    kind: project.kind,
    data: JSON.stringify(project.sizeData),
    recommendationData: JSON.stringify(project.recommendationData),
    revision: project.sizeRevision || 0
  };
}

export function canApplySizeRecognition(project, request) {
  if (!request || project.id !== request.projectId || (project.batchAnalysis?.batchId ?? null) !== request.batchId || project.sizeSource !== request.source || (project.sizeSourceAssetId || project.assets.find(asset => asset.src === project.sizeSource)?.id || null) !== request.sourceAssetId || project.kind !== request.kind) return false;
  return JSON.stringify(project.sizeData) === request.data && JSON.stringify(project.recommendationData) === request.recommendationData && (project.sizeRevision || 0) === request.revision;
}

export function applyBackgroundSizeResult(project, request, table, options = {}) {
  if (!canApplySizeRecognition(project, request)) return { applied: false, project, reason: '工程、素材批次、尺码原图或人工尺码已变化，后台结果未覆盖当前内容' };
  const next = copy(project);
  next.sizeData = copy(prepareRecognizedSize(project, table, options));
  next.sizeRecognition = { table: copy(table), recognizedAt: options.recognizedAt ?? Date.now(), sourceAssetId: request.sourceAssetId, batchId: request.batchId, method: 'configured-api' };
  if (next.batchAnalysis) next.batchAnalysis.sizeStatus = 'complete';
  return { applied: true, project: next };
}

/** Only the chosen object changes; the shared material remains immutable and reusable. */
export function replaceMaterial(project, elementId, assetId) {
  const source = project.elements.find(item => item.id === elementId), asset = project.assets.find(item => item.id === assetId);
  if (!source || source.type !== 'image' || !asset) throw new Error('图片板块或素材不存在');
  const next = copy(project), element = next.elements.find(item => item.id === elementId);
  element.assetId = asset.id; element.name = asset.name;
  if (!project.layoutLocked && !element.locked && element.fit === 'natural') element.h = Math.round(element.w * asset.height / asset.width);
  if (element.role === 'cover') next.coverId = asset.id;
  return next;
}

export function syncTemplateDraft(project, template, drafts) {
  if (!Array.isArray(drafts) || new Set(drafts.map(item => item.id)).size !== drafts.length || drafts.some(item => !project.elements.some(element => element.id === item.id))) throw new Error('模板对象已变化，请重新打开编辑');
  const allowed = ['name','x','y','w','h','fit','cropX','cropY','fontSize','weight','fontFamily','text','color','align','locked','separatorColor'];
  const byId = new Map(drafts.map(item => [item.id, item])), next = copy(project);
  next.elements = next.elements.map(element => {
    const draft = byId.get(element.id); if (!draft) return element;
    for (const key of allowed) if (Object.hasOwn(draft, key)) element[key] = copy(draft[key]);
    if (['x','y','w','h'].some(key => !Number.isFinite(element[key])) || element.x < 0 || element.y < 0 || element.w < 1 || element.h < 1 || element.x + element.w > 1440.01) throw new Error('模板位置或尺寸超出画布');
    return element;
  });
  const reusable = copy(template);
  delete reusable.builtin; delete reusable.reference;
  reusable.columns = [...next.sizeData.columns];
  reusable.layoutLocked = !!next.layoutLocked;
  reusable.elements = next.elements.map(element => {
    const clean = copy(element);
    for (const key of ['assetId','src','data','rows','values','sizeData','recommendationData']) delete clean[key];
    return clean;
  });
  if (next.recommendationData) reusable.recommendationColumns = [...next.recommendationData.columns];
  next.templateId = reusable.id;
  next.height = Math.max(480, Math.ceil(Math.max(0, ...next.elements.map(element => element.y + element.h))));
  return { project: next, template: reusable };
}
