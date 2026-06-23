/**
 * graph-engine.js — Moteur graphique drag & drop
 *
 * Architecture :
 *  - GraphEngine : classe principale, gère l'état et coordonne les sous-systèmes
 *  - Palette     : blocs draggables depuis le schéma
 *  - Canvas      : surface infinie avec pan/zoom, positionnement absolu des nodes
 *  - NodeManager : création, suppression, mise à jour des nœuds
 *  - Connections : tracé SVG des liens parent→enfant
 *  - Drawer      : panneau latéral de configuration d'un nœud
 *  - Sync        : synchronisation bidirectionnelle avec le formulaire classique
 */

// ══════════════════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ══════════════════════════════════════════════════════════════

const TYPE_COLORS = {
  object: 'rgba(99, 102, 241, 0.12)',
  objectDynamic: 'rgba(245, 158, 11, 0.12)',
  array: 'rgba(16, 185, 129, 0.12)',
  global: 'rgba(16, 185, 129, 0.12)',
};

function generateId() {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getFieldIconName(field) {
  if (field.icon) return field.icon;
  if (field.type === 'object' && field.dynamicKeys) return 'fa-solid fa-key';
  if (field.type === 'object') return 'fa-solid fa-folder';
  if (field.type === 'array') return 'fa-solid fa-list';
  const defaults = { global: 'fa-solid fa-gear', string: 'fa-solid fa-font', integer: 'fa-solid fa-hashtag', number: 'fa-solid fa-hashtag', boolean: 'fa-solid fa-toggle-on', select: 'fa-solid fa-list-check' };
  return defaults[field.type] || 'fa-solid fa-file-lines';
}

function getFieldIcon(field, className = '') {
  return ConfigIcons.markup(getFieldIconName(field), className);
}

function getFieldTypeLabel(field) {
  if (field.type === 'object' && field.dynamicKeys) return 'Objet dynamique';
  if (field.type === 'object') return 'Objet';
  if (field.type === 'array' && field.itemType === 'object') return 'Tableau d\'objets';
  if (field.type === 'array') return 'Tableau';
  return field.type;
}

/** Determines if a field should be a draggable block in the palette */
function isComplexField(field) {
  if (field.type === 'object' && field.fields && field.fields.length > 0) return true;
  if (field.type === 'object' && field.dynamicKeys) return true;
  if (field.type === 'array' && field.itemType === 'object') return true;
  return false;
}

/** Collections may contain several graph nodes; fixed objects are a single node. */
function isCollectionField(field) {
  return (field.type === 'object' && field.dynamicKeys) ||
    (field.type === 'array' && field.itemType === 'object');
}

/** Returns sub-fields that are themselves complex (need child controls). */
function getComplexSubFields(field) {
  if (!field.fields) return [];
  return field.fields.filter(isComplexField);
}

function getFieldMaxInstances(field) {
  const max = FieldConstraints.getBound(field, 'max');
  return max !== null && max >= 0 ? max : null;
}

function getFieldMinInstances(field) {
  const min = FieldConstraints.getBound(field, 'min');
  return min !== null && min >= 0 ? min : null;
}

function getFieldConstraintIssues(field, value) {
  return FieldConstraints.getIssues(field, value);
}

function getFieldConstraintErrorHtml(field, value) {
  const issues = getFieldConstraintIssues(field, value);
  return issues.length ? `<div class="field-validation-error graph-field-validation-error">${escapeHtml(issues[0])}</div>` : '';
}

/** Adds an accessible, CSS-rendered validation tooltip without using the browser title tooltip. */
function setGraphValidationIndicator(container, message) {
  if (!container) return;

  let indicator = container.querySelector(':scope > .graph-validation-indicator');
  if (!message) {
    indicator?.remove();
    container.removeAttribute('data-validation-message');
    return;
  }

  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'graph-validation-indicator';
    indicator.setAttribute('role', 'img');
    indicator.tabIndex = 0;
    indicator.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
    container.appendChild(indicator);
  }

  container.dataset.validationMessage = message;
  indicator.setAttribute('aria-label', message);
}

/** Keeps inline graph field labels consistent with the regular form. */
function getGraphFieldLabelHtml(field) {
  const label = escapeHtml(field.label || field.name);
  const required = field.required ? '<span class="required-star">*</span>' : '';
  const regex = field.validation?.regex;
  const regexBadge = regex
    ? `<span class="regex-hint-badge" title="Pattern: ${escapeHtml(regex)}">regex</span>`
    : '';
  const iconMarkup = (field.icon && window.ConfigIcons)
    ? ConfigIcons.markup(field.icon, 'schema-icon')
    : '';
  return `${iconMarkup}${label}${required}${regexBadge}`;
}

/** Updates inline graph controls without rebuilding their node or losing focus. */
function syncInlineFieldValidation(container, fields, values, rawData = null, nodePath = '') {
  if (!container) return;

  (fields || []).filter(field => !isComplexField(field)).forEach(field => {
    const controls = [...container.querySelectorAll('[data-field-name]')]
      .filter(control => control.dataset.fieldName === field.name);
    if (controls.length === 0) return;

    const fieldElement = controls[0].closest('.graph-node-field');
    if (!fieldElement) return;

    // Check condition if rawData is provided
    if (field.condition && rawData) {
      const fieldPath = nodePath ? `${nodePath}.${field.name}` : field.name;
      const pathVarsMap = {};
      const processedCondition = preprocessCondition(field.condition, fieldPath, rawData, pathVarsMap);
      const context = { ...buildEvalContext(rawData, fieldPath), ...pathVarsMap };
      if (!evaluateCondition(processedCondition, context)) {
        fieldElement.classList.add('condition-hidden');
        fieldElement.classList.remove('has-validation-error');
        controls.forEach(control => control.setAttribute('aria-invalid', 'false'));
        fieldElement.querySelector('.graph-field-validation-error')?.remove();
        return;
      } else {
        fieldElement.classList.remove('condition-hidden');
      }
    } else {
      fieldElement.classList.remove('condition-hidden');
    }

    const issues = getFieldConstraintIssues(field, values?.[field.name]);
    fieldElement.classList.toggle('has-validation-error', issues.length > 0);
    controls.forEach(control => control.setAttribute('aria-invalid', String(issues.length > 0)));

    let errorElement = fieldElement.querySelector('.graph-field-validation-error');
    if (issues.length === 0) {
      errorElement?.remove();
      return;
    }

    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.className = 'field-validation-error graph-field-validation-error';
      fieldElement.appendChild(errorElement);
    }
    errorElement.textContent = issues[0];
  });
}

