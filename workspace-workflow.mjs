const copy = value => structuredClone(value);

/** Thumbnail belongs to the template metadata; product image bindings remain project data. */
export function updateTemplateMetadata(template, changes) {
  const next = copy(template);
  if (Object.hasOwn(changes, 'name')) {
    const name = String(changes.name ?? '').trim();
    if (!name) throw new Error('请填写模板名称');
    next.name = name;
  }
  if (Object.hasOwn(changes, 'thumbnail')) {
    if (changes.thumbnail != null && typeof changes.thumbnail !== 'string') throw new Error('模板缩略图无效');
    if (changes.thumbnail) next.thumbnail = changes.thumbnail;
    else delete next.thumbnail;
  }
  return next;
}

export function isStructureLocked(project, element) {
  const target = typeof element === 'string' ? project.elements.find(item => item.id === element) : element;
  return !!(project.layoutLocked || target?.locked);
}

/** Lock the module layout while leaving image bindings, crop and product text/table content editable. */
export function setTemplateLayoutLocked(project, template, locked) {
  const next = copy(project), reusable = copy(template);
  next.layoutLocked = !!locked;
  reusable.layoutLocked = !!locked;
  return { project: next, template: reusable };
}

/** Rebind existing photo slots; geometry, text, tables and footer modules remain intact. */
export function fillLockedLayout(project) {
  const next = copy(project);
  const cover = next.assets.find(asset => asset.id === next.coverId && ['hero', 'models'].includes(asset.group)) || next.assets.find(asset => asset.group === 'hero') || next.assets.find(asset => asset.group === 'models');
  next.coverId = cover?.id || null;
  const slots = {
    cover: cover ? [cover] : [],
    models: next.assets.filter(asset => asset.group === 'models' && asset.id !== next.coverId),
    details: next.assets.filter(asset => asset.group === 'details')
  };
  const used = { cover: 0, models: 0, details: 0 };
  for (const element of next.elements.filter(item => item.type === 'image').sort((a, b) => a.y - b.y || a.x - b.x)) {
    const role = element.role || 'models';
    if (!Object.hasOwn(slots, role)) continue;
    const asset = slots[role][used[role]++];
    delete element.src;
    if (asset) { element.assetId = asset.id; element.name = role === 'cover' ? '首张模特图' : asset.name; }
    else delete element.assetId;
  }
  return next;
}