/** Gets default values for a field */
function getFieldDefaults(field) {
  if (field.default !== undefined) return field.default;
  if (field.type === 'object') return {};
  if (field.type === 'array') return [];
  if (field.type === 'boolean') return false;
  if (field.type === 'integer' || field.type === 'number') return '';
  return '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolvePathFromData(data, sourcePath, currentFieldName, nodePathSegments = []) {
  if (!sourcePath || typeof sourcePath !== 'string') return undefined;

  let segments = [];
  if (sourcePath.startsWith('/')) {
    segments = sourcePath.split('/').filter(Boolean);
  } else {
    // Resolve relative path against the parent node path segments
    const base = [...nodePathSegments];
    sourcePath.split('/').forEach(seg => {
      if (seg === '..') {
        base.pop();
      } else if (seg && seg !== '.') {
        base.push(seg);
      }
    });
    segments = base;
  }

  let current = data;
  for (const segment of segments) {
    if (current && typeof current === 'object') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function resolveArrayFieldChoices(field, currentFormData, nodePathSegments = []) {
  if (field.options) return field.options;
  if (field.optionsFrom) {
    const value = resolvePathFromData(currentFormData, field.optionsFrom, field.name, nodePathSegments);
    if (Array.isArray(value)) {
      return value.filter(item => typeof item === 'string' || typeof item === 'number');
    }
    if (value && typeof value === 'object') {
      return Object.keys(value);
    }
    if (value !== undefined && value !== null) {
      return [String(value)];
    }
    return [];
  }
  if (field.optionsUrl) {
    return [];
  }
  return null;
}

function populateGraphArrayChoices(container, currentValues) {
  if (typeof loadOptionsFromUrl !== 'function' || !container) return;

  const fieldName = container.dataset.fieldName;
  if (!fieldName) return;

  const optionsUrlRaw = container.dataset.optionsUrl;
  if (!optionsUrlRaw) return;

  let config = null;
  try {
    config = JSON.parse(optionsUrlRaw);
  } catch (err) {
    config = optionsUrlRaw;
  }

  const checkedBoxes = Array.from(container.querySelectorAll('input[type="checkbox"]:checked'));
  const currentVal = checkedBoxes.map(cb => cb.value);

  loadOptionsFromUrl(config, container, currentVal, false).catch(() => {
    const itemsWrapper = container.querySelector('.checklist-items-wrapper');
    if (itemsWrapper) {
      itemsWrapper.innerHTML = '<div style="color: var(--color-danger); font-size: 14px;">Erreur de chargement des options</div>';
    }
  });
}

function refreshGraphDynamicArrayChoices(rootEl) {
  if (!rootEl) return;
  const dynamicContainers = rootEl.querySelectorAll('.graph-node-field-checkboxes[data-options-url]');
  dynamicContainers.forEach(container => populateGraphArrayChoices(container));
}

/** Build a preview string from node values */
function buildPreviewRows(field, values) {
  if (!values || !field.fields) return [];
  const simpleFields = (field.fields || []).filter(f => !isComplexField(f));
  return simpleFields.map(f => {
    const val = values[f.name];
    if (Array.isArray(val)) {
      const count = val.length;
      return { key: f.label || f.name, val: count === 0 ? 'Aucun élément' : `${count} élément${count > 1 ? 's' : ''}`, missing: f.required && count === 0 };
    }
    if (val === undefined || val === null || val === '') {
      return { key: f.label || f.name, val: 'Non renseigné', missing: !!f.required };
    }
    if (val === undefined || val === null || val === '') return null;
    const displayVal = typeof val === 'boolean'
      ? (val ? '✓' : '✗')
      : String(val).slice(0, 30);
    return { key: f.label || f.name, val: displayVal };
  }).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════
// GRAPH ENGINE CLASS
// ══════════════════════════════════════════════════════════════

class GraphEngine {
  constructor() {
    // DOM references
    this.canvasWrapper = document.getElementById('graph-canvas-wrapper');
    this.canvas = document.getElementById('graph-canvas');
    this.svgLayer = document.getElementById('graph-connections-svg');
    this.paletteBlocks = document.getElementById('graph-palette-blocks');
    this.paletteGlobals = document.getElementById('graph-palette-globals');
    this.emptyState = document.getElementById('graph-canvas-empty');
    this.zoomIndicator = document.getElementById('graph-zoom-indicator');
    this.validationSummary = document.getElementById('graph-validation-summary');
    this.validationDetails = document.getElementById('graph-validation-details');
    this.validationIssues = [];
    this.outputCode = document.getElementById('graph-code-output');
    this.outputPanel = document.getElementById('graph-output-panel');

    // Drawer
    this.drawer = document.getElementById('graph-drawer');
    this.drawerOverlay = document.getElementById('graph-drawer-overlay');
    this.drawerIcon = document.getElementById('graph-drawer-icon');
    this.drawerTitle = document.getElementById('graph-drawer-title');
    this.drawerSubtitle = document.getElementById('graph-drawer-subtitle');
    this.drawerKeySection = document.getElementById('graph-drawer-key-section');
    this.drawerKeyInput = document.getElementById('graph-drawer-key-input');
    this.drawerBody = document.getElementById('graph-drawer-body');
    this.drawerClose = document.getElementById('graph-drawer-close');
    this.drawerCancel = document.getElementById('graph-drawer-cancel');
    this.drawerApply = document.getElementById('graph-drawer-apply');

    // Modal
    this.modal = document.getElementById('graph-modal');
    this.modalOverlay = document.getElementById('graph-modal-overlay');
    this.modalForm = document.getElementById('graph-modal-form');
    this.modalTitle = document.getElementById('graph-modal-title');
    this.modalDescription = document.getElementById('graph-modal-description');
    this.modalInputLabel = document.getElementById('graph-modal-input-label');
    this.modalInput = document.getElementById('graph-modal-input');
    this.modalError = document.getElementById('graph-modal-error');
    this.modalConfirm = document.getElementById('graph-modal-confirm');
    this.modalCancel = document.getElementById('graph-modal-cancel');
    this.modalClose = document.getElementById('graph-modal-close');

    // State
    this.schema = null;
    this.nodes = new Map();        // nodeId → { field, instanceKey, values, el, parentId, childIds }
    this.connections = new Map();  // parentId → Set of childIds
    this.groups = new Map();       // context + field → visual collection frame
    this.activeDrawerNodeId = null;
    this.modalAction = null;
    this.currentParentId = null;
    this.selectedNodeId = null;

    // Canvas transform
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.MIN_ZOOM = 0.3;
    this.MAX_ZOOM = 2.5;

    // Drag state
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // Current drag from palette
    this.currentDragField = null;
    this.dragGhost = null;

    // Current drag target (for child drops)
    this.dragTargetParentId = null;
    this.dragTargetChildField = null;

    // Initialize listeners once
    this.initCanvasInteraction();
    this.initDrawer();
    this.initModal();
    this.initOutputPanel();
    this.initToolbarButtons();
    this.initValidationSummary();
    this.initKeyboardShortcuts();
  }

  getNodePathSegments(node) {
    if (!node || node.id === 'global') return [];
    const segments = [];
    let current = node;
    while (current && current.id !== 'global') {
      if (current.parentId) {
        const parentNode = this.nodes.get(current.parentId);
        if (parentNode) {
          const currentField = current.field;
          if (currentField.dynamicKeys) {
            segments.unshift(current.instanceKey);
            segments.unshift(currentField.name);
          } else if (currentField.type === 'array' && currentField.itemType === 'object') {
            const siblings = [...parentNode.childIds]
              .map(id => this.nodes.get(id))
              .filter(n => n && n.field.name === currentField.name);
            const index = siblings.indexOf(current);
            segments.unshift(index >= 0 ? index : 0);
            segments.unshift(currentField.name);
          } else if (currentField.type === 'object') {
            segments.unshift(currentField.name);
          }
        }
      } else {
        const currentField = current.field;
        if (currentField.dynamicKeys) {
          segments.unshift(current.instanceKey);
          segments.unshift(currentField.name);
        } else if (currentField.type === 'array' && currentField.itemType === 'object') {
          const rootNodes = [...this.nodes.values()].filter(n => n.field.name === currentField.name && !n.parentId);
          const index = rootNodes.indexOf(current);
          segments.unshift(index >= 0 ? index : 0);
          segments.unshift(currentField.name);
        } else if (currentField.type === 'object') {
          segments.unshift(currentField.name);
        }
      }
      current = current.parentId ? this.nodes.get(current.parentId) : null;
    }
    return segments;
  }

  getNodePathString(node) {
    const segments = this.getNodePathSegments(node);
    let pathStr = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (typeof seg === 'number') {
        pathStr += `[${seg}]`;
      } else {
        pathStr += pathStr ? `.${seg}` : seg;
      }
    }
    return pathStr;
  }

  // ──────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────

  init(schema) {
    this.schema = schema;
    this.nodes.clear();
    this.connections.clear();
    this.currentParentId = null;
    this.selectedNodeId = null;
    this.groups.clear();
    this.canvas.innerHTML = '';
    this.svgLayer.innerHTML = `
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" class="graph-connection-arrow"/>
        </marker>
      </defs>`;

    this.buildPalette();
    this.renderGroups();
    this.updateEmptyState();
  }

  // ──────────────────────────────────────────────────────────
  // PALETTE
  // ──────────────────────────────────────────────────────────

  buildPalette() {
    this.paletteBlocks.innerHTML = '';
    
    let complexFields = [];
    let simpleFields = [];
    if (this.currentParentId === null) {
      if (this.schema && this.schema.fields) {
        complexFields = this.schema.fields.filter(isComplexField);
        simpleFields = this.schema.fields.filter(f => !isComplexField(f));
      }
    } else {
      const parentNode = this.nodes.get(this.currentParentId);
      if (parentNode && parentNode.field && parentNode.field.fields) {
        complexFields = parentNode.field.fields.filter(isComplexField);
        simpleFields = parentNode.field.fields.filter(f => !isComplexField(f));
      }
    }

    // Show/hide simple fields global hint container
    if (simpleFields.length > 0) {
      this.paletteGlobals.style.display = 'block';
    } else {
      this.paletteGlobals.style.display = 'none';
    }

    if (complexFields.length === 0) {
      this.paletteBlocks.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:16px;">
        Aucun objet complexe disponible dans ce contexte.
      </div>`;
      return;
    }

    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'graph-palette-section-title';
    sectionTitle.textContent = 'Blocs';
    this.paletteBlocks.appendChild(sectionTitle);

    complexFields.forEach(field => {
      const item = this.createPaletteItem(field);
      this.paletteBlocks.appendChild(item);
    });

    // The palette is rebuilt after form defaults are imported. Recalculate the
    // badges now that their DOM elements exist, instead of leaving them at 0.
    this.updatePaletteCounts();
  }

  createPaletteItem(field) {
    const item = document.createElement('div');
    item.className = 'graph-palette-item';
    item.draggable = true;
    item.dataset.fieldName = field.name;
    item.title = field.description || field.label || field.name;

    const countBadge = document.createElement('span');
    countBadge.className = 'palette-item-count';
    countBadge.textContent = '0';
    countBadge.id = `palette-count-${field.name}`;

    item.innerHTML = `
      <span class="palette-item-icon">${getFieldIcon(field)}</span>
      <div class="palette-item-info">
        <div class="palette-item-label">${field.label || field.name}</div>
        <div class="palette-item-type">${getFieldTypeLabel(field)}</div>
      </div>
      <span class="palette-item-drag-hint">⠿</span>
    `;
    item.appendChild(countBadge);

    // Native HTML5 drag events
    item.addEventListener('dragstart', (e) => {
      if (!this.canAddField(field, this.currentParentId)) {
        e.preventDefault();
        return;
      }
      this.currentDragField = field;
      item.classList.add('dragging-source');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', field.name);

      // Create ghost element
      this.dragGhost = document.createElement('div');
      this.dragGhost.className = 'graph-drag-ghost';
      this.dragGhost.innerHTML = `<span>${getFieldIcon(field)}</span> ${field.label || field.name}`;
      document.body.appendChild(this.dragGhost);
      e.dataTransfer.setDragImage(this.dragGhost, 0, 0);

      this.highlightCompatibleTargets(field.name, true);
    });

    item.addEventListener('dragend', () => {
      this.highlightCompatibleTargets(field.name, false);

      item.classList.remove('dragging-source');
      this.currentDragField = null;
      if (this.dragGhost) {
        this.dragGhost.remove();
        this.dragGhost = null;
      }
      this.canvasWrapper.classList.remove('drag-over-canvas');
    });

    item.addEventListener('mouseenter', () => {
      if (!this.currentDragField) {
        this.highlightCompatibleTargets(field.name, true);
      }
    });

    item.addEventListener('mouseleave', () => {
      if (!this.currentDragField) {
        this.highlightCompatibleTargets(field.name, false);
      }
    });

    return item;
  }

  highlightCompatibleTargets(fieldName, active = true) {
    // Find visible groups for this field
    this.groups.forEach(group => {
      if (group.field.name === fieldName && group.parentId === this.currentParentId) {
        if (this.canAddField(group.field, this.currentParentId)) {
          group.el.classList.toggle('compatibility-highlight', active);
        }
      }
    });

    // Find visible dropzones accepting this field
    this.nodes.forEach(node => {
      if (node.id !== 'global' && node.parentId === this.currentParentId && node.el) {
        const dzs = node.el.querySelectorAll(`.graph-node-dropzone[data-accepts="${fieldName}"]`);
        dzs.forEach(dz => {
          const childField = node.field.fields?.find(f => f.name === fieldName);
          if (childField && this.canAddField(childField, node.id)) {
            dz.classList.toggle('compatibility-highlight', active);
          }
        });
      }
    });
  }

  updatePaletteCounts() {
    let complexFields = [];
    if (this.currentParentId === null) {
      if (this.schema && this.schema.fields) {
        complexFields = this.schema.fields.filter(isComplexField);
      }
    } else {
      const parentNode = this.nodes.get(this.currentParentId);
      if (parentNode && parentNode.field && parentNode.field.fields) {
        complexFields = parentNode.field.fields.filter(isComplexField);
      }
    }

    complexFields.forEach(field => {
      const badge = document.getElementById(`palette-count-${field.name}`);
      if (!badge) return;
      let count = 0;
      this.nodes.forEach(node => {
        if (node.field.name === field.name && node.parentId === this.currentParentId) count++;
      });
      badge.textContent = count;

      const minimum = getFieldMinInstances(field);
      const isBelowMinimum = (field.required && count === 0) ||
        (minimum !== null && count < minimum);
      badge.closest('.graph-palette-item')?.classList.toggle('needs-minimum-attention', isBelowMinimum);
    });
    this.updateCapacityUI();
  }

  // ──────────────────────────────────────────────────────────
  // CANVAS INTERACTION (Pan + Zoom + Drop)
  // ──────────────────────────────────────────────────────────

  initCanvasInteraction() {
    const wrapper = this.canvasWrapper;

    // ── Pan with right-click drag or middle button ──
    wrapper.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        this.cancelSmoothTransition();
        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
        wrapper.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning) return;
      this.panX = e.clientX - this.panStartX;
      this.panY = e.clientY - this.panStartY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.isPanning = false;
        wrapper.style.cursor = '';
      }
    });

    // Prevent context menu on right-click
    wrapper.addEventListener('contextmenu', e => e.preventDefault());

    // ── Zoom with mouse wheel ──
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cancelSmoothTransition();
      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(this.MAX_ZOOM, Math.max(this.MIN_ZOOM, this.zoom * zoomFactor));

      // Zoom toward mouse position
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.applyTransform();
      this.zoomIndicator.textContent = `${Math.round(this.zoom * 100)}%`;
    }, { passive: false });

    // ── Drop from palette ──
    wrapper.addEventListener('dragover', (e) => {
      if (this.currentDragField) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        wrapper.classList.add('drag-over-canvas');
      }
    });

    wrapper.addEventListener('dragleave', (e) => {
      if (!wrapper.contains(e.relatedTarget)) {
        wrapper.classList.remove('drag-over-canvas');
      }
    });

    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-over-canvas');

      if (!this.currentDragField) return;

      // Convert drop position to canvas coordinates
      const rect = wrapper.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - this.panX) / this.zoom;
      const canvasY = (e.clientY - rect.top - this.panY) / this.zoom;

      if (this.currentParentId === null) {
        this.createNodeFromUserAction(this.currentDragField, null, canvasX, canvasY);
      } else {
        this.createNodeFromUserAction(this.currentDragField, this.currentParentId, canvasX, canvasY);
      }
    });

    // ── Click on canvas background to deselect ──
    wrapper.addEventListener('click', (e) => {
      if (!e.target.closest('.graph-node') && 
          !e.target.closest('.graph-group') && 
          !e.target.closest('.graph-palette') &&
          !e.target.closest('.graph-drawer') &&
          !e.target.closest('.graph-modal') &&
          !e.target.closest('.graph-validation-summary') &&
          !e.target.closest('.graph-validation-details') &&
          !e.target.closest('.graph-canvas-toolbar') &&
          !e.target.closest('.graph-breadcrumbs')) {
        this.deselectAllNodes();
      }
    });

    // ── interact.js for node repositioning (applied per node, see createNodeEl) ──
  }

  applyTransform() {
    this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.svgLayer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.updateAllConnections();
  }

  fitView() {
    const visibleNodes = [...this.nodes.values()].filter(node => 
      node.id === 'global' || node.parentId === this.currentParentId
    );

    if (visibleNodes.length === 0) {
      this.panX = 0;
      this.panY = 0;
      this.zoom = 1;
      this.applyTransform();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visibleNodes.forEach(node => {
      const el = node.el;
      if (!el) return;
      const x = parseFloat(el.style.left) || 0;
      const y = parseFloat(el.style.top) || 0;
      const w = el.offsetWidth || (node.id === 'global' ? 240 : 220);
      const h = el.offsetHeight || 150;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    this.getVisibleGroups().forEach(group => {
      const x = parseFloat(group.el.style.left) || 0;
      const y = parseFloat(group.el.style.top) || 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + group.el.offsetWidth);
      maxY = Math.max(maxY, y + group.el.offsetHeight);
    });

    const padding = 80;
    const rect = this.canvasWrapper.getBoundingClientRect();
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const newZoom = Math.min(this.MAX_ZOOM, Math.min(rect.width / contentW, rect.height / contentH));

    this.zoom = Math.max(0.3, newZoom);
    this.panX = (rect.width - contentW * this.zoom) / 2 - (minX - padding) * this.zoom;
    this.panY = (rect.height - contentH * this.zoom) / 2 - (minY - padding) * this.zoom;
    this.applyTransform();
    this.zoomIndicator.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  selectNode(nodeId) {
    if (this.selectedNodeId && this.selectedNodeId !== nodeId) {
      const prevNode = this.nodes.get(this.selectedNodeId);
      if (prevNode && prevNode.el) {
        prevNode.el.classList.remove('is-selected');
        prevNode.el.style.zIndex = '';
      }
    }

    this.selectedNodeId = nodeId;

    if (nodeId) {
      const node = this.nodes.get(nodeId);
      if (node && node.el) {
        node.el.classList.add('is-selected');
        node.el.style.zIndex = '30';
      }
    }
  }

  deselectAllNodes() {
    if (this.selectedNodeId) {
      const prevNode = this.nodes.get(this.selectedNodeId);
      if (prevNode && prevNode.el) {
        prevNode.el.classList.remove('is-selected');
        prevNode.el.style.zIndex = '';
      }
      this.selectedNodeId = null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // CONTEXT & NAVIGATION
  // ──────────────────────────────────────────────────────────

  enterNode(nodeId) {
    // The green variables card writes directly to the node currently open.
    // Its blue card is not rebuilt on every keystroke, so refresh it before
    // leaving the context to show the values just entered.
    const previousParentId = this.currentParentId;
    if (previousParentId && previousParentId !== nodeId) {
      this.refreshNodeEl(previousParentId);
    }

    this.deselectAllNodes();
    this.currentParentId = nodeId;

    // 1. Rebuild the variables node for this level
    this.renderVariablesNode();

    // 2. Hide/Show node elements
    this.nodes.forEach((node, id) => {
      if (id === 'global') return; // Handled separately
      
      if (node.parentId === this.currentParentId) {
        node.el.style.display = 'block';
      } else {
        node.el.style.display = 'none';
      }
    });

    this.renderGroups();

    // 3. Rebuild palette
    this.buildPalette();

    // 4. Rebuild breadcrumbs
    this.buildBreadcrumbs();

    // 5. Update connections
    this.updateAllConnections();
    this.updateValidationState();

    // 6. Reset view or fit view
    this.fitView();
  }

  buildBreadcrumbs() {
    const container = document.getElementById('graph-breadcrumbs');
    if (!container) return;

    container.innerHTML = '';

    if (this.currentParentId === null) {
      container.innerHTML = `<span class="breadcrumb-item active">Racine</span>`;
      return;
    }

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'breadcrumb-back-btn';
    backBtn.innerHTML = '↟ Remonter';
    backBtn.addEventListener('click', () => {
      const currentNode = this.nodes.get(this.currentParentId);
      this.enterNode(currentNode ? currentNode.parentId : null);
    });
    container.appendChild(backBtn);

    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '|';
    container.appendChild(sep);

    // Trace path
    const path = [];
    let currId = this.currentParentId;
    while (currId !== null) {
      const node = this.nodes.get(currId);
      if (!node) break;
      path.unshift(node);
      currId = node.parentId;
    }

    // Root item
    const rootLink = document.createElement('span');
    rootLink.className = 'breadcrumb-link';
    rootLink.textContent = 'Racine';
    rootLink.addEventListener('click', () => this.enterNode(null));
    container.appendChild(rootLink);

    path.forEach((node, idx) => {
      const arrow = document.createElement('span');
      arrow.className = 'breadcrumb-arrow';
      arrow.textContent = ' > ';
      container.appendChild(arrow);

      if (idx === path.length - 1) {
        const activeItem = document.createElement('span');
        activeItem.className = 'breadcrumb-item active';
        activeItem.textContent = node.instanceKey;
        container.appendChild(activeItem);
      } else {
        const link = document.createElement('span');
        link.className = 'breadcrumb-link';
        link.textContent = node.instanceKey;
        link.addEventListener('click', () => this.enterNode(node.id));
        container.appendChild(link);
      }
    });
  }

  renderVariablesNode() {
    const variablesNode = this.nodes.get('global');
    if (!variablesNode || !variablesNode.el) return;

    // Do NOT reset position here — preserve any drag position the user set.
    // Initial position is set at creation time in createGlobalNode.

    const header = variablesNode.el.querySelector('.graph-node-header');
    const body = variablesNode.el.querySelector('.graph-node-body');

    if (this.currentParentId === null) {
      const simpleFields = this.schema && this.schema.fields ? this.schema.fields.filter(f => !isComplexField(f)) : [];
      if (header) {
        header.style.background = 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))';
        const titleEl = header.querySelector('.graph-node-title');
        if (titleEl) titleEl.textContent = 'Config. globale';
      }
      if (body) {
        body.innerHTML = this.buildGlobalFieldsHTML(simpleFields, variablesNode.values, variablesNode);
      }
    } else {
      const parentNode = this.nodes.get(this.currentParentId);
      if (parentNode) {
        const simpleFields = parentNode.field.fields ? parentNode.field.fields.filter(f => !isComplexField(f)) : [];
        if (header) {
          header.style.background = 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))';
          const titleEl = header.querySelector('.graph-node-title');
          if (titleEl) titleEl.textContent = `Variables : ${parentNode.field.label || parentNode.field.name} (${parentNode.instanceKey})`;
        }
        if (body) {
          if (simpleFields.length > 0) {
            body.innerHTML = this.buildGlobalFieldsHTML(simpleFields, parentNode.values, parentNode);
          } else {
            body.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:0.75rem;">
              Aucune propriété simple à ce niveau.
            </div>`;
          }
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // NODES
  // ──────────────────────────────────────────────────────────

  getGroupKey(parentId, fieldName) {
    return `${parentId === null ? 'root' : parentId}:${fieldName}`;
  }

  getFieldInstanceCount(field, parentId) {
    return [...this.nodes.values()].filter(node => node.parentId === parentId && node.field.name === field.name).length;
  }

  canAddField(field, parentId) {
    if (field.type === 'object' && !field.dynamicKeys) {
      return this.getFieldInstanceCount(field, parentId) === 0;
    }
    const max = getFieldMaxInstances(field);
    return max === null || this.getFieldInstanceCount(field, parentId) < max;
  }

  updateCapacityUI() {
    this.getVisibleGroups().forEach(group => {
      const full = !this.canAddField(group.field, group.parentId);
      group.el.classList.toggle('is-full', full);
      group.el.title = full ? `Limite de ${getFieldMaxInstances(group.field)} élément(s) atteinte` : '';
    });
    document.querySelectorAll('.graph-palette-item').forEach(item => {
      const availableFields = this.currentParentId === null
        ? (this.schema?.fields || []).filter(isComplexField)
        : (this.nodes.get(this.currentParentId)?.field?.fields || []).filter(isComplexField);
      const field = availableFields.find(candidate => candidate.name === item.dataset.fieldName);
      if (!field) return;
      const full = !this.canAddField(field, this.currentParentId);
      item.classList.toggle('is-full', full);
      item.draggable = !full;
      item.setAttribute('aria-disabled', String(full));
    });
    document.querySelectorAll('.btn-duplicate-node').forEach(button => {
      const node = this.nodes.get(button.dataset.nodeId);
      const full = !node || !this.canDuplicateNode(node);
      button.disabled = full;
      button.classList.toggle('is-full', full);
      button.title = full
        ? `Limite de ${getFieldMaxInstances(node?.field)} élément(s) atteinte`
        : 'Dupliquer cet élément';
    });
  }

  getContextComplexFields() {
    if (this.currentParentId === null) return (this.schema?.fields || []).filter(isCollectionField);
    return (this.nodes.get(this.currentParentId)?.field?.fields || []).filter(isCollectionField);
  }

  getVisibleGroups() {
    return [...this.groups.values()].filter(group => group.parentId === this.currentParentId && group.el.style.display !== 'none');
  }

  renderGroups() {
    const fields = this.getContextComplexFields();
    const activeKeys = new Set(fields.map(field => this.getGroupKey(this.currentParentId, field.name)));

    this.groups.forEach((group, key) => {
      group.el.style.display = activeKeys.has(key) ? 'block' : 'none';
    });

    fields.forEach((field, index) => {
      const key = this.getGroupKey(this.currentParentId, field.name);
      let group = this.groups.get(key);
      if (!group) {
        const el = document.createElement('section');
        el.className = 'graph-group';
        el.dataset.groupKey = key;
        el.dataset.fieldName = field.name;
        el.style.left = `${60 + (index % 3) * 460}px`;
        el.style.top = `${70 + Math.floor(index / 3) * 570}px`;
        el.innerHTML = `<div class="graph-group-title">${getFieldIcon(field)} <span>${escapeHtml(field.label || field.name)}</span><small>${field.dynamicKeys ? 'clé libre' : getFieldTypeLabel(field)}</small></div><div class="graph-group-hint">Glissez ou double-cliquez pour ajouter</div>`;
        this.canvas.insertBefore(el, this.canvas.firstChild);
        group = { key, parentId: this.currentParentId, field, el };
        this.groups.set(key, group);
        // Imported nodes are initially created before their contextual group
        // exists. Force their first placement into that frame when it opens.
        [...this.nodes.values()]
          .filter(node => node.imported && node.parentId === group.parentId && node.field.name === group.field.name)
          .forEach(node => { node.groupPositioned = false; });
        this.makeGroupDraggable(group);

        el.addEventListener('dragover', (event) => {
          if (this.currentDragField?.name !== field.name || !this.canAddField(field, this.currentParentId)) return;
          event.preventDefault();
          event.stopPropagation();
          el.classList.add('drop-over');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
        el.addEventListener('drop', (event) => {
          if (this.currentDragField?.name !== field.name || !this.canAddField(field, this.currentParentId)) return;
          event.preventDefault();
          event.stopPropagation();
          el.classList.remove('drop-over');
          const rect = this.canvasWrapper.getBoundingClientRect();
          this.createNodeFromUserAction(field, this.currentParentId,
            (event.clientX - rect.left - this.panX) / this.zoom,
            (event.clientY - rect.top - this.panY) / this.zoom);
        });
        el.addEventListener('dblclick', (event) => {
          if (group.ignoreClickUntil && Date.now() < group.ignoreClickUntil) return;
          if (event.target.closest('.graph-node')) return;
          if (!this.canAddField(field, this.currentParentId)) return;
          if (this.currentParentId === null) this.createNodeFromUserAction(field, null);
          else this.addChildNodeViaClick(field, this.currentParentId);
        });
      }
      this.layoutInitialGroupNodes(group);
      this.resizeGroupToChildren(group);
    });
    // Arrange the visible canvas, but do not constrain any subsequent drag.
    this.repelGroupsFromGlobal();
    const globalNode = this.nodes.get('global');
    if (globalNode) this.repelFreeNode(globalNode);
    this.updateCapacityUI();
  }

  getGroupForNode(node) {
    return this.groups.get(this.getGroupKey(node.parentId, node.field.name));
  }

  // Imported form data used to keep the generic grid coordinates, which could
  // put a node outside the collection frame on first opening. Lay those nodes
  // out once when their frame becomes visible; manual positions are preserved.
  layoutInitialGroupNodes(group) {
    const nodes = [...this.nodes.values()].filter(node =>
      node.parentId === group.parentId && node.field.name === group.field.name && !node.groupPositioned && node.el
    );
    if (nodes.length === 0) return;

    let y = (parseFloat(group.el.style.top) || 0) + 60;
    const x = (parseFloat(group.el.style.left) || 0) + 24;
    nodes.forEach(node => {
      const nodeHeight = node.el.offsetHeight || 160;
      const requiredHeight = y + nodeHeight + 24 - (parseFloat(group.el.style.top) || 0);
      if (requiredHeight > group.el.offsetHeight) group.el.style.height = `${requiredHeight}px`;
      const position = this.placeNodeInGroup(node, x, y);
      node.el.style.left = `${position.x}px`;
      node.el.style.top = `${position.y}px`;
      node.groupPositioned = true;
      y += nodeHeight + 20;
    });
  }

  makeGroupDraggable(group) {
    const handle = group.el.querySelector('.graph-group-title');
    if (!handle) return;

    interact(handle).draggable({
      listeners: {
        start: () => {
          group.el.classList.add('is-moving');
        },
        move: (event) => {
          const dx = event.dx / this.zoom;
          const dy = event.dy / this.zoom;
          const left = (parseFloat(group.el.style.left) || 0) + dx;
          const top = (parseFloat(group.el.style.top) || 0) + dy;
          const actualDx = left - (parseFloat(group.el.style.left) || 0);
          const actualDy = top - (parseFloat(group.el.style.top) || 0);

          group.el.style.left = `${left}px`;
          group.el.style.top = `${top}px`;
          [...this.nodes.values()]
            .filter(node => node.parentId === group.parentId && node.field.name === group.field.name)
            .forEach(node => {
              node.el.style.left = `${(parseFloat(node.el.style.left) || 0) + actualDx}px`;
              node.el.style.top = `${(parseFloat(node.el.style.top) || 0) + actualDy}px`;
            });
          this.updateAllConnections();
        },
        end: () => {
          group.el.classList.remove('is-moving');
          this.repelGroupsFrom(group);
          this.repelGlobalFrom(group);
          this.repelFreeNodesFromGroup(group);
          this.updateAllConnections();
          // Avoid treating the mouseup click as an "add" click on the frame.
          group.ignoreClickUntil = Date.now() + 250;
        },
      },
    });
  }

  getElementRect(el) {
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
  }

  getOverlap(a, b) {
    const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  repelNodesFrom(node) {
    const group = this.getGroupForNode(node);
    if (!node.el) return;
    if (!group) {
      this.repelFreeNode(node);
      return;
    }
    const queue = [node];
    let processed = 0;
    while (queue.length && processed++ < 24) {
      const sourceNode = queue.shift();
      const source = this.getElementRect(sourceNode.el);
      const siblings = [...this.nodes.values()].filter(other =>
        other.id !== sourceNode.id && other.parentId === node.parentId && other.field.name === node.field.name && other.el
      );
      siblings.forEach(other => {
        const target = this.getElementRect(other.el);
        const overlap = this.getOverlap(source, target);
        if (!overlap) return;
        const sourceCenterX = source.left + source.width / 2;
        const sourceCenterY = source.top + source.height / 2;
        const targetCenterX = target.left + target.width / 2;
        let x = target.left;
        let y = target.top;
        const gap = 18;
        if (overlap.width < overlap.height) x += (targetCenterX >= sourceCenterX ? 1 : -1) * (overlap.width + gap);
        else y += ((target.top + target.height / 2 >= sourceCenterY) ? 1 : -1) * (overlap.height + gap);

        const groupRect = this.getElementRect(group.el);
        if (x + target.width + 16 > groupRect.right) group.el.style.width = `${x + target.width + 40 - groupRect.left}px`;
        if (y + target.height + 16 > groupRect.bottom) group.el.style.height = `${y + target.height + 40 - groupRect.top}px`;
        const placement = this.placeNodeInGroup(other, x, y);
        other.el.style.left = `${placement.x}px`;
        other.el.style.top = `${placement.y}px`;
        queue.push(other);
      });
    }
    this.resizeGroupToChildren(group);
  }

  translateFreeNode(node, dx, dy) {
    if (!node?.el) return;
    this.moveForCollision(
      node.el,
      (parseFloat(node.el.style.left) || 0) + dx,
      (parseFloat(node.el.style.top) || 0) + dy,
    );
  }

  moveForCollision(el, left, top) {
    if (!el) return;
    el.classList.add('is-collision-moving');
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    clearTimeout(el.collisionMoveTimer);
    el.collisionMoveTimer = setTimeout(() => el.classList.remove('is-collision-moving'), 220);
  }

  repelFreeNode(node) {
    if (!node?.el) return;
    const source = this.getElementRect(node.el);
    // Fixed objects (and the global block) are free canvas nodes. They repel
    // each other, then push a group as a whole if they meet one.
    [...this.nodes.values()].filter(other => other.id !== node.id && !this.getGroupForNode(other) && other.el).forEach(other => {
      const target = this.getElementRect(other.el);
      const overlap = this.getOverlap(source, target);
      if (!overlap) return;
      const gap = 18;
      if (overlap.width < overlap.height) {
        const direction = (target.left + target.width / 2) >= (source.left + source.width / 2) ? 1 : -1;
        this.translateFreeNode(other, direction * (overlap.width + gap), 0);
      } else {
        const direction = (target.top + target.height / 2) >= (source.top + source.height / 2) ? 1 : -1;
        this.translateFreeNode(other, 0, direction * (overlap.height + gap));
      }
    });

    this.getVisibleGroups().forEach(group => {
      const target = this.getElementRect(group.el);
      const overlap = this.getOverlap(source, target);
      if (!overlap) return;
      const gap = 32;
      if (overlap.width < overlap.height) {
        const direction = (target.left + target.width / 2) >= (source.left + source.width / 2) ? 1 : -1;
        this.translateGroup(group, direction * (overlap.width + gap), 0);
      } else {
        const direction = (target.top + target.height / 2) >= (source.top + source.height / 2) ? 1 : -1;
        this.translateGroup(group, 0, direction * (overlap.height + gap));
      }
      this.repelGroupsFrom(group);
    });
  }

  repelFreeNodesFromGroup(group) {
    const source = this.getElementRect(group.el);
    [...this.nodes.values()].filter(node => node.id !== 'global' && !this.getGroupForNode(node) && node.el).forEach(node => {
      const target = this.getElementRect(node.el);
      const overlap = this.getOverlap(source, target);
      if (!overlap) return;
      const gap = 18;
      if (overlap.width < overlap.height) {
        const direction = (target.left + target.width / 2) >= (source.left + source.width / 2) ? 1 : -1;
        this.translateFreeNode(node, direction * (overlap.width + gap), 0);
      } else {
        const direction = (target.top + target.height / 2) >= (source.top + source.height / 2) ? 1 : -1;
        this.translateFreeNode(node, 0, direction * (overlap.height + gap));
      }
    });
  }

  translateGroup(group, dx, dy) {
    const left = (parseFloat(group.el.style.left) || 0) + dx;
    const top = (parseFloat(group.el.style.top) || 0) + dy;
    const actualDx = left - (parseFloat(group.el.style.left) || 0);
    const actualDy = top - (parseFloat(group.el.style.top) || 0);
    this.moveForCollision(group.el, left, top);
    [...this.nodes.values()]
      .filter(node => node.parentId === group.parentId && node.field.name === group.field.name && node.el)
      .forEach(node => {
        this.moveForCollision(
          node.el,
          (parseFloat(node.el.style.left) || 0) + actualDx,
          (parseFloat(node.el.style.top) || 0) + actualDy,
        );
      });
  }

  repelGroupsFrom(group) {
    // Process the collision chain: if A pushes B into C, B is processed next.
    // The safety cap prevents pathological layouts from making a drag sluggish.
    const queue = [group];
    let processed = 0;
    while (queue.length && processed++ < 24) {
      const sourceGroup = queue.shift();
      const source = this.getElementRect(sourceGroup.el);
      this.getVisibleGroups().filter(other => other !== sourceGroup).forEach(other => {
        const target = this.getElementRect(other.el);
        const overlap = this.getOverlap(source, target);
        if (!overlap) return;
        const gap = 32;
        if (overlap.width < overlap.height) {
          const direction = (target.left + target.width / 2) >= (source.left + source.width / 2) ? 1 : -1;
          this.translateGroup(other, direction * (overlap.width + gap), 0);
        } else {
          const direction = (target.top + target.height / 2) >= (source.top + source.height / 2) ? 1 : -1;
          this.translateGroup(other, 0, direction * (overlap.height + gap));
        }
        queue.push(other);
      });
    }
  }

  repelGroupsFromGlobal(excludeGroup = null) {
    const globalNode = this.nodes.get('global');
    if (!globalNode?.el) return;

    // The global configuration is not part of a collection, but it should
    // reserve its own space just like a group does.
    for (let pass = 0; pass < 2; pass++) {
      const globalRect = this.getElementRect(globalNode.el);
      this.getVisibleGroups().filter(group => group !== excludeGroup).forEach(group => {
        const groupRect = this.getElementRect(group.el);
        const overlap = this.getOverlap(globalRect, groupRect);
        if (!overlap) return;
        const gap = 32;
        if (overlap.width < overlap.height) {
          const direction = (groupRect.left + groupRect.width / 2) >= (globalRect.left + globalRect.width / 2) ? 1 : -1;
          this.translateGroup(group, direction * (overlap.width + gap), 0);
        } else {
          const direction = (groupRect.top + groupRect.height / 2) >= (globalRect.top + globalRect.height / 2) ? 1 : -1;
          this.translateGroup(group, 0, direction * (overlap.height + gap));
        }
        this.repelGroupsFrom(group);
      });
    }
  }

  repelGlobalFrom(group) {
    const globalNode = this.nodes.get('global');
    if (!globalNode?.el) return;
    const source = this.getElementRect(group.el);
    const target = this.getElementRect(globalNode.el);
    const overlap = this.getOverlap(source, target);
    if (!overlap) return;

    const gap = 32;
    let x = target.left;
    let y = target.top;
    if (overlap.width < overlap.height) {
      x += (target.left + target.width / 2 >= source.left + source.width / 2 ? 1 : -1) * (overlap.width + gap);
    } else {
      y += (target.top + target.height / 2 >= source.top + source.height / 2 ? 1 : -1) * (overlap.height + gap);
    }
    this.moveForCollision(globalNode.el, x, y);
    // Moving the global node can meet a third group; keep propagating the push.
    this.repelGroupsFromGlobal(group);
  }

  placeNodeInGroup(node, x, y) {
    const group = this.getGroupForNode(node);
    if (!group) return { x, y };
    const left = parseFloat(group.el.style.left);
    const top = parseFloat(group.el.style.top);
    const width = group.el.offsetWidth || 420;
    const height = group.el.offsetHeight || 500;
    const nodeWidth = node.el?.offsetWidth || 220;
    const nodeHeight = node.el?.offsetHeight || 160;
    const fallbackIndex = [...this.nodes.values()].filter(n => n.parentId === node.parentId && n.field.name === node.field.name).indexOf(node);
    const desiredX = x ?? left + 24 + (fallbackIndex % 2) * 190;
    const desiredY = y ?? top + 64 + Math.floor(fallbackIndex / 2) * 190;
    return {
      x: Math.max(left + 16, Math.min(desiredX, left + width - nodeWidth - 16)),
      y: Math.max(top + 50, Math.min(desiredY, top + height - nodeHeight - 16)),
    };
  }

  resizeGroupToChildren(group) {
    const left = parseFloat(group.el.style.left) || 0;
    const top = parseFloat(group.el.style.top) || 0;
    let width = 420;
    let height = 500;
    [...this.nodes.values()].filter(node => node.parentId === group.parentId && node.field.name === group.field.name).forEach(node => {
      if (!node.el) return;
      const right = (parseFloat(node.el.style.left) || 0) + (node.el.offsetWidth || 220) + 24 - left;
      const bottom = (parseFloat(node.el.style.top) || 0) + (node.el.offsetHeight || 160) + 24 - top;
      width = Math.max(width, right);
      height = Math.max(height, bottom);
    });
    group.el.style.width = `${width}px`;
    group.el.style.height = `${height}px`;
  }

  getStandalonePosition(parentId) {
    const contextGroups = [...this.groups.values()].filter(group => group.parentId === parentId);
    const rightmostGroup = contextGroups.reduce((right, group) => {
      const left = parseFloat(group.el.style.left) || 0;
      return Math.max(right, left + (group.el.offsetWidth || 420));
    }, 0);
    const standaloneCount = [...this.nodes.values()].filter(node =>
      node.parentId === parentId && !isCollectionField(node.field)
    ).length;

    // Keep fixed objects beside collection frames when they are created from
    // the palette, instead of dropping them at the origin on top of a frame.
    return {
      x: Math.max(340, rightmostGroup + 60),
      y: 70 + standaloneCount * 240,
    };
  }

  // Resolve only the layout produced when the graph is first built from form
  // data. This deliberately does not run after a drag: nodes remain free to
  // cross one another once the user starts arranging the canvas.
  arrangeInitialLayout() {
    this.repelGroupsFromGlobal();

    const placedStandaloneNodes = [];
    const obstacles = () => [
      this.nodes.get('global'),
      ...this.getVisibleGroups(),
      ...placedStandaloneNodes,
    ].filter(Boolean);

    [...this.nodes.values()]
      .filter(node => node.id !== 'global' && node.parentId === this.currentParentId && !this.getGroupForNode(node) && node.el)
      .forEach(node => {
        for (let pass = 0; pass < 24; pass++) {
          const source = this.getElementRect(node.el);
          const obstacle = obstacles().find(candidate => {
            const target = this.getElementRect(candidate.el);
            return this.getOverlap(source, target);
          });
          if (!obstacle) break;

          const target = this.getElementRect(obstacle.el);
          const overlap = this.getOverlap(source, target);
          const gap = 24;
          if (overlap.width < overlap.height) {
            const direction = (source.left + source.width / 2) >= (target.left + target.width / 2) ? 1 : -1;
            this.translateFreeNode(node, direction * (overlap.width + gap), 0);
          } else {
            const direction = (source.top + source.height / 2) >= (target.top + target.height / 2) ? 1 : -1;
            this.translateFreeNode(node, 0, direction * (overlap.height + gap));
          }
        }
        placedStandaloneNodes.push(node);
      });
  }

  /** Place a group's cards on the most compact grid whose frame is closest to square. */
  layoutGroupNodesCompactly(group) {
    const nodes = [...this.nodes.values()].filter(node =>
      node.parentId === group.parentId && node.field.name === group.field.name && node.el
    );
    if (nodes.length === 0) return;

    const horizontalPadding = 24;
    const topPadding = 60;
    const bottomPadding = 24;
    const gap = 20;
    const cards = nodes.map(node => ({
      node,
      width: node.el.offsetWidth || 220,
      height: node.el.offsetHeight || 160,
    }));

    let bestLayout = null;
    for (let columnCount = 1; columnCount <= cards.length; columnCount++) {
      const rowCount = Math.ceil(cards.length / columnCount);
      const columnWidths = Array(columnCount).fill(0);
      const rowHeights = Array(rowCount).fill(0);
      cards.forEach((card, index) => {
        const column = index % columnCount;
        const row = Math.floor(index / columnCount);
        columnWidths[column] = Math.max(columnWidths[column], card.width);
        rowHeights[row] = Math.max(rowHeights[row], card.height);
      });

      const width = Math.max(420, horizontalPadding * 2 + columnWidths.reduce((sum, value) => sum + value, 0) + gap * (columnCount - 1));
      const height = Math.max(500, topPadding + bottomPadding + rowHeights.reduce((sum, value) => sum + value, 0) + gap * (rowCount - 1));
      const score = Math.abs(width - height);
      if (!bestLayout || score < bestLayout.score || (score === bestLayout.score && width * height < bestLayout.width * bestLayout.height)) {
        bestLayout = { columnCount, columnWidths, rowHeights, width, height, score };
      }
    }

    const left = parseFloat(group.el.style.left) || 0;
    const top = parseFloat(group.el.style.top) || 0;
    const columnX = [];
    let x = left + horizontalPadding;
    bestLayout.columnWidths.forEach(width => {
      columnX.push(x);
      x += width + gap;
    });
    const rowY = [];
    let y = top + topPadding;
    bestLayout.rowHeights.forEach(height => {
      rowY.push(y);
      y += height + gap;
    });

    cards.forEach((card, index) => {
      card.node.el.style.left = `${columnX[index % bestLayout.columnCount]}px`;
      card.node.el.style.top = `${rowY[Math.floor(index / bestLayout.columnCount)]}px`;
      card.node.groupPositioned = true;
    });
    group.el.style.width = `${bestLayout.width}px`;
    group.el.style.height = `${bestLayout.height}px`;
  }

  /** Reflow the visible graph into a readable, non-overlapping layout. */
  arrangeGraph() {
    const globalNode = this.nodes.get('global');
    const globalLeft = parseFloat(globalNode?.el?.style.left) || 40;
    const globalWidth = globalNode?.el?.offsetWidth || 240;
    let cursorX = globalLeft + globalWidth + 60;
    const top = 70;

    this.getVisibleGroups().forEach(group => {
      group.el.style.left = `${cursorX}px`;
      group.el.style.top = `${top}px`;
      this.layoutGroupNodesCompactly(group);
      cursorX += (group.el.offsetWidth || 420) + 40;
    });

    let standaloneY = top;
    [...this.nodes.values()]
      .filter(node => node.id !== 'global' && node.parentId === this.currentParentId && !this.getGroupForNode(node) && node.el)
      .forEach(node => {
        node.el.style.left = `${cursorX}px`;
        node.el.style.top = `${standaloneY}px`;
        standaloneY += (node.el.offsetHeight || 160) + 28;
      });

    this.repelGroupsFromGlobal();
    [...this.nodes.values()]
      .filter(node => node.id !== 'global' && node.parentId === this.currentParentId && !this.getGroupForNode(node))
      .forEach(node => this.repelFreeNode(node));
    this.updateAllConnections();
    this.fitView();
  }

  /** DOM dimensions settle after insertion; then resolve every resulting collision. */
  resolveCollisionsAfterInsert(node) {
    requestAnimationFrame(() => {
      if (!node?.el || !this.nodes.has(node.id)) return;
      const group = this.getGroupForNode(node);
      if (group) {
        this.resizeGroupToChildren(group);
        this.repelNodesFrom(node);
        this.repelGroupsFrom(group);
        this.repelFreeNodesFromGroup(group);
      } else {
        this.repelFreeNode(node);
      }
      this.repelGroupsFromGlobal();
      this.updateAllConnections();
    });
  }

  createRootNode(field, x, y, customInstanceKey = null) {
    // For fixed-key objects, only one instance allowed
    if (field.type === 'object' && !field.dynamicKeys) {
      const existing = [...this.nodes.values()].find(n => n.field.name === field.name && !n.parentId);
      if (existing) {
        // Flash existing node
        existing.el.style.animation = 'none';
        existing.el.offsetHeight; // reflow
        existing.el.style.animation = 'nodeAppear 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
        this.scrollToNode(existing.id);
        return;
      }
    }

    if (!isCollectionField(field) && (x === null || y === null)) {
      ({ x, y } = this.getStandalonePosition(null));
    }

    const instanceKey = customInstanceKey || this.generateInstanceKey(field, null);
    const defaultValues = this.buildDefaultValues(field);
    const nodeId = generateId();

    const node = {
      id: nodeId,
      field,
      instanceKey,
      values: defaultValues,
      parentId: null,
      childIds: new Set(),
      el: null,
    };

    this.nodes.set(nodeId, node);

    const el = this.createNodeEl(node, x, y);
    node.el = el;
    this.canvas.appendChild(el);
    const position = this.placeNodeInGroup(node, x, y);
    el.style.left = `${Math.round(position.x)}px`;
    el.style.top = `${Math.round(position.y)}px`;
    node.groupPositioned = true;
    const group = this.getGroupForNode(node);
    if (group) this.resizeGroupToChildren(group);

    // Auto-create default children
    this.createDefaultChildren(nodeId, field, defaultValues, x, y);
    this.resolveCollisionsAfterInsert(node);

    this.updateEmptyState();
    this.updatePaletteCounts();
    this.triggerOutputUpdate();

    return nodeId;
  }

  createChildNode(field, parentId, initialValues = null, customInstanceKey = null, x = null, y = null) {
    const parentNode = this.nodes.get(parentId);
    if (!parentNode) return null;

    const instanceKey = customInstanceKey || this.generateInstanceKey(field, parentId);
    const defaultValues = initialValues || this.buildDefaultValues(field);
    const nodeId = generateId();

    let childX = x;
    let childY = y;
    if (childX === null || childY === null) {
      if (isCollectionField(field)) {
        const childCount = parentNode.childIds.size;
        childX = 300;
        childY = 40 + (childCount * 180);
      } else {
        ({ x: childX, y: childY } = this.getStandalonePosition(parentId));
      }
    }

    const node = {
      id: nodeId,
      field,
      instanceKey,
      values: defaultValues,
      parentId,
      childIds: new Set(),
      el: null,
      imported: true,
      groupPositioned: false,
    };

    this.nodes.set(nodeId, node);
    parentNode.childIds.add(nodeId);

    const el = this.createNodeEl(node, childX, childY);
    node.el = el;
    this.canvas.appendChild(el);
    const position = this.placeNodeInGroup(node, childX, childY);
    el.style.left = `${Math.round(position.x)}px`;
    el.style.top = `${Math.round(position.y)}px`;
    node.groupPositioned = true;
    const group = this.getGroupForNode(node);
    if (group) this.resizeGroupToChildren(group);

    // Add chip to parent dropzone
    this.refreshParentDropzone(parentId, field);

    this.resolveCollisionsAfterInsert(node);

    this.updateAllConnections();
    this.updateEmptyState();
    this.updateCapacityUI();
    this.triggerOutputUpdate();

    return nodeId;
  }

  generateUniqueChildKey(childField, parentId) {
    const prefix = childField.name === 'add_volumes' ? 'disk' : (childField.name === 'vgs' ? 'vg' : childField.name);
    let index = 1;
    while (true) {
      const candidate = `${prefix}${index}`;
      const exists = [...this.nodes.values()].some(n => 
        n.parentId === parentId && 
        n.field.name === childField.name && 
        n.instanceKey === candidate
      );
      if (!exists) {
        return candidate;
      }
      index++;
    }
  }

  addChildNodeViaClick(childField, parentId) {
    if (!this.canAddField(childField, parentId)) return;
    if (childField.dynamicKeys) {
      this.createNodeFromUserAction(childField, parentId);
      return;
    }

    let customKey = null;
    if (childField.type === 'object') {
      // Check if already exists
      const exists = [...this.nodes.values()].find(n => 
        n.parentId === parentId && 
        n.field.name === childField.name
      );
      if (exists) {
        exists.el.style.animation = 'none';
        exists.el.offsetHeight; // reflow
        exists.el.style.animation = 'nodeAppear 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
        this.scrollToNode(exists.id);
        return;
      }
      customKey = childField.name;
    }

    const nodeId = this.createChildNode(childField, parentId, null, customKey);
    // Collection items are added from within the parent card, so keep the
    // current view stable. A fixed child object remains a navigable block.
    if (nodeId && !isCollectionField(childField)) {
      this.scrollToNode(nodeId);
    }
  }

  createNodeFromUserAction(field, parentId, x = null, y = null, shouldScroll = parentId === null || !isCollectionField(field)) {
    if (!this.canAddField(field, parentId)) return null;
    const create = (instanceKey = null) => {
      let nodeId;
      if (parentId === null) nodeId = this.createRootNode(field, x, y, instanceKey);
      else nodeId = this.createChildNode(field, parentId, null, instanceKey, x, y);
      if (nodeId && shouldScroll) {
        this.scrollToNode(nodeId);
      }
      if (nodeId) {
        this.selectNode(nodeId);
      }
      return nodeId;
    };

    if (!field.dynamicKeys) return create();

    const suggestedKey = this.generateUniqueChildKey(field, parentId);
    this.requestDynamicName(field, parentId, suggestedKey, create);
  }

  canDuplicateNode(node) {
    return isCollectionField(node.field) && this.canAddField(node.field, node.parentId);
  }

  getUniqueDuplicateKey(node) {
    const base = `${node.instanceKey || node.field.name}_copy`;
    let candidate = base;
    let index = 2;
    while ([...this.nodes.values()].some(sibling =>
      sibling.parentId === node.parentId && sibling.field.name === node.field.name && sibling.instanceKey === candidate
    )) {
      candidate = `${base}_${index++}`;
    }
    return candidate;
  }

  duplicateNode(nodeId) {
    const source = this.nodes.get(nodeId);
    if (!source || !this.canDuplicateNode(source)) return;

    const duplicate = (instanceKey) => {
      const node = this.cloneNodeTree(source, source.parentId, instanceKey);
      this.finishDuplicate(node);
    };
    if (source.field.type === 'object' && source.field.dynamicKeys) {
      this.requestDynamicName(source.field, source.parentId, this.getUniqueDuplicateKey(source), duplicate);
      return;
    }

    duplicate(this.getArrayItemInstanceKey(source.field, source.parentId));
  }

  cloneNodeTree(source, parentId, instanceKey) {
    const sourceX = parseFloat(source.el?.style.left) || 60;
    const sourceY = parseFloat(source.el?.style.top) || 70;
    const copiedValues = typeof structuredClone === 'function'
      ? structuredClone(source.values)
      : JSON.parse(JSON.stringify(source.values));
    const node = {
      id: generateId(),
      field: source.field,
      instanceKey,
      values: copiedValues,
      parentId,
      childIds: new Set(),
      el: null,
    };

    this.nodes.set(node.id, node);
    if (parentId) this.nodes.get(parentId)?.childIds.add(node.id);

    const el = this.createNodeEl(node, sourceX + 28, sourceY + 28);
    node.el = el;
    this.canvas.appendChild(el);
    const position = this.placeNodeInGroup(node, sourceX + 28, sourceY + 28);
    el.style.left = `${Math.round(position.x)}px`;
    el.style.top = `${Math.round(position.y)}px`;
    node.groupPositioned = true;

    [...source.childIds]
      .map(childId => this.nodes.get(childId))
      .filter(Boolean)
      .forEach(child => this.cloneNodeTree(child, node.id, child.instanceKey));

    this.refreshNodeEl(node.id);
    return node;
  }

  finishDuplicate(node) {
    if (node.parentId) this.refreshNodeEl(node.parentId);
    const group = this.getGroupForNode(node);
    if (group) this.resizeGroupToChildren(group);
    this.repelNodesFrom(node);
    this.updateAllConnections();
    this.updateEmptyState();
    this.updatePaletteCounts();
    this.updateCapacityUI();
    this.triggerOutputUpdate();
    this.scrollToNode(node.id);
    this.selectNode(node.id);
  }

  createDefaultChildren(parentId, field, values, parentX, parentY) {
    // Only for arrays with itemType=object that have default values
    if (field.type !== 'object' || !field.fields) return;

    field.fields.forEach(subField => {
      if (!isComplexField(subField)) return;

      if (subField.type === 'array' && subField.itemType === 'object') {
        const defaultArr = values[subField.name];
        if (Array.isArray(defaultArr) && defaultArr.length > 0) {
          defaultArr.forEach((itemVal, i) => {
            const childId = generateId();
            const childX = parentX + 280;
            const childY = parentY + i * 180;
            const childNode = {
              id: childId,
              field: subField,
              instanceKey: `${subField.name}${i + 1}`,
              values: itemVal || {},
              parentId,
              childIds: new Set(),
              el: null,
            };
            this.nodes.set(childId, childNode);
            const parentNode = this.nodes.get(parentId);
            if (parentNode) parentNode.childIds.add(childId);
            const el = this.createNodeEl(childNode, childX, childY);
            childNode.el = el;
            this.canvas.appendChild(el);
          });
        }
      } else if (subField.type === 'object' && subField.dynamicKeys) {
        const defaultObj = values[subField.name];
        if (defaultObj && typeof defaultObj === 'object') {
          let i = 0;
          Object.entries(defaultObj).forEach(([key, val]) => {
            const childId = generateId();
            const childX = parentX + 280;
            const childY = parentY + i * 180;
            const childNode = {
              id: childId,
              field: subField,
              instanceKey: key,
              values: val || {},
              parentId,
              childIds: new Set(),
              el: null,
            };
            this.nodes.set(childId, childNode);
            const parentNode = this.nodes.get(parentId);
            if (parentNode) parentNode.childIds.add(childId);
            const el = this.createNodeEl(childNode, childX, childY);
            childNode.el = el;
            this.canvas.appendChild(el);
            i++;
          });
        }
      } else if (subField.type === 'object') {
        const defaultObj = values[subField.name];
        if (defaultObj && typeof defaultObj === 'object') {
          const childId = generateId();
          const childX = parentX + 280;
          const childY = parentY;
          const childNode = {
            id: childId,
            field: subField,
            instanceKey: subField.name,
            values: defaultObj || {},
            parentId,
            childIds: new Set(),
            el: null,
          };
          this.nodes.set(childId, childNode);
          const parentNode = this.nodes.get(parentId);
          if (parentNode) parentNode.childIds.add(childId);
          const el = this.createNodeEl(childNode, childX, childY);
          childNode.el = el;
          this.canvas.appendChild(el);
        }
      }
    });

    setTimeout(() => {
      this.updateAllConnections();
      const parentNode = this.nodes.get(parentId);
      if (parentNode) {
        field.fields.forEach(subField => {
          if (isComplexField(subField)) {
            this.refreshParentDropzone(parentId, subField);
          }
        });
      }
    }, 50);
  }

  createNodeEl(node, x, y) {
    const { field, instanceKey, values } = node;
    const isGlobal = node.id === 'global';

    const el = document.createElement('div');
    el.className = `graph-node${isGlobal ? ' is-global' : ''}${Array.isArray(field.fields) ? ' has-navigation' : ''}`;
    el.dataset.nodeId = node.id;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    
    // Set visibility display
    el.style.display = isGlobal || (node.parentId === this.currentParentId) ? 'block' : 'none';

    // Color accent based on type
    const typeKey = field.dynamicKeys ? 'objectDynamic' : field.type === 'array' ? 'array' : (isGlobal ? 'global' : 'object');
    el.style.setProperty('--node-accent', TYPE_COLORS[typeKey] || TYPE_COLORS.object);

    node.el = el;
    el.innerHTML = this.buildNodeHTML(node);
    this.bindInlineNodeFields(node);

    el.addEventListener('click', (e) => {
      this.selectNode(node.id);
    });
    el.addEventListener('focusin', () => {
      this.selectNode(node.id);
    });

    // ── Drag to reposition with interact.js ──
    interact(el).draggable({
      listeners: {
        move: (event) => {
          let x = (parseFloat(el.style.left) || 0) + event.dx / this.zoom;
          let y = (parseFloat(el.style.top) || 0) + event.dy / this.zoom;
          const group = this.getGroupForNode(node);
          if (group) {
            const left = parseFloat(group.el.style.left) || 0;
            const top = parseFloat(group.el.style.top) || 0;
            const nodeWidth = el.offsetWidth || 220;
            const nodeHeight = el.offsetHeight || 160;
            // Grow before clamping, so a collection never becomes a dead end.
            if (x + nodeWidth + 32 > left + group.el.offsetWidth) group.el.style.width = `${x + nodeWidth + 56 - left}px`;
            if (y + nodeHeight + 32 > top + group.el.offsetHeight) group.el.style.height = `${y + nodeHeight + 56 - top}px`;
            x = Math.max(left + 16, x);
            y = Math.max(top + 50, y);
          }
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
          this.updateAllConnections();
        },
        start: () => {
          this.selectNode(node.id);
        },
        end: () => {
          if (this.selectedNodeId !== node.id && el) {
            el.style.zIndex = '';
          }
          this.repelNodesFrom(node);
          // Moving a member can enlarge its collection frame.  Once that
          // frame has been resized, resolve its new footprint against the
          // objects that live outside the collection as well.
          const group = this.getGroupForNode(node);
          if (group) {
            this.repelGroupsFrom(group);
            this.repelGlobalFrom(group);
            this.repelFreeNodesFromGroup(group);
          }
          this.updateAllConnections();
        },
      },
      // Labels and the card background are draggable; actual controls stay interactive.
      allowFrom: '.graph-node-header, .graph-node-body',
      ignoreFrom: 'input, select, textarea, button, label, .graph-child-chip, .graph-node-sub-section',
    });

    // ── Wire up edit button ──
    const editBtn = el.querySelector('.btn-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDrawer(node.id);
      });
    }

    const renameBtn = el.querySelector('.btn-rename-node');
    if (renameBtn) {
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.requestNodeRename(node.id);
      });
    }

    // ── Wire up delete button ──
    const deleteBtn = el.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.confirmNodeRemoval(node.id);
      });
    }

    const duplicateBtn = el.querySelector('.btn-duplicate-node');
    if (duplicateBtn) {
      duplicateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.duplicateNode(node.id);
      });
    }

    const enterBtn = el.querySelector('.btn-enter-node');
    if (enterBtn) enterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.enterNode(node.id);
    });

    // Double-clicking a blue node header navigates into it. Inline fields
    // remain editable directly on the card, so it no longer opens the drawer.
    const nodeHeader = el.querySelector('.graph-node-header');
    if (nodeHeader && Array.isArray(field.fields)) {
      nodeHeader.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        e.stopPropagation();
        this.enterNode(node.id);
      });
    }

    // ── Wire up child chip clicks ──
    el.addEventListener('click', (e) => {
      const enterChild = e.target.closest('.btn-enter-child');
      if (enterChild) {
        e.stopPropagation();
        const childId = enterChild.dataset.childId;
        if (childId) this.enterNode(childId);
        return;
      }

      const chipRemove = e.target.closest('.graph-child-chip-remove, .btn-delete-child');
      if (chipRemove) {
        e.stopPropagation();
        const childId = chipRemove.dataset.childId;
        if (childId) this.confirmNodeRemoval(childId);
        return;
      }

      const chip = e.target.closest('.graph-child-chip');
      if (chip) {
        const childId = chip.dataset.childId;
        if (childId) this.openDrawer(childId);
      }
    });

    // ── Wire up drop zone for child objects ──
    const dropzones = el.querySelectorAll('.graph-node-dropzone');
    dropzones.forEach(dz => {
      const acceptedFieldName = dz.dataset.accepts;
      const childField = field.fields && field.fields.find(f => f.name === acceptedFieldName);
      if (!childField) return;

      dz.addEventListener('dragover', (e) => {
        if (this.currentDragField && this.currentDragField.name === acceptedFieldName && this.canAddField(childField, node.id)) {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.add('drop-over');
          dz.classList.remove('drop-invalid');
        } else if (this.currentDragField) {
          dz.classList.add('drop-invalid');
        }
      });

      dz.addEventListener('dragleave', () => {
        dz.classList.remove('drop-over', 'drop-invalid');
      });

      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('drop-over', 'drop-invalid');
        if (this.currentDragField && this.currentDragField.name === acceptedFieldName && this.canAddField(childField, node.id)) {
          this.createNodeFromUserAction(childField, node.id);
        }
      });

      dz.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.addChildNodeViaClick(childField, node.id);
      });
    });

    return el;
  }

  buildNodeHTML(node) {
    const { field, instanceKey, values } = node;
    const isGlobal = node.id === 'global';
    const previewRows = buildPreviewRows(field, values);
    const simpleFields = (field.fields || []).filter(subField => !isComplexField(subField));
    // Show every complex child on its parent's card. Fixed objects used to be
    // hidden here because only collections were retained, which made nested
    // disks invisible until opening their template.
    const complexSubs = getComplexSubFields(field);

    const previewHTML = simpleFields.length > 0
      ? this.buildGlobalFieldsHTML(simpleFields, values, node)
      : previewRows.length > 0
      ? `<div class="graph-node-section-label">Propriétés</div>${previewRows.map(r => `
          <div class="preview-row${r.missing ? ' is-missing-required' : ''}">
            <span class="preview-key">${r.key}:</span>
            <span class="preview-val">${r.val}</span>
          </div>`).join('')}`
      : `<span class="preview-empty">Aucune propriété — double-cliquez pour configurer</span>`;

    let complexSubsHTML = '';
    if (complexSubs.length > 0) {
      complexSubsHTML = complexSubs.map(subField => {
        const children = [...node.childIds]
          .map(id => this.nodes.get(id))
          .filter(n => n && n.field.name === subField.name);
        const isCollection = isCollectionField(subField);
        const isFull = isCollection && !this.canAddField(subField, node.id);

        const chipsHTML = children.map(child => `
          <div class="graph-child-chip" data-child-id="${child.id}" title="Cliquer ou double-cliquer pour configurer">
            <span class="graph-child-chip-icon">${getFieldIcon(child.field)}</span>
            <span class="graph-child-chip-name">${child.instanceKey}</span>
            <div class="graph-child-chip-actions">
              <button class="graph-child-chip-btn btn-enter-child" data-child-id="${child.id}" title="Ouvrir">↗</button>
              <button class="graph-child-chip-btn btn-edit-child" data-child-id="${child.id}" title="Configurer">✏️</button>
              <button class="graph-child-chip-btn btn-delete-child" data-child-id="${child.id}" title="Supprimer">×</button>
            </div>
          </div>`).join('');

        return `
          <div class="graph-node-sub-section${isCollection ? '' : ' is-fixed-object'}">
            <div class="graph-node-sub-header">
              <span class="sub-header-title">${getFieldIcon(subField)} ${subField.label || subField.name}</span>
              <button class="btn-add-sub-child${isFull ? ' is-full' : ''}" data-parent-id="${node.id}" data-sub-field-name="${subField.name}" title="${isFull ? `Limite de ${getFieldMaxInstances(subField)} élément(s) atteinte` : 'Ajouter'}" ${isFull ? 'disabled' : ''}>+</button>
            </div>
            <div class="graph-node-sub-list">
              ${chipsHTML || `<span class="sub-list-empty">Aucun</span>`}
            </div>
            <div class="graph-node-dropzone${isFull ? ' is-full' : ''}" data-accepts="${subField.name}" title="${isFull ? `Limite de ${getFieldMaxInstances(subField)} élément(s) atteinte` : `Cliquer ou glisser un '${subField.label || subField.name}' ici`}">
              ${isFull ? 'Limite atteinte' : '+ Cliquer ici'}
            </div>
          </div>
        `;
      }).join('');
    }

    const canDuplicate = this.canDuplicateNode(node);
    const canEnter = Array.isArray(field.fields);
    const renameButton = field.type === 'object' && field.dynamicKeys ? `
          <button class="graph-node-btn btn-rename-node" data-node-id="${node.id}" title="Renommer la clé" aria-label="Renommer la clé ${escapeHtml(instanceKey)}">✎</button>` : '';
    const duplicateButton = isCollectionField(field) ? `
          <button class="graph-node-btn btn-duplicate-node${canDuplicate ? '' : ' is-full'}" data-node-id="${node.id}" title="${canDuplicate ? 'Dupliquer cet élément' : `Limite de ${getFieldMaxInstances(field)} élément(s) atteinte`}" ${canDuplicate ? '' : 'disabled'}>⧉</button>` : '';

    return `
      <div class="graph-node-header">
        <div class="graph-node-heading">
          <span class="graph-node-icon">${getFieldIcon(field)}</span>
          <div class="graph-node-title-group">
            <span class="graph-node-title">${field.label || field.name}</span>
            ${field.dynamicKeys || (field.type === 'array' && field.itemType === 'object') ? `
              <span class="graph-node-subtitle-name">${instanceKey}</span>
            ` : ''}
          </div>
        </div>
        <div class="graph-node-actions">
          ${renameButton}
          ${canEnter ? '<button class="graph-node-btn btn-enter-node" title="Ouvrir cet objet">↗ <span>Ouvrir</span></button>' : ''}
          ${duplicateButton}
          <button class="graph-node-btn btn-delete" title="Supprimer">×</button>
        </div>
      </div>
      <div class="graph-node-body">
        <div class="graph-node-preview">${previewHTML}</div>
        ${complexSubsHTML}
      </div>
    `;
  }

  refreshParentDropzone(parentId, childField) {
    const parentNode = this.nodes.get(parentId);
    if (!parentNode || !parentNode.el) return;
    parentNode.el.innerHTML = this.buildNodeHTML(parentNode);
    this.rewireNodeEvents(parentNode);
    this.updateAllConnections();
  }

  rewireNodeEvents(node) {
    const el = node.el;
    this.bindInlineNodeFields(node);
    const editBtn = el.querySelector('.btn-edit');
    if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openDrawer(node.id); });
    const renameBtn = el.querySelector('.btn-rename-node');
    if (renameBtn) renameBtn.addEventListener('click', (e) => { e.stopPropagation(); this.requestNodeRename(node.id); });
    const deleteBtn = el.querySelector('.btn-delete');
    if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.confirmNodeRemoval(node.id); });
    const duplicateBtn = el.querySelector('.btn-duplicate-node');
    if (duplicateBtn) duplicateBtn.addEventListener('click', (e) => { e.stopPropagation(); this.duplicateNode(node.id); });

    const enterBtn = el.querySelector('.btn-enter-node');
    if (enterBtn) enterBtn.addEventListener('click', (e) => { e.stopPropagation(); this.enterNode(node.id); });

    const nodeHeader = el.querySelector('.graph-node-header');
    if (nodeHeader && Array.isArray(node.field.fields)) {
      nodeHeader.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        e.stopPropagation();
        this.enterNode(node.id);
      });
    }

    // Child chips edit on click/double-click; navigation stays explicit.
    const chips = el.querySelectorAll('.graph-child-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        e.stopPropagation();
        const childId = chip.dataset.childId;
        if (childId) this.openDrawer(childId);
      });
      chip.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const childId = chip.dataset.childId;
        if (childId) this.openDrawer(childId);
      });
    });

    const enterChildBtns = el.querySelectorAll('.btn-enter-child');
    enterChildBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const childId = btn.dataset.childId;
        if (childId) this.enterNode(childId);
      });
    });

    const editChildBtns = el.querySelectorAll('.btn-edit-child');
    editChildBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const childId = btn.dataset.childId;
        if (childId) this.openDrawer(childId);
      });
    });

    const deleteChildBtns = el.querySelectorAll('.btn-delete-child');
    deleteChildBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const childId = btn.dataset.childId;
        if (childId) this.confirmNodeRemoval(childId);
      });
    });

    // Wire up direct add "+" buttons
    const addBtns = el.querySelectorAll('.btn-add-sub-child');
    addBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parentId = btn.dataset.parentId;
        const subFieldName = btn.dataset.subFieldName;
        const parentNode = this.nodes.get(parentId);
        if (!parentNode) return;
        const subField = parentNode.field.fields.find(f => f.name === subFieldName);
        if (subField) {
          this.addChildNodeViaClick(subField, parentId);
        }
      });
    });

    // Wire up drop zones
    const dropzones = el.querySelectorAll('.graph-node-dropzone');
    dropzones.forEach(dz => {
      const acceptedFieldName = dz.dataset.accepts;
      const childField = node.field.fields && node.field.fields.find(f => f.name === acceptedFieldName);
      if (!childField) return;
      dz.addEventListener('dragover', (e) => {
        if (this.currentDragField && this.currentDragField.name === acceptedFieldName) {
          e.preventDefault(); e.stopPropagation();
          dz.classList.add('drop-over'); dz.classList.remove('drop-invalid');
        } else if (this.currentDragField) { dz.classList.add('drop-invalid'); }
      });
      dz.addEventListener('dragleave', () => dz.classList.remove('drop-over', 'drop-invalid'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        dz.classList.remove('drop-over', 'drop-invalid');
        if (this.currentDragField && this.currentDragField.name === acceptedFieldName) {
          this.createNodeFromUserAction(childField, node.id);
        }
      });
      dz.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.addChildNodeViaClick(childField, node.id);
      });
    });
  }

  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    if (nodeId === 'global') return; // Global node is permanent

    if (this.selectedNodeId === nodeId) {
      this.selectedNodeId = null;
    }

    // Remove children recursively
    [...node.childIds].forEach(childId => this.removeNode(childId));

    // Remove from parent
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) {
        parent.childIds.delete(nodeId);
        parent.el.innerHTML = this.buildNodeHTML(parent);
        this.rewireNodeEvents(parent);
      }
    }

    // Animate out
    node.el.style.animation = 'nodeAppear 0.2s cubic-bezier(0.16, 1, 0.3, 1) reverse';
    setTimeout(() => {
      node.el.remove();
      this.nodes.delete(nodeId);
      this.updateAllConnections();
      this.updateEmptyState();
      this.updatePaletteCounts();
      this.updateCapacityUI();
      this.triggerOutputUpdate();
    }, 200);
  }

  refreshNodeEl(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.el) return;
    const x = node.el.style.left;
    const y = node.el.style.top;
    node.el.innerHTML = this.buildNodeHTML(node);
    // The DOM element is retained while its contents are replaced. Its
    // listeners therefore need to be bound again for the new inline fields.
    delete node.el.dataset.inlineFieldsBound;
    this.rewireNodeEvents(node);
    this.updateAllConnections();
  }

  getArrayItemInstanceKey(field, parentId) {
    let index = 1;
    while ([...this.nodes.values()].some(node =>
      node.parentId === parentId && node.field.name === field.name && node.instanceKey === `${field.name}${index}`
    )) index++;
    return `${field.name}${index}`;
  }

  generateInstanceKey(field, parentId = null) {
    if (field.type === 'array' && field.itemType === 'object') {
      return this.getArrayItemInstanceKey(field, parentId);
    }
    const existingCount = [...this.nodes.values()].filter(node =>
      node.parentId === parentId && node.field.name === field.name
    ).length;
    const baseName = field.keyLabel || field.label || field.name;
    // Sanitize for a key-like name
    const base = baseName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `${base}-${existingCount + 1}`;
  }

  buildDefaultValues(field) {
    if (field.type === 'object') {
      const obj = {};
      if (field.fields) {
        field.fields.forEach(subField => {
          if (!isComplexField(subField)) {
            obj[subField.name] = getFieldDefaults(subField);
          }
        });
      }
      // Merge with field.default if present
      if (field.default && typeof field.default === 'object') {
        Object.assign(obj, field.default);
      }
      return obj;
    }
    if (field.type === 'array') {
      return Array.isArray(field.default) ? [...field.default] : [];
    }
    return field.default !== undefined ? field.default : {};
  }

  cancelSmoothTransition() {
    clearTimeout(this.scrollTransitionTimeout);
    this.canvas.classList.remove('smooth-transition');
    this.svgLayer.classList.remove('smooth-transition');
  }

  scrollToNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.el || !this.canvasWrapper) return;
    this.canvasWrapper.focus({ preventScroll: true });

    const header = node.el.querySelector('.graph-node-header');
    const x = (parseFloat(node.el.style.left) || 0) + node.el.offsetWidth / 2;
    const y = (parseFloat(node.el.style.top) || 0) + (header?.offsetHeight || 0) / 2;
    const rect = this.canvasWrapper.getBoundingClientRect();
    this.panX = rect.width / 2 - x * this.zoom;
    this.panY = rect.height / 2 - y * this.zoom;

    this.canvas.classList.add('smooth-transition');
    this.svgLayer.classList.add('smooth-transition');
    this.applyTransform();

    clearTimeout(this.scrollTransitionTimeout);
    this.scrollTransitionTimeout = setTimeout(() => {
      this.canvas.classList.remove('smooth-transition');
      this.svgLayer.classList.remove('smooth-transition');
    }, 450);
  }

  // ──────────────────────────────────────────────────────────
  // GLOBAL NODE (pinned, for simple root fields)
  // ──────────────────────────────────────────────────────────

  createGlobalNode(simpleFields) {
    const nodeId = 'global';
    const el = document.createElement('div');
    el.className = 'graph-node is-global';
    el.dataset.nodeId = nodeId;
    el.style.left = '40px';
    el.style.top = '40px';
    el.style.width = '240px';

    const node = {
      id: nodeId,
      field: { name: '__global__', type: 'object', label: 'Config. globale', fields: simpleFields || [] },
      instanceKey: 'global',
      values: {},
      parentId: null,
      childIds: new Set(),
      el,
    };

    // Build default values
    if (simpleFields) {
      simpleFields.forEach(f => {
        node.values[f.name] = getFieldDefaults(f);
      });
    }

    this.nodes.set(nodeId, node);

    el.innerHTML = `
      <div class="graph-node-header" style="background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.03));">
        <div class="graph-node-heading">
          <span class="graph-node-icon">${getFieldIcon({ type: 'global' })}</span>
          <div class="graph-node-title-group">
            <span class="graph-node-title">Config. globale</span>
          </div>
        </div>
      </div>
      <div class="graph-node-body">
        ${this.buildGlobalFieldsHTML(simpleFields || [], node.values, node)}
      </div>`;

    refreshGraphDynamicArrayChoices(el);

    el.addEventListener('input', (e) => {
      if (e.target.dataset.fieldName) {
        const fname = e.target.dataset.fieldName;
        const ftype = e.target.dataset.fieldType;
        if (ftype === 'array-item') return;
        // Checkboxes are handled by 'change' to avoid double-firing (both input+change fire for checkboxes)
        if (e.target.type === 'checkbox') return;

        const targetNode = this.currentParentId === null
          ? this.nodes.get('global')
          : this.nodes.get(this.currentParentId);

        if (targetNode) {
          if (ftype === 'integer') {
            targetNode.values[fname] = parseInt(e.target.value, 10) || 0;
          } else if (ftype === 'number') {
            targetNode.values[fname] = parseFloat(e.target.value) || 0;
          } else if (ftype === 'array' && e.target.tagName === 'SELECT' && e.target.multiple) {
            targetNode.values[fname] = Array.from(e.target.selectedOptions).map(opt => opt.value);
          } else {
            targetNode.values[fname] = e.target.value;
          }
          this.triggerOutputUpdate();
        }
      }
    });

    el.addEventListener('change', (e) => {
      if (e.target.dataset.fieldName) {
        const fname = e.target.dataset.fieldName;
        const ftype = e.target.dataset.fieldType;
        if (ftype === 'array-item') return;

        const targetNode = this.currentParentId === null
          ? this.nodes.get('global')
          : this.nodes.get(this.currentParentId);

        if (targetNode) {
          if (ftype === 'boolean') {
            targetNode.values[fname] = e.target.checked;
            const labelEl = e.target.closest('.switch-mini')?.querySelector('.switch-mini-label');
            if (labelEl) {
              labelEl.textContent = e.target.checked ? 'Activé' : 'Désactivé';
            }
          } else if (ftype === 'array' && e.target.type === 'checkbox') {
            const current = Array.isArray(targetNode.values[fname]) ? [...targetNode.values[fname]] : [];
            if (e.target.checked) {
              if (!current.includes(e.target.value)) current.push(e.target.value);
            } else {
              const idx = current.indexOf(e.target.value);
              if (idx !== -1) current.splice(idx, 1);
            }
            targetNode.values[fname] = current;
          } else if (ftype === 'array' && e.target.tagName === 'SELECT' && e.target.multiple) {
            targetNode.values[fname] = Array.from(e.target.selectedOptions).map(opt => opt.value);
          } else {
            targetNode.values[fname] = e.target.value;
          }
          this.triggerOutputUpdate();
        }
      }
    });

    el.addEventListener('click', (e) => {
      const targetNode = this.currentParentId === null
        ? this.nodes.get('global')
        : this.nodes.get(this.currentParentId);

      if (!targetNode) return;

      const addBtn = e.target.closest('.graph-node-array-item-add');
      if (addBtn && addBtn.dataset.fieldName) {
        const fname = addBtn.dataset.fieldName;
        const current = Array.isArray(targetNode.values[fname]) ? [...targetNode.values[fname]] : [];
        current.push('');
        targetNode.values[fname] = current;
        // The green node is shared by every navigation level. Re-render it
        // through the current context instead of the root fields captured
        // when this node was created.
        this.renderVariablesNode();
        refreshGraphDynamicArrayChoices(el);
        this.triggerOutputUpdate();
        return;
      }

      const removeBtn = e.target.closest('.graph-node-array-item-remove');
      if (removeBtn && removeBtn.dataset.fieldName) {
        const fname = removeBtn.dataset.fieldName;
        const index = parseInt(removeBtn.dataset.arrayIndex, 10);
        const current = Array.isArray(targetNode.values[fname]) ? [...targetNode.values[fname]] : [];
        if (!Number.isNaN(index) && index >= 0 && index < current.length) {
          current.splice(index, 1);
          targetNode.values[fname] = current;
          // See the add handler above: preserve the child context after a
          // collection edit rather than restoring the root form.
          this.renderVariablesNode();
          refreshGraphDynamicArrayChoices(el);
          this.triggerOutputUpdate();
        }
      }
    });

    el.addEventListener('input', (e) => {
      if (e.target.dataset.fieldType === 'array-item' && e.target.dataset.fieldName) {
        const fname = e.target.dataset.fieldName;
        const itemType = e.target.dataset.fieldItemType || 'string';
        const targetNode = this.currentParentId === null
          ? this.nodes.get('global')
          : this.nodes.get(this.currentParentId);

        if (targetNode) {
          const container = el.querySelector(`.graph-node-array-editor[data-array-field-name="${fname}"]`);
          if (container) {
            const inputs = Array.from(container.querySelectorAll('input[data-field-name="' + fname + '"][data-field-type="array-item"]'));
            const values = inputs.map(input => {
              const raw = input.value;
              if (itemType === 'integer') return raw === '' ? '' : parseInt(raw, 10) || 0;
              if (itemType === 'number') return raw === '' ? '' : parseFloat(raw) || 0;
              return raw;
            });
            targetNode.values[fname] = values;
            this.triggerOutputUpdate();
          }
        }
      }
    });

    el.addEventListener('click', (e) => {
      this.selectNode(nodeId);
    });
    el.addEventListener('focusin', () => {
      this.selectNode(nodeId);
    });

    // ── Make global node draggable (reposition only, no restriction) ──
    interact(el).draggable({
      listeners: {
        move: (event) => {
          const nx = (parseFloat(el.style.left) || 0) + event.dx / this.zoom;
          const ny = (parseFloat(el.style.top) || 0) + event.dy / this.zoom;
          el.style.left = `${nx}px`;
          el.style.top = `${ny}px`;
          this.updateAllConnections();
        },
        start: () => {
          this.selectNode(nodeId);
        },
        end: () => {
          if (this.selectedNodeId !== nodeId && el) {
            el.style.zIndex = '';
          }
          this.repelGroupsFromGlobal();
          this.repelFreeNode(this.nodes.get('global'));
          this.updateAllConnections();
        },
      },
      // Field labels and the card body can move the node, without stealing control interaction.
      allowFrom: '.graph-node-header, .graph-node-body',
      ignoreFrom: 'input, select, textarea, button, label',
    });

    this.canvas.appendChild(el);
    return nodeId;
  }

  // Regular (blue) nodes use the same inline controls as the global (green)
  // node. Their values are committed immediately, without opening the drawer.
  bindInlineNodeFields(node) {
    if (!node || node.id === 'global' || !node.el) return;
    const el = node.el;
    if (el.dataset.inlineFieldsBound === 'true') return;
    el.dataset.inlineFieldsBound = 'true';
    const updateValue = (target) => {
      const fname = target.dataset.fieldName;
      const ftype = target.dataset.fieldType;
      if (!fname || ftype === 'array-item') return;
      if (target.type === 'checkbox' && ftype !== 'array') return;

      if (ftype === 'integer') node.values[fname] = parseInt(target.value, 10) || 0;
      else if (ftype === 'number') node.values[fname] = parseFloat(target.value) || 0;
      else if (ftype === 'array' && target.tagName === 'SELECT' && target.multiple) {
        node.values[fname] = Array.from(target.selectedOptions).map(option => option.value);
      } else node.values[fname] = target.value;
      this.triggerOutputUpdate();
    };

    el.addEventListener('input', (event) => updateValue(event.target));
    el.addEventListener('change', (event) => {
      const target = event.target;
      const fname = target.dataset.fieldName;
      const ftype = target.dataset.fieldType;
      if (!fname || ftype === 'array-item') return;
      if (ftype === 'boolean') {
        node.values[fname] = target.checked;
        const labelEl = target.closest('.switch-mini')?.querySelector('.switch-mini-label');
        if (labelEl) {
          labelEl.textContent = target.checked ? 'Activé' : 'Désactivé';
        }
      }
      else if (ftype === 'array' && target.type === 'checkbox') {
        const current = Array.isArray(node.values[fname]) ? [...node.values[fname]] : [];
        if (target.checked && !current.includes(target.value)) current.push(target.value);
        if (!target.checked) node.values[fname] = current.filter(value => value !== target.value);
        else node.values[fname] = current;
      } else updateValue(target);
      this.triggerOutputUpdate();
    });

    el.addEventListener('input', (event) => {
      const target = event.target;
      if (target.dataset.fieldType !== 'array-item' || !target.dataset.fieldName) return;
      const fname = target.dataset.fieldName;
      const itemType = target.dataset.fieldItemType || 'string';
      const inputs = Array.from(el.querySelectorAll(`.graph-node-array-editor[data-array-field-name="${fname}"] input[data-field-type="array-item"]`));
      node.values[fname] = inputs.map(input => {
        const raw = input.value;
        if (itemType === 'integer') return raw === '' ? '' : parseInt(raw, 10) || 0;
        if (itemType === 'number') return raw === '' ? '' : parseFloat(raw) || 0;
        return raw;
      });
      this.triggerOutputUpdate();
    });

    el.addEventListener('click', (event) => {
      const addBtn = event.target.closest('.graph-node-array-item-add');
      const removeBtn = event.target.closest('.graph-node-array-item-remove');
      if (!addBtn && !removeBtn) return;
      event.stopPropagation();
      const button = addBtn || removeBtn;
      const fname = button.dataset.fieldName;
      if (!fname) return;
      const values = Array.isArray(node.values[fname]) ? [...node.values[fname]] : [];
      if (addBtn) values.push('');
      else {
        const index = parseInt(removeBtn.dataset.arrayIndex, 10);
        if (!Number.isNaN(index)) values.splice(index, 1);
      }
      node.values[fname] = values;
      this.refreshNodeEl(node.id);
      refreshGraphDynamicArrayChoices(node.el);
      this.triggerOutputUpdate();
    });
  }

  buildGlobalFieldsHTML(fields, values, parentNode) {
    const nodePathSegments = parentNode ? this.getNodePathSegments(parentNode) : [];
    const nodePath = parentNode ? this.getNodePathString(parentNode) : '';
    const rawData = this.toFormData(true);
    return fields.map(f => {
      // Evaluate condition
      let conditionMet = true;
      if (f.condition && rawData) {
        const fieldPath = nodePath ? `${nodePath}.${f.name}` : f.name;
        const pathVarsMap = {};
        const processedCondition = preprocessCondition(f.condition, fieldPath, rawData, pathVarsMap);
        const context = { ...buildEvalContext(rawData, fieldPath), ...pathVarsMap };
        conditionMet = evaluateCondition(processedCondition, context);
      }
      const hiddenClass = conditionMet ? '' : ' condition-hidden';

      const val = values[f.name];
      if (f.type === 'boolean') {
        const checked = val ? 'checked' : '';
        return `<div class="graph-node-field${hiddenClass}" data-field-name="${f.name}">
          <div class="graph-node-field-label">${getGraphFieldLabelHtml(f)}</div>
          <div class="switch-mini" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
            <span class="switch-mini-label" style="font-size:0.75rem;color:var(--text-muted);">${val ? 'Activé' : 'Désactivé'}</span>
            <label class="switch" style="width:36px;height:20px;">
              <input type="checkbox" data-field-name="${f.name}" data-field-type="boolean" ${checked}>
              <span class="slider"></span>
            </label>
          </div>
        </div>`;
      }
      if (f.type === 'array') {
        const items = Array.isArray(val) ? val : (Array.isArray(f.default) ? f.default : []);
        const itemType = f.itemType || 'string';
        const inputType = (itemType === 'integer' || itemType === 'number') ? 'number' : 'text';

        const choiceSource = resolveArrayFieldChoices(f, this.toFormData(), nodePathSegments);
        if (choiceSource !== null) {
          const selectedValues = Array.isArray(val) ? val.map(String) : [];
          const maxSelections = getFieldMaxInstances(f);
          const optionsHTML = choiceSource.map(o => {
            const v = typeof o === 'object' ? o.value : o;
            const l = typeof o === 'object' ? (o.label || o.value) : o;
            const checked = selectedValues.includes(String(v)) ? 'checked' : '';
            const disabled = !checked && maxSelections !== null && selectedValues.length >= maxSelections ? 'disabled' : '';
            return `<label class="graph-node-checkbox-item">
              <input type="checkbox" data-field-name="${f.name}" data-field-type="array" data-max-items="${maxSelections ?? ''}" value="${escapeHtml(v)}" ${checked} ${disabled}>
              <span>${escapeHtml(l)}</span>
            </label>`;
          }).join('');
          const emptyState = choiceSource.length === 0
            ? '<div class="graph-node-array-empty">Aucune option disponible</div>'
            : optionsHTML;
          return `<div class="graph-node-field${hiddenClass}" data-field-name="${f.name}">
            <div class="graph-node-field-label">${getGraphFieldLabelHtml(f)}</div>
            <div class="graph-node-field-checkboxes" data-field-name="${f.name}" ${f.optionsUrl ? `data-options-url='${escapeHtml(JSON.stringify(f.optionsUrl))}'` : ''}>${emptyState}</div>
            ${getFieldConstraintErrorHtml(f, val)}
          </div>`;
        }

        const itemsHTML = items.map((item, index) => `
          <div class="graph-node-array-item-row">
            <input type="${inputType}" class="graph-node-array-item-input" data-field-name="${f.name}" data-field-type="array-item"
              data-field-item-type="${itemType}" data-array-index="${index}"
              value="${escapeHtml(item)}" placeholder="${itemType === 'string' ? '...' : ''}">
            <button type="button" class="graph-node-btn graph-node-array-item-remove" data-field-name="${f.name}" data-array-index="${index}" title="Supprimer l'élément">×</button>
          </div>
        `).join('');

        const maxItems = getFieldMaxInstances(f);
        const addDisabled = maxItems !== null && items.length >= maxItems ? 'disabled' : '';
        return `<div class="graph-node-field${hiddenClass}" data-field-name="${f.name}">
          <div class="graph-node-field-label">${getGraphFieldLabelHtml(f)}</div>
          <div class="graph-node-array-editor" data-array-field-name="${f.name}">
            ${itemsHTML || '<div class="graph-node-array-empty">Aucun élément</div>'}
          </div>
          <button type="button" class="graph-node-btn graph-node-array-item-add" data-field-name="${f.name}" data-max-items="${maxItems ?? ''}" ${addDisabled}>+ Ajouter</button>
          ${getFieldConstraintErrorHtml(f, items)}
        </div>`;
      }
      if (f.type === 'select' && f.options) {
        const optionsHTML = f.options.map(o => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? (o.label || o.value) : o;
          return `<option value="${escapeHtml(v)}" ${v == val ? 'selected' : ''}>${escapeHtml(l)}</option>`;
        }).join('');
        return `<div class="graph-node-field${hiddenClass}" data-field-name="${f.name}">
          <div class="graph-node-field-label">${getGraphFieldLabelHtml(f)}</div>
          <select data-field-name="${f.name}" data-field-type="select">${optionsHTML}</select>
        </div>`;
      }
      const inputType = (f.type === 'integer' || f.type === 'number') ? 'number' : 'text';
      const inputAttributes = FieldConstraints.inputAttributes(f);
      return `<div class="graph-node-field${hiddenClass}" data-field-name="${f.name}">
        <div class="graph-node-field-label">${getGraphFieldLabelHtml(f)}</div>
        <input type="${inputType}" data-field-name="${f.name}" data-field-type="${f.type}"
          value="${val !== undefined ? escapeHtml(val) : ''}"
          ${Object.entries(inputAttributes).map(([name, value]) => `${name}="${escapeHtml(value)}"`).join(' ')}
          placeholder="${f.default !== undefined ? escapeHtml(f.default) : ''}">
        ${getFieldConstraintErrorHtml(f, val)}
      </div>`;
    }).join('');
  }

  // ──────────────────────────────────────────────────────────
  // SVG CONNECTIONS
  // ──────────────────────────────────────────────────────────

  updateAllConnections() {
    // Remove all existing paths
    const paths = this.svgLayer.querySelectorAll('.graph-connection-path, .graph-connection-group');
    paths.forEach(p => p.remove());

    const variablesNode = this.nodes.get('global');
    if (!variablesNode || !variablesNode.el) return;

    this.nodes.forEach(node => {
      if (node.id === 'global') return;
      if (node.parentId !== this.currentParentId) return;
      if (!node.el) return;
      this.drawConnection(variablesNode.el, node.el);
    });
  }

  drawConnection(fromEl, toEl) {
    const fromRect = {
      left: parseFloat(fromEl.style.left) || 0,
      top: parseFloat(fromEl.style.top) || 0,
      width: fromEl.offsetWidth || 240,
      height: fromEl.offsetHeight || 150,
    };
    const toRect = {
      left: parseFloat(toEl.style.left) || 0,
      top: parseFloat(toEl.style.top) || 0,
      width: toEl.offsetWidth || 220,
      height: toEl.offsetHeight || 150,
    };

    const x1 = fromRect.left + fromRect.width;
    const y1 = fromRect.top + fromRect.height / 2;
    const x2 = toRect.left;
    const y2 = toRect.top + toRect.height / 2;

    const cpOffset = Math.abs(x2 - x1) * 0.5;
    const d = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'graph-connection-path');
    path.setAttribute('marker-end', 'url(#arrowhead)');
    this.svgLayer.appendChild(path);
  }

  // ──────────────────────────────────────────────────────────
  // DRAWER
  // ──────────────────────────────────────────────────────────

  initModal() {
    this.modalCancel.addEventListener('click', () => this.closeModal());
    this.modalClose.addEventListener('click', () => this.closeModal());
    this.modalOverlay.addEventListener('click', () => this.closeModal());
    this.modalForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.modalAction) this.modalAction();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.modal.classList.contains('open')) this.closeModal();
    });
  }

  openModal({ title, description, confirmLabel, danger = false, input = null, onConfirm }) {
    this.modalTitle.textContent = title;
    this.modalDescription.textContent = description;
    this.modalConfirm.textContent = confirmLabel;
    this.modal.classList.toggle('danger', danger);
    this.modalError.textContent = '';
    this.modalAction = onConfirm;

    const hasInput = input !== null;
    this.modalInputLabel.style.display = hasInput ? 'block' : 'none';
    this.modalInput.style.display = hasInput ? 'block' : 'none';
    this.modalInput.required = hasInput;
    if (hasInput) {
      this.modalInputLabel.textContent = input.label;
      this.modalInput.placeholder = input.placeholder || '';
      this.modalInput.value = input.value || '';
    }

    this.modal.classList.add('open');
    this.modalOverlay.classList.add('active');
    setTimeout(() => (hasInput ? this.modalInput : this.modalConfirm).focus(), 0);
  }

  closeModal() {
    this.modal.classList.remove('open', 'danger');
    this.modalOverlay.classList.remove('active');
    this.modalAction = null;
    this.modalError.textContent = '';
    if (this.canvasWrapper) {
      this.canvasWrapper.focus({ preventScroll: true });
    }
  }

  requestDynamicName(field, parentId, suggestedKey, onConfirm) {
    this.openModal({
      title: `Ajouter ${field.label || field.name}`,
      description: 'Choisissez le nom de cette instance dynamique. Il doit être unique à ce niveau.',
      confirmLabel: 'Ajouter',
      input: {
        label: field.keyLabel || 'Nom de l’instance',
        placeholder: 'ex: vm1, node-a…',
        value: suggestedKey,
      },
      onConfirm: () => {
        const instanceKey = this.modalInput.value.trim();
        if (!instanceKey) {
          this.modalError.textContent = 'Le nom de l’instance est requis.';
          this.modalInput.focus();
          return;
        }
        const exists = [...this.nodes.values()].some(node =>
          node.parentId === parentId && node.field.name === field.name && node.instanceKey === instanceKey
        );
        if (exists) {
          this.modalError.textContent = 'Ce nom est déjà utilisé pour cette instance.';
          this.modalInput.focus();
          return;
        }
        this.closeModal();
        onConfirm(instanceKey);
      },
    });
  }

  requestNodeRename(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || node.field.type !== 'object' || !node.field.dynamicKeys) return;

    this.openModal({
      title: `Renommer ${node.field.label || node.field.name}`,
      description: 'Choisissez un nom unique pour cette instance dynamique.',
      confirmLabel: 'Renommer',
      input: {
        label: node.field.keyLabel || 'Nom de l\'instance',
        placeholder: 'ex: vm1, node-a…',
        value: node.instanceKey,
      },
      onConfirm: () => {
        const instanceKey = this.modalInput.value.trim();
        if (!instanceKey) {
          this.modalError.textContent = 'Le nom de l\'instance est requis.';
          this.modalInput.focus();
          return;
        }
        const exists = [...this.nodes.values()].some(candidate =>
          candidate.id !== node.id &&
          candidate.parentId === node.parentId &&
          candidate.field.name === node.field.name &&
          candidate.instanceKey === instanceKey
        );
        if (exists) {
          this.modalError.textContent = 'Ce nom est déjà utilisé pour cette instance.';
          this.modalInput.focus();
          return;
        }

        node.instanceKey = instanceKey;
        this.closeModal();
        this.refreshNodeEl(node.id);
        if (node.parentId) this.refreshNodeEl(node.parentId);
        this.triggerOutputUpdate();
      },
    });
  }

  confirmNodeRemoval(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || nodeId === 'global') return;
    const label = node.instanceKey || node.field.label || node.field.name;
    this.openModal({
      title: 'Supprimer cet élément ?',
      description: `« ${label} » et ses éventuels sous-éléments seront supprimés.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        this.closeModal();
        this.removeNode(nodeId);
      },
    });
  }

  initDrawer() {
    this.drawerClose.addEventListener('click', () => this.closeDrawer());
    this.drawerCancel.addEventListener('click', () => this.closeDrawer());
    this.drawerOverlay.addEventListener('click', () => this.closeDrawer());
    this.drawerApply.addEventListener('click', () => this.applyDrawer());

    // Key input changes instance key live
    this.drawerKeyInput.addEventListener('input', () => {
      const node = this.nodes.get(this.activeDrawerNodeId);
      if (!node || node.field.type !== 'object' || !node.field.dynamicKeys) return;
      const newKey = this.drawerKeyInput.value.trim();
      node.instanceKey = newKey || node.instanceKey;
      if (typeof markConfigDirty === 'function') markConfigDirty();
      this.refreshNodeEl(this.activeDrawerNodeId);
      if (node.parentId) this.refreshNodeEl(node.parentId);
    });
  }

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.drawer.classList.contains('open')) return;
      e.preventDefault();
      this.closeDrawer();
      this.canvasWrapper.focus({ preventScroll: true });
    });
  }

  openDrawer(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    this.selectNode(nodeId);
    this.activeDrawerNodeId = nodeId;

    const field = node.field;
    const isGlobal = nodeId === 'global';

    this.drawerIcon.innerHTML = getFieldIcon(isGlobal ? { type: 'global' } : field);
    this.drawerTitle.textContent = isGlobal ? 'Configuration globale' : (field.label || field.name);
    this.drawerSubtitle.textContent = isGlobal
      ? 'Champs principaux de la configuration'
      : (field.description || getFieldTypeLabel(field));

    // Only maps have a user-defined instance key. Array entries are indexed
    // iterations, and fixed child objects inherit their field name.
    const showKey = !isGlobal && field.type === 'object' && field.dynamicKeys;
    this.drawerKeySection.style.display = showKey ? 'block' : 'none';
    if (showKey) {
      this.drawerKeyInput.value = node.instanceKey || '';
    }

    // Render form fields
    this.drawerBody.innerHTML = '';
    // The drawer is the full editor for this object: render complex fields as
    // well, just like the regular form does. Their cached values come from
    // the node tree rather than from node.values (which only stores simples).
    const fields = field.fields || [];

    if (fields && fields.length > 0) {
      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'graph-drawer-section-title';
      sectionTitle.textContent = isGlobal ? 'Paramètres globaux' : 'Propriétés';
      this.drawerBody.appendChild(sectionTitle);

      const parentPath = this.getNodePathString(node);
      fields.forEach(subField => {
        const cachedVal = isComplexField(subField)
          ? this.extractNodeValues(node, true)[subField.name]
          : node.values[subField.name];
        const subFieldWithDefault = { ...subField, default: cachedVal !== undefined ? cachedVal : subField.default };
        const el = createFieldElement(subFieldWithDefault, parentPath, cachedVal);
        if (el) {
          this.drawerBody.appendChild(el);
        }
      });

      if (typeof updateDynamicDropdowns === 'function') {
        updateDynamicDropdowns(this.toFormData());
      }

      // Wire up live output update from drawer inputs
      const inputs = this.drawerBody.querySelectorAll('input, select, textarea');
      inputs.forEach(inp => {
        inp.addEventListener('input', () => this.onDrawerChange());
        inp.addEventListener('change', () => this.onDrawerChange());
      });

      if (typeof updateConditionalFields === 'function') {
        updateConditionalFields(this.drawerBody);
      }
    } else {
      this.drawerBody.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:0.85rem;">
        Aucune propriété simple à configurer.<br>
        <span style="font-size:0.75rem;opacity:0.6;">Utilisez les zones de dépôt sur le nœud pour ajouter des sous-éléments.</span>
      </div>`;
    }

    // Open
    this.drawer.classList.add('open');
    this.drawerOverlay.classList.add('active');
  }

  onDrawerChange() {
    // Live preview while editing drawer (doesn't apply until "Appliquer")
    // Optionally do a soft update
    if (typeof updateConditionalFields === 'function') {
      updateConditionalFields(this.drawerBody);
    }
  }

  applyDrawer() {
    const node = this.nodes.get(this.activeDrawerNodeId);
    if (!node) { this.closeDrawer(); return; }

    const isGlobal = this.activeDrawerNodeId === 'global';
    const fields = node.field.fields || [];

    if (fields) {
      fields.forEach(subField => {
        const formGroup = this.drawerBody.querySelector(`[data-field-name="${subField.name}"]`);
        if (!formGroup) return;
        if (formGroup.classList.contains('condition-hidden')) {
          delete node.values[subField.name];
          return;
        }
        const val = extractFieldValue(formGroup, subField);
        if (isComplexField(subField)) {
          this.replaceComplexChildrenFromDrawer(node, subField, val);
        } else if (val !== undefined) {
          node.values[subField.name] = val;
        }
      });
    }

    // Update instance key if shown
    if (!isGlobal && node.field.type === 'object' && node.field.dynamicKeys) {
      const newKey = this.drawerKeyInput.value.trim();
      if (newKey) node.instanceKey = newKey;
    }

    this.refreshNodeEl(this.activeDrawerNodeId);
    if (node.parentId) {
      this.refreshNodeEl(node.parentId);
    }

    // Update global node inline fields if global
    if (isGlobal) {
      const el = node.el;
      const body = el.querySelector('.graph-node-body');
      if (body) {
        body.innerHTML = this.buildGlobalFieldsHTML(fields, node.values, node);
        refreshGraphDynamicArrayChoices(el);
      }
    }

    this.triggerOutputUpdate();
    this.closeDrawer();
  }

  /** Return one complex field from the node tree in its form-data shape. */
  getComplexFieldValue(node, field) {
    return this.extractNodeValues(node, true)[field.name];
  }

  /** Remove a subtree synchronously so it can immediately be rebuilt from the drawer. */
  removeNodeTreeImmediately(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || node.id === 'global') return;
    [...node.childIds].forEach(childId => this.removeNodeTreeImmediately(childId));
    if (node.parentId) this.nodes.get(node.parentId)?.childIds.delete(nodeId);
    node.el?.remove();
    this.nodes.delete(nodeId);
  }

  /**
   * Complex fields are represented by child graph nodes. Rebuild only the
   * changed field from the recursive form value produced by the drawer.
   */
  replaceComplexChildrenFromDrawer(parentNode, field, value) {
    const currentValue = this.getComplexFieldValue(parentNode, field);
    if (JSON.stringify(currentValue) === JSON.stringify(value)) return;

    [...parentNode.childIds]
      .map(childId => this.nodes.get(childId))
      .filter(child => child?.field.name === field.name)
      .forEach(child => this.removeNodeTreeImmediately(child.id));

    const parentLeft = parseFloat(parentNode.el?.style.left) || 0;
    const parentTop = parseFloat(parentNode.el?.style.top) || 0;
    const addChild = (instanceKey, childValue, index) => {
      this.importNode(field, instanceKey, childValue, parentNode.id, parentLeft + 280, parentTop + index * 180);
    };

    if (field.dynamicKeys && value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, childValue], index) => addChild(key, childValue, index));
    } else if (field.type === 'array' && field.itemType === 'object' && Array.isArray(value)) {
      value.forEach((childValue, index) => addChild(`${field.name}${index + 1}`, childValue, index));
    } else if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      addChild(field.name, value, 0);
    }
  }

  closeDrawer() {
    this.drawer.classList.remove('open');
    this.drawerOverlay.classList.remove('active');
    this.activeDrawerNodeId = null;
  }

  // ──────────────────────────────────────────────────────────
  // OUTPUT PANEL
  // ──────────────────────────────────────────────────────────

  initOutputPanel() {
    const collapseBtn = document.getElementById('graph-output-collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        const collapsed = this.outputPanel.classList.toggle('collapsed');
        const layout = this.outputPanel.closest('.graph-layout');
        if (layout) {
          layout.classList.toggle('output-panel-collapsed', collapsed);
        }
        collapseBtn.setAttribute('aria-expanded', String(!collapsed));
        collapseBtn.title = collapsed ? 'Agrandir le panneau' : 'Réduire le panneau';
        const icon = collapseBtn.querySelector('svg polyline');
        if (icon) {
          icon.setAttribute('points', collapsed
            ? '15 18 9 12 15 6'
            : '9 18 15 12 9 6');
        }
      });
    }

    // Copy button in graph mode
    const copyBtn = document.getElementById('graph-btn-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const code = document.getElementById('graph-code-output');
        if (code) {
          navigator.clipboard.writeText(code.textContent).then(() => {
            copyBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg><span class="graph-copy-label">Copié !</span>`;
            copyBtn.title = 'Code copié';
            copyBtn.setAttribute('aria-label', 'Code copié');
            setTimeout(() => {
              copyBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"/></svg><span class="graph-copy-label">Copier</span>`;
              copyBtn.title = 'Copier le code';
              copyBtn.setAttribute('aria-label', 'Copier le code');
            }, 2000);
          });
        }
      });
    }
  }

  initToolbarButtons() {
    const fitBtn = document.getElementById('graph-btn-fit');
    if (fitBtn) fitBtn.addEventListener('click', () => this.fitView());

    const arrangeBtn = document.getElementById('graph-btn-arrange');
    if (arrangeBtn) arrangeBtn.addEventListener('click', () => this.arrangeGraph());

    const resetZoomBtn = document.getElementById('graph-btn-reset-zoom');
    if (resetZoomBtn) {
      resetZoomBtn.addEventListener('click', () => {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
        this.zoomIndicator.textContent = '100%';
      });
    }

    // Graph format buttons
    ['yaml', 'json', 'hcl'].forEach(fmt => {
      const btn = document.getElementById(`graph-format-${fmt}`);
      if (btn) {
        btn.addEventListener('click', () => {
          // Sync with main format buttons
          const mainBtn = document.getElementById(`format-${fmt}`);
          if (mainBtn) mainBtn.click();
          this.updateGraphFormatButtons(fmt);
        });
      }
    });
  }

  updateGraphFormatButtons(format) {
    ['yaml', 'json', 'hcl'].forEach(fmt => {
      const btn = document.getElementById(`graph-format-${fmt}`);
      if (btn) {
        btn.classList.toggle('active', fmt === format);
      }
    });
  }

  // ──────────────────────────────────────────────────────────
  // SYNC
  // ──────────────────────────────────────────────────────────

  /**
   * Import form data into the graph.
   * Called when switching from Form mode → Graph mode.
   */
  importNode(field, instanceKey, values, parentId, x, y) {
    const nodeId = generateId();

    // Start with the imported object so that values are never lost when a
    // schema evolves or when a dynamic-key object is restored from the form.
    const nodeValues = values && typeof values === 'object' && !Array.isArray(values)
      ? { ...values }
      : {};
    const complexValues = {};

    if (field.fields) {
      field.fields.forEach(subField => {
        const val = values?.[subField.name];
        if (val !== undefined) {
          if (isComplexField(subField)) {
            complexValues[subField.name] = val;
            delete nodeValues[subField.name];
          } else {
            nodeValues[subField.name] = val;
          }
        }
      });
    }

    const node = {
      id: nodeId,
      field,
      instanceKey,
      values: nodeValues,
      parentId,
      childIds: new Set(),
      el: null,
    };

    this.nodes.set(nodeId, node);

    const el = this.createNodeEl(node, x, y);
    node.el = el;
    this.canvas.appendChild(el);

    if (parentId) {
      const parentNode = this.nodes.get(parentId);
      if (parentNode) {
        parentNode.childIds.add(nodeId);
      }
    }

    let childYOffset = 0;
    Object.entries(complexValues).forEach(([subFieldName, subFieldVal]) => {
      const subField = field.fields.find(f => f.name === subFieldName);
      if (!subField) return;

      if (subField.dynamicKeys && typeof subFieldVal === 'object' && !Array.isArray(subFieldVal)) {
        Object.entries(subFieldVal).forEach(([key, val]) => {
          this.importNode(subField, key, val, nodeId, x + 280, y + childYOffset);
          childYOffset += 180;
        });
      } else if (subField.type === 'array' && Array.isArray(subFieldVal)) {
        subFieldVal.forEach((itemVal, i) => {
          this.importNode(subField, `${subField.name}${i + 1}`, itemVal, nodeId, x + 280, y + childYOffset);
          childYOffset += 180;
        });
      } else if (subField.type === 'object' && typeof subFieldVal === 'object') {
        this.importNode(subField, subField.name, subFieldVal, nodeId, x + 280, y + childYOffset);
        childYOffset += 180;
      }
    });

    if (field.fields) {
      field.fields.forEach(subField => {
        if (isComplexField(subField)) {
          this.refreshParentDropzone(nodeId, subField);
        }
      });
    }

    return nodeId;
  }

  fromFormData(formData, schema) {
    if (!schema || !schema.fields) return;

    // Clear existing nodes (keep global)
    const globalNode = this.nodes.get('global');
    const toRemove = [...this.nodes.keys()].filter(id => id !== 'global');
    toRemove.forEach(id => {
      const n = this.nodes.get(id);
      if (n && n.el) n.el.remove();
      this.nodes.delete(id);
    });

    let autoX = 300;
    let autoY = 40;

    const simpleFields = schema.fields.filter(f => !isComplexField(f));
    const complexFields = schema.fields.filter(isComplexField);

    // Update global node values
    if (globalNode) {
      simpleFields.forEach(f => {
        if (formData[f.name] !== undefined) globalNode.values[f.name] = formData[f.name];
      });
      const body = globalNode.el.querySelector('.graph-node-body');
      if (body) {
        body.innerHTML = this.buildGlobalFieldsHTML(simpleFields, globalNode.values, globalNode);
        refreshGraphDynamicArrayChoices(globalNode.el);
      }
    }

    complexFields.forEach(field => {
      const fieldData = formData[field.name];
      if (!fieldData) return;

      if (field.dynamicKeys && typeof fieldData === 'object' && !Array.isArray(fieldData)) {
        Object.entries(fieldData).forEach(([key, val], i) => {
          this.importNode(field, key, val, null, autoX, autoY + i * 200);
        });
        autoX += 350;
      } else if (field.type === 'array' && Array.isArray(fieldData)) {
        fieldData.forEach((itemVal, i) => {
          this.importNode(field, `${field.name}${i + 1}`, itemVal, null, autoX, autoY + i * 200);
        });
        autoX += 350;
      } else if (field.type === 'object' && typeof fieldData === 'object') {
        this.importNode(field, field.name, fieldData, null, autoX, autoY);
        autoX += 350;
      }
    });

    this.enterNode(null);
    this.arrangeInitialLayout();
    this.updateAllConnections();
    this.updateValidationState();
  }

  extractDrawerValues() {
    if (!this.activeDrawerNodeId) return null;
    const node = this.nodes.get(this.activeDrawerNodeId);
    if (!node) return null;

    const values = {};
    const isGlobal = this.activeDrawerNodeId === 'global';
    const fields = isGlobal ? node.field.fields : (node.field.fields || []).filter(f => !isComplexField(f));

    if (fields) {
      fields.forEach(subField => {
        const formGroup = this.drawerBody.querySelector(`[data-field-name="${subField.name}"]`);
        if (!formGroup) return;
        const val = extractFieldValue(formGroup, subField, true);
        if (val !== undefined) {
          values[subField.name] = val;
        }
      });
    }
    return values;
  }

  /**
   * Export graph data as a plain object matching the schema structure.
   * Called for live output generation and when switching Graph → Form.
   */
  toFormData(ignoreConditions = false, rawData = null, liveNodeId = null, liveValues = null) {
    if (!ignoreConditions && !rawData) {
      rawData = this.toFormData(true, null, liveNodeId, liveValues);
    }

    const result = {};

    // Global node values (simple fields)
    const globalNode = this.nodes.get('global');
    if (globalNode) {
      let values;
      if (globalNode.id === liveNodeId && liveValues) {
        values = { ...liveValues };
      } else {
        values = { ...globalNode.values };
      }

      if (!ignoreConditions && rawData) {
        const globalField = globalNode.field;
        (globalField.fields || []).forEach(f => {
          if (!isComplexField(f)) {
            if (values[f.name] !== undefined) {
              const pathStr = f.name;
              if (f.condition) {
                const pathVarsMap = {};
                const processedCondition = preprocessCondition(f.condition, pathStr, rawData, pathVarsMap);
                const context = { ...buildEvalContext(rawData, pathStr), ...pathVarsMap };
                if (!evaluateCondition(processedCondition, context)) {
                  return;
                }
              }
              result[f.name] = values[f.name];
            }
          }
        });
      } else {
        Object.assign(result, values);
      }
    }

    // Complex nodes
    const schema = this.schema;
    if (!schema || !schema.fields) return result;

    schema.fields.filter(isComplexField).forEach(field => {
      if (!ignoreConditions && rawData && field.condition) {
        const pathStr = field.name;
        const pathVarsMap = {};
        const processedCondition = preprocessCondition(field.condition, pathStr, rawData, pathVarsMap);
        const context = { ...buildEvalContext(rawData, pathStr), ...pathVarsMap };
        if (!evaluateCondition(processedCondition, context)) {
          return;
        }
      }

      const fieldNodes = [...this.nodes.values()].filter(
        n => n.field.name === field.name && !n.parentId
      );

      if (field.dynamicKeys) {
        result[field.name] = {};
        fieldNodes.forEach(n => {
          result[field.name][n.instanceKey] = this.extractNodeValues(n, ignoreConditions, rawData, liveNodeId, liveValues);
        });
      } else if (field.type === 'array' && field.itemType === 'object') {
        result[field.name] = fieldNodes.map(n => this.extractNodeValues(n, ignoreConditions, rawData, liveNodeId, liveValues));
      } else if (field.type === 'object') {
        if (fieldNodes.length > 0) {
          result[field.name] = this.extractNodeValues(fieldNodes[0], ignoreConditions, rawData, liveNodeId, liveValues);
        }
      }
    });

    return result;
  }

  extractNodeValues(node, ignoreConditions = false, rawData = null, liveNodeId = null, liveValues = null) {
    let values;
    if (node.id === liveNodeId && liveValues) {
      values = { ...liveValues };
    } else {
      values = { ...node.values };
    }

    const filteredValues = {};
    const nodePath = this.getNodePathString(node);

    // Filter simple fields of this node
    (node.field.fields || []).forEach(f => {
      if (!isComplexField(f)) {
        if (values[f.name] !== undefined) {
          if (!ignoreConditions && rawData && f.condition) {
            const fieldPath = nodePath ? `${nodePath}.${f.name}` : f.name;
            const pathVarsMap = {};
            const processedCondition = preprocessCondition(f.condition, fieldPath, rawData, pathVarsMap);
            const context = { ...buildEvalContext(rawData, fieldPath), ...pathVarsMap };
            if (!evaluateCondition(processedCondition, context)) {
              return;
            }
          }
          filteredValues[f.name] = values[f.name];
        }
      }
    });

    // Add child node data
    node.childIds.forEach(childId => {
      const child = this.nodes.get(childId);
      if (!child) return;

      const childField = child.field;

      if (!ignoreConditions && rawData && childField.condition) {
        const childPath = this.getNodePathString(child);
        const pathVarsMap = {};
        const processedCondition = preprocessCondition(childField.condition, childPath, rawData, pathVarsMap);
        const context = { ...buildEvalContext(rawData, childPath), ...pathVarsMap };
        if (!evaluateCondition(processedCondition, context)) {
          return;
        }
      }

      if (childField.dynamicKeys) {
        if (!filteredValues[childField.name]) filteredValues[childField.name] = {};
        filteredValues[childField.name][child.instanceKey] = this.extractNodeValues(child, ignoreConditions, rawData, liveNodeId, liveValues);
      } else if (childField.type === 'array' && childField.itemType === 'object') {
        if (!filteredValues[childField.name]) filteredValues[childField.name] = [];
        filteredValues[childField.name].push(this.extractNodeValues(child, ignoreConditions, rawData, liveNodeId, liveValues));
      } else if (childField.type === 'object') {
        filteredValues[childField.name] = this.extractNodeValues(child, ignoreConditions, rawData, liveNodeId, liveValues);
      }
    });

    return filteredValues;
  }


  // ──────────────────────────────────────────────────────────
  // MISC
  // ──────────────────────────────────────────────────────────

  updateEmptyState() {
    const hasNonGlobal = [...this.nodes.keys()].some(id => id !== 'global');
    if (this.emptyState) {
      this.emptyState.style.display = hasNonGlobal ? 'none' : 'block';
    }
  }

  isMissingRequiredValue(value) {
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.trim() === '';
    return value === undefined || value === null;
  }

  getNodeValidation(node, cache = new Map(), rawData = null) {
    if (!node) return { invalid: false, issues: [] };
    if (cache.has(node.id)) return cache.get(node.id);

    if (!rawData) {
      rawData = this.toFormData(true);
    }

    const result = { invalid: false, issues: [] };
    cache.set(node.id, result);

    if (node.field.dynamicKeys && this.isMissingRequiredValue(node.instanceKey)) {
      result.issues.push('Nom de l’instance requis');
    }

    const nodePath = this.getNodePathString(node);

    (node.field.fields || []).forEach(subField => {
      if (subField.condition && rawData) {
        const fieldPath = nodePath ? `${nodePath}.${subField.name}` : subField.name;
        const pathVarsMap = {};
        const processedCondition = preprocessCondition(subField.condition, fieldPath, rawData, pathVarsMap);
        const context = { ...buildEvalContext(rawData, fieldPath), ...pathVarsMap };
        if (!evaluateCondition(processedCondition, context)) {
          return;
        }
      }

      if (isComplexField(subField)) {
        const children = [...node.childIds]
          .map(id => this.nodes.get(id))
          .filter(child => child && child.field.name === subField.name);
        const minimum = getFieldMinInstances(subField);
        if (subField.required && children.length === 0) {
          result.issues.push(`${subField.label || subField.name} requis`);
        } else if (minimum !== null && children.length < minimum) {
          result.issues.push(`${subField.label || subField.name} : minimum ${minimum} élément(s)`);
        }
      } else {
        result.issues.push(...getFieldConstraintIssues(subField, node.values[subField.name]));
      }
    });

    // Keep the node's own state separate: a missing field is shown on this
    // node and on its immediate visual parent, but not on all ancestors.
    result.ownInvalid = result.issues.length > 0;
    result.ownIssues = [...result.issues];

    [...node.childIds]
      .map(id => this.nodes.get(id))
      .filter(Boolean)
      .forEach(child => {
        const childResult = this.getNodeValidation(child, cache, rawData);
        if (childResult.ownInvalid) {
          result.issues.push(`${child.field.label || child.field.name} incomplet`);
        }
      });

    result.invalid = result.issues.length > 0;
    return result;
  }

  updateValidationState() {
    const cache = new Map();
    const rawData = this.toFormData(true);
    const rootFields = this.schema?.fields || [];
    const globalNode = this.nodes.get('global');

    [...this.nodes.values()].filter(node => node.id !== 'global').forEach(node => {
      const result = this.getNodeValidation(node, cache, rawData);
      node.el?.classList.toggle('has-required-error', result.invalid);
      syncInlineFieldValidation(node.el, node.field.fields, node.values, rawData, this.getNodePathString(node));
      if (node.el) {
        node.el.setAttribute('aria-invalid', String(result.invalid));
        node.el.removeAttribute('title');
        setGraphValidationIndicator(
          node.el.querySelector('.graph-node-heading'),
          result.invalid ? `Erreur de validation : ${result.issues.join(', ')}` : ''
        );
      }
      if (node.parentId) {
        const parentNode = this.nodes.get(node.parentId);
        const chip = parentNode?.el?.querySelector(`.graph-child-chip[data-child-id="${node.id}"]`);
        chip?.classList.toggle('has-required-error', result.invalid);
        if (chip) {
          chip.title = result.invalid ? '' : 'Cliquer ou double-cliquer pour configurer';
          setGraphValidationIndicator(
            chip,
            result.invalid ? `Erreur de validation : ${result.issues.join(', ')}` : ''
          );
        }
      }
    });

    // A collection can be invalid even when all existing child cards are
    // correct (for example: a required minimum of two configurations).
    this.groups.forEach(group => {
      if (group.field.condition && rawData) {
        const pathStr = group.field.name;
        const pathVarsMap = {};
        const processedCondition = preprocessCondition(group.field.condition, pathStr, rawData, pathVarsMap);
        const context = { ...buildEvalContext(rawData, pathStr), ...pathVarsMap };
        if (!evaluateCondition(processedCondition, context)) {
          group.el.classList.remove('has-required-error');
          setGraphValidationIndicator(group.el.querySelector('.graph-group-title'), '');
          return;
        }
      }

      const count = this.getFieldInstanceCount(group.field, group.parentId);
      const minimum = getFieldMinInstances(group.field);
      const isInvalid = (group.field.required && count === 0) ||
        (minimum !== null && count < minimum);
      group.el.classList.toggle('has-required-error', isInvalid);
      group.el.removeAttribute('title');
      setGraphValidationIndicator(
        group.el.querySelector('.graph-group-title'),
        isInvalid ? `Erreur de validation : ${group.field.label || group.field.name} : minimum ${minimum ?? 1} élément(s)` : ''
      );
    });

    if (!globalNode?.el) return;
    // The green node represents direct scalar fields of the current level.
    // Collection cardinality errors are shown by their dedicated group instead.
    const contextNode = this.currentParentId ? this.nodes.get(this.currentParentId) : null;
    const contextFields = contextNode ? (contextNode.field.fields || []) : rootFields;
    const contextValues = contextNode ? contextNode.values : globalNode.values;
    const contextPath = contextNode ? this.getNodePathString(contextNode) : '';

    const directIssues = contextFields
      .filter(field => !isComplexField(field))
      .filter(field => {
        if (field.condition && rawData) {
          const fieldPath = contextPath ? `${contextPath}.${field.name}` : field.name;
          const pathVarsMap = {};
          const processedCondition = preprocessCondition(field.condition, fieldPath, rawData, pathVarsMap);
          const context = { ...buildEvalContext(rawData, fieldPath), ...pathVarsMap };
          if (!evaluateCondition(processedCondition, context)) {
            return false;
          }
        }
        return true;
      })
      .flatMap(field => getFieldConstraintIssues(field, contextValues[field.name]));

    const invalid = directIssues.length > 0;
    globalNode.el.classList.toggle('has-required-error', invalid);
    syncInlineFieldValidation(globalNode.el, contextFields, contextValues, rawData, contextPath);
    globalNode.el.setAttribute('aria-invalid', String(invalid));
    globalNode.el.removeAttribute('title');
    setGraphValidationIndicator(
      globalNode.el.querySelector('.graph-node-heading'),
      invalid ? `Erreur de validation : ${directIssues.join(', ')}` : ''
    );
    this.updateValidationSummary(cache, rawData);
  }

  initValidationSummary() {
    this.validationSummary?.addEventListener('click', () => {
      const isOpen = !this.validationDetails.hidden;
      this.validationDetails.hidden = isOpen;
      this.validationSummary.setAttribute('aria-expanded', String(!isOpen));
    });
    this.validationDetails?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-validation-index]');
      if (!button) return;
      const issue = this.validationIssues[Number(button.dataset.validationIndex)];
      if (issue) this.goToValidationIssue(issue);
    });
  }

  goToValidationIssue(issue) {
    this.enterNode(issue.nodeId);
    this.validationDetails.hidden = true;
    this.validationSummary?.setAttribute('aria-expanded', 'false');
    if (!issue.fieldName) return;
    requestAnimationFrame(() => {
      const field = this.nodes.get('global')?.el?.querySelector(`[data-field-name="${issue.fieldName}"]`);
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field?.focus();
    });
  }

  updateValidationSummary(cache, rawData = null) {
    if (!this.validationSummary) return;
    if (!rawData) {
      rawData = this.toFormData(true);
    }
    const issues = [];
    const rootFields = this.schema?.fields || [];
    const globalNode = this.nodes.get('global');

    rootFields.forEach(field => {
      if (field.condition && rawData) {
        const pathStr = field.name;
        const pathVarsMap = {};
        const processedCondition = preprocessCondition(field.condition, pathStr, rawData, pathVarsMap);
        const context = { ...buildEvalContext(rawData, pathStr), ...pathVarsMap };
        if (!evaluateCondition(processedCondition, context)) {
          return;
        }
      }

      if (!isComplexField(field)) {
        getFieldConstraintIssues(field, globalNode?.values[field.name]).forEach(label => {
          issues.push({ label, nodeId: null, fieldName: field.name });
        });
      } else {
        const count = this.getFieldInstanceCount(field, null);
        const minimum = getFieldMinInstances(field);
        if (field.required && count === 0) {
          issues.push({ label: `${field.label || field.name} requis`, nodeId: null, fieldName: null });
        } else if (minimum !== null && count < minimum) {
          issues.push({ label: `${field.label || field.name} : minimum ${minimum} élément(s)`, nodeId: null, fieldName: null });
        }
      }
    });

    [...this.nodes.values()].filter(node => node.id !== 'global').forEach(node => {
      const result = cache.get(node.id) || this.getNodeValidation(node, cache, rawData);
      if (!result.ownInvalid) return;
      const name = node.instanceKey || node.field.label || node.field.name;
      const invalidSimpleFields = (node.field.fields || []).filter(field =>
        !isComplexField(field) && getFieldConstraintIssues(field, node.values[field.name]).length > 0
      );
      (result.ownIssues || result.issues).forEach(issue => {
        const field = invalidSimpleFields.find(candidate => getFieldConstraintIssues(candidate, node.values[candidate.name]).includes(issue));
        issues.push({
          label: `${name} : ${issue}`,
          nodeId: node.id,
          fieldName: field?.name || null,
        });
      });
    });

    this.validationIssues = issues;
    this.validationSummary.hidden = false;
    this.validationSummary.disabled = issues.length === 0;
    this.validationSummary.classList.toggle('is-clear', issues.length === 0);
    this.validationDetails.hidden = true;
    this.validationSummary.setAttribute('aria-expanded', 'false');
    const label = issues.length === 1
      ? '1 contrainte à corriger'
      : issues.length > 1 ? `${issues.length} contraintes à corriger` : 'Aucune erreur';
    this.validationSummary.querySelector('.graph-validation-summary-label').textContent = label;
    this.validationSummary.title = label;
    this.validationDetails.innerHTML = issues.length === 0 ? '' : `
      <div class="graph-validation-details-title">Contraintes à corriger</div>
      ${issues.map((issue, index) => `
        <div class="graph-validation-item">
          <span>${escapeHtml(issue.label)}</span>
          <button type="button" data-validation-index="${index}">Ouvrir</button>
        </div>`).join('')}`;
  }

  triggerOutputUpdate() {
    this.updateValidationState();
    // Dispatch event for app.js to pick up
    window.dispatchEvent(new CustomEvent('graph-data-changed'));
  }
}

// ══════════════════════════════════════════════════════════════
// MODE SWITCH — Integration with app.js
// ══════════════════════════════════════════════════════════════

let graphEngine = null;
let currentMode = 'graph';

function initGraphMode() {
  graphEngine = new GraphEngine();

  const btnForm = document.getElementById('btn-mode-form');
  const btnGraph = document.getElementById('btn-mode-graph');
  const mainView = document.getElementById('main-form-view');
  const graphView = document.getElementById('graph-view');

  if (!btnForm || !btnGraph) return;

  btnForm.addEventListener('click', () => switchToMode('form'));
  btnGraph.addEventListener('click', () => switchToMode('graph'));

  if (currentMode === 'graph' && typeof refreshGraphIfActive === 'function') {
    refreshGraphIfActive();
  }
}

function switchToMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  const btnForm = document.getElementById('btn-mode-form');
  const btnGraph = document.getElementById('btn-mode-graph');
  const mainView = document.getElementById('main-form-view');
  const graphView = document.getElementById('graph-view');

  if (mode === 'graph') {
    btnForm.classList.remove('active');
    btnGraph.classList.add('active');
    mainView.style.display = 'none';
    graphView.classList.add('active');

    // Init or reinit graph engine with current schema
    if (appSchema) {
      const schema = isMultiDoc ? appSchema[activeTabIndex].schema : appSchema;
      graphEngine.schema = schema;
      graphEngine.init(schema);

      // Create global node from simple fields
      const simpleFields = schema.fields ? schema.fields.filter(f => !isComplexField(f)) : [];
      graphEngine.createGlobalNode(simpleFields);

      // Import current form data
      const formData = extractFormData();
      graphEngine.fromFormData(formData, schema);

      // Mirror current format buttons
      graphEngine.updateGraphFormatButtons(currentFormat);

      // Initial output render
      setTimeout(() => updateGraphOutput(), 100);
    }
  } else {
    btnGraph.classList.remove('active');
    btnForm.classList.add('active');
    graphView.classList.remove('active');
    mainView.style.display = '';

    // Export graph data back to form
    if (graphEngine && appSchema) {
      const schema = isMultiDoc ? appSchema[activeTabIndex].schema : appSchema;
      const graphData = graphEngine.toFormData();
      renderForm(schema.fields, graphData);
      updateLiveOutput();
    }
  }
}

// Listen for graph data changes → update live output in graph output panel
window.addEventListener('graph-data-changed', () => {
  if (typeof markConfigDirty === 'function') markConfigDirty();
  if (currentMode !== 'graph' || !graphEngine) return;
  updateGraphOutput();
});

function updateGraphOutput() {
  if (!graphEngine || !appSchema) return;

  // Temporarily override extractFormData to pull from graph
  const graphData = graphEngine.toFormData();

  // Use the existing generateOutputText machinery by temporarily patching
  // form data extraction — we snapshot graph data and call generateOutputText
  const schema = isMultiDoc ? appSchema[activeTabIndex].schema : appSchema;
  if (!schema) return;

  let output = '';
  try {
    let formData = graphData;

    // Apply outputTemplate if present
    if (schema.outputTemplate) {
      try {
        formData = transformOutput(formData, schema.outputTemplate);
      } catch (e) {
        console.warn('[Graph] Transform error:', e);
      }
    }

    const keepEmpty = document.getElementById('chk-keep-empty')?.checked;
    if (!keepEmpty) {
      formData = cleanEmptyValues(formData);
    }

    switch (currentFormat) {
      case 'json':
        output = JSON.stringify(formData, null, 2);
        break;
      case 'hcl':
        output = toHCL(formData).trim() || '# Aucun champ configuré';
        break;
      case 'yaml':
      default:
        output = jsyaml.dump(formData, { indent: 2, noRefs: true, lineWidth: -1 });
        break;
    }
  } catch (e) {
    output = `# Erreur de génération: ${e.message}`;
  }

  const codeEl = document.getElementById('graph-code-output');
  if (codeEl) {
    codeEl.textContent = output;
    codeEl.className = `language-${currentFormat === 'hcl' ? 'hcl' : currentFormat}`;
    if (window.Prism) Prism.highlightElement(codeEl);
  }
}

// Initialize when DOM ready (called after app.js loads)
document.addEventListener('DOMContentLoaded', () => {
  initGraphMode();
});
