// State Management
let appSchema = null; // Can be a single schema object or an array of { tabName, schema }
let currentFormat = 'json';
let isMultiDoc = false;
let activeTabIndex = 0;
let tabDataCache = []; // Cache for form state per tab

// DOM Elements
const elAppTitle = document.getElementById('app-title');
const elAppDescription = document.getElementById('app-description');
const elConfigPath = document.getElementById('config-path');
const elSchemaStatus = document.getElementById('schema-status');
const elBtnRefresh = document.getElementById('btn-refresh');
const elFormFieldsContainer = document.getElementById('form-fields-container');
const elCodeOutput = document.getElementById('code-output');
const elBtnCopy = document.getElementById('btn-copy');
const elCopyText = document.getElementById('copy-text');
const elChkKeepEmpty = document.getElementById('chk-keep-empty');
const elTabBarContainer = document.getElementById('tab-bar-container');

// Import elements
const elBtnImport = document.getElementById('btn-import');
const elImportContainer = document.getElementById('import-container');
const elImportTextarea = document.getElementById('import-textarea');
const elBtnApplyImport = document.getElementById('btn-apply-import');
const elBtnCancelImport = document.getElementById('btn-cancel-import');
let importModeActive = false;

// Format Buttons
const elFormatYaml = document.getElementById('format-yaml');
const elFormatJson = document.getElementById('format-json');
const elFormatHcl = document.getElementById('format-hcl');
const formatButtons = [elFormatYaml, elFormatJson, elFormatHcl];

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  loadConfig(false);

  // Set up event listeners
  elBtnRefresh.addEventListener('click', () => loadConfig(true));
  elBtnCopy.addEventListener('click', copyToClipboard);
  elChkKeepEmpty.addEventListener('change', updateLiveOutput);

  // Import event listeners
  elBtnImport.addEventListener('click', toggleImportMode);
  elBtnCancelImport.addEventListener('click', toggleImportMode);
  elBtnApplyImport.addEventListener('click', applyImport);

  formatButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setFormat(btn.dataset.format);
    });
  });
});

// Load Config Schema from Backend API
async function loadConfig(forceRefresh = false) {
  setLoadingState(true);
  try {
    const url = forceRefresh ? '/api/config?refresh=true' : '/api/config';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to parse config');
    }

    isMultiDoc = !!result.isMultiDoc;

    if (isMultiDoc) {
      appSchema = result.data; // Array of { tabName, schema }
      activeTabIndex = 0;
      tabDataCache = appSchema.map(tabItem => getDefaultValues(tabItem.schema.fields));

      const activeSchema = appSchema[activeTabIndex].schema;
      elAppTitle.textContent = activeSchema.title || 'Formulaire Dynamique';
      elAppDescription.textContent = activeSchema.description || `Configuration multi-documents`;

      elTabBarContainer.style.display = 'flex';
      renderTabs();

      renderForm(activeSchema.fields);
    } else {
      appSchema = result.data; // Single schema object
      isMultiDoc = false;
      tabDataCache = [];

      elAppTitle.textContent = appSchema.title || 'Formulaire Dynamique';
      elAppDescription.textContent = appSchema.description || `Configuré depuis ${pathBasename(result.source)}`;

      elTabBarContainer.style.display = 'none';
      elTabBarContainer.innerHTML = '';

      renderForm(appSchema.fields);
    }

    elConfigPath.textContent = result.source;
    updateFormatButtons();

    // Trigger initial generation of output
    updateLiveOutput();

    setStatus('Prêt', 'green');
  } catch (error) {
    console.error('Error loading schema:', error);
    setStatus('Erreur de chargement', 'orange');
    elFormFieldsContainer.innerHTML = `
      <div class="loading-spinner-container">
        <div class="icon" style="font-size: 40px; color: var(--color-danger)">⚠️</div>
        <p style="color: var(--color-danger); font-weight: 600;">Erreur de chargement du schéma</p>
        <p class="form-desc">${error.message}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadConfig(false)">Réessayer</button>
      </div>
    `;
  } finally {
    setLoadingState(false);
  }
}

// Render tabs for multi-doc YAML
function renderTabs() {
  elTabBarContainer.innerHTML = '';
  if (!isMultiDoc || !appSchema) return;

  appSchema.forEach((tabItem, index) => {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'tab-btn';
    if (index === activeTabIndex) {
      tabBtn.classList.add('active');
    }
    tabBtn.textContent = tabItem.tabName;
    tabBtn.addEventListener('click', () => switchTab(index));
    elTabBarContainer.appendChild(tabBtn);
  });
}

// Switch between dynamic schemas
function switchTab(newIndex) {
  if (newIndex === activeTabIndex) return;

  // Save current form state to cache
  tabDataCache[activeTabIndex] = extractFormData();

  activeTabIndex = newIndex;

  // Refresh tab buttons
  renderTabs();

  const activeSchema = appSchema[activeTabIndex].schema;
  elAppTitle.textContent = activeSchema.title || 'Formulaire Dynamique';
  elAppDescription.textContent = activeSchema.description || `Configuration multi-documents`;

  // Re-render form with cached data
  renderForm(activeSchema.fields, tabDataCache[activeTabIndex]);

  updateLiveOutput();
}

function pathBasename(pathStr) {
  return pathStr.split(/[\\/]/).pop();
}

function setLoadingState(isLoading) {
  if (isLoading) {
    elBtnRefresh.classList.add('loading-spin');
    elBtnRefresh.disabled = true;
  } else {
    elBtnRefresh.classList.remove('loading-spin');
    elBtnRefresh.disabled = false;
  }
}

function setStatus(text, colorClass) {
  elSchemaStatus.textContent = text;
  const dot = elSchemaStatus.previousElementSibling;
  dot.className = `status-dot ${colorClass}`;
}

// Set Output Format (YAML / JSON / HCL)
function setFormat(format) {
  currentFormat = format;
  updateFormatButtons();

  // Update class of code output for Prism
  elCodeOutput.className = `language-${format === 'hcl' ? 'hcl' : format}`;

  updateLiveOutput();
}

function updateFormatButtons() {
  formatButtons.forEach(btn => {
    if (btn.dataset.format === currentFormat) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Generate the Dynamic Form
function renderForm(fields, cache = null) {
  elFormFieldsContainer.innerHTML = '';

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    elFormFieldsContainer.innerHTML = '<p class="array-empty-state">Aucun champ défini dans la configuration.</p>';
    return;
  }

  fields.forEach(field => {
    const cachedVal = cache && cache[field.name] !== undefined ? cache[field.name] : undefined;
    const fieldElement = createFieldElement(field, '', cachedVal);
    if (fieldElement) {
      elFormFieldsContainer.appendChild(fieldElement);
    }
  });

  // Attach event listener to detect live changes
  const inputs = elFormFieldsContainer.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    input.addEventListener('input', updateLiveOutput);
    input.addEventListener('change', updateLiveOutput);
  });
}

// Create individual form control wrapper based on field configuration
function createFieldElement(field, parentPath = '', cachedVal = undefined) {
  const fieldPath = parentPath ? `${parentPath}.${field.name}` : field.name;

  const formGroup = document.createElement('div');
  formGroup.className = 'form-group';
  formGroup.dataset.fieldName = field.name;
  formGroup.dataset.fieldType = field.type;

  // Create label and description header
  const labelContainer = document.createElement('div');
  labelContainer.className = 'form-label-container';

  const labelEl = document.createElement('label');
  labelEl.className = 'form-label';
  if (field.required) {
    labelEl.classList.add('required');
  }
  labelEl.textContent = field.label || field.name;

  labelContainer.appendChild(labelEl);
  formGroup.appendChild(labelContainer);

  if (field.description) {
    const descEl = document.createElement('p');
    descEl.className = 'form-desc';
    descEl.textContent = field.description;
    formGroup.appendChild(descEl);
  }

  // Render based on field type
  switch (field.type) {
    case 'boolean':
      formGroup.classList.remove('form-group');
      formGroup.className = 'switch-container';
      formGroup.dataset.fieldName = field.name;
      formGroup.dataset.fieldType = field.type;

      // Re-structure switch container layout
      formGroup.innerHTML = '';

      const labelWrapper = document.createElement('div');
      labelWrapper.className = 'switch-label-wrapper';

      const switchLabel = document.createElement('span');
      switchLabel.className = 'form-label';
      switchLabel.textContent = field.label || field.name;
      labelWrapper.appendChild(switchLabel);

      if (field.description) {
        const switchDesc = document.createElement('span');
        switchDesc.className = 'form-desc';
        switchDesc.textContent = field.description;
        labelWrapper.appendChild(switchDesc);
      }

      formGroup.appendChild(labelWrapper);

      const switchEl = document.createElement('label');
      switchEl.className = 'switch';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = fieldPath;
      checkbox.checked = cachedVal !== undefined ? cachedVal : (field.default !== undefined ? field.default : false);
      checkbox.dataset.fieldBind = 'boolean';

      const slider = document.createElement('span');
      slider.className = 'slider';

      switchEl.appendChild(checkbox);
      switchEl.appendChild(slider);
      formGroup.appendChild(switchEl);
      break;

    case 'select':
      const select = document.createElement('select');
      select.className = 'form-control';
      select.name = fieldPath;
      select.required = !!field.required;
      select.dataset.fieldBind = 'select';

      // Add empty option at the top if the field is not required
      if (!field.required) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '-- Non spécifié (optionnel) --';
        select.appendChild(emptyOption);
      }

      if (field.options && Array.isArray(field.options)) {
        field.options.forEach(opt => {
          const option = document.createElement('option');
          if (typeof opt === 'object') {
            option.value = opt.value;
            option.textContent = opt.label || opt.value;
          } else {
            option.value = opt;
            option.textContent = opt;
          }
          select.appendChild(option);
        });
      }

      const finalSelectVal = cachedVal !== undefined ? cachedVal : (field.default !== undefined ? field.default : '');
      select.value = finalSelectVal;
      formGroup.appendChild(select);
      break;

    case 'integer':
    case 'number':
      const numInput = document.createElement('input');
      numInput.type = 'number';
      numInput.className = 'form-control';
      numInput.name = fieldPath;
      numInput.required = !!field.required;
      numInput.dataset.fieldBind = field.type;

      if (field.type === 'integer') {
        numInput.step = '1';
      } else {
        numInput.step = 'any';
      }

      const finalNumVal = cachedVal !== undefined ? cachedVal : (field.default !== undefined ? field.default : '');
      numInput.value = finalNumVal;
      formGroup.appendChild(numInput);
      break;

    case 'object':
      // Nested fields container
      const objectCard = document.createElement('div');
      objectCard.className = 'nested-object-card';
      objectCard.dataset.objectContainer = 'true';

      if (field.fields && Array.isArray(field.fields)) {
        field.fields.forEach(subField => {
          const subCachedVal = cachedVal && cachedVal[subField.name] !== undefined ? cachedVal[subField.name] : undefined;
          const subEl = createFieldElement(subField, fieldPath, subCachedVal);
          if (subEl) {
            objectCard.appendChild(subEl);
          }
        });
      } else {
        objectCard.innerHTML = '<p class="array-empty-state">Objet vide</p>';
      }

      formGroup.appendChild(objectCard);
      break;

    case 'array':
      // Array elements container
      const arrayContainer = document.createElement('div');
      arrayContainer.className = 'array-container';

      const itemsList = document.createElement('div');
      itemsList.className = 'array-items-list';
      itemsList.dataset.arrayItemsList = 'true';

      const btnAdd = document.createElement('button');
      btnAdd.type = 'button';
      btnAdd.className = 'btn btn-secondary btn-sm';
      btnAdd.style.alignSelf = 'flex-start';
      btnAdd.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Ajouter un élément
      `;

      // Handle array items creation
      let itemIndex = 0;
      const createItemRow = (initialVal = null) => {
        const itemCard = document.createElement('div');
        itemCard.className = 'array-item-card';
        itemCard.dataset.arrayItemIndex = itemIndex;

        const itemContent = document.createElement('div');
        itemContent.className = 'array-item-content';

        // Render inputs depending on itemType
        const uniquePath = `${fieldPath}[${itemIndex}]`;

        if (field.itemType === 'object') {
          // Object item: Render each subfield inside the item card
          itemCard.dataset.itemKind = 'object';
          if (field.fields && Array.isArray(field.fields)) {
            field.fields.forEach(subField => {
              // Copy field configuration, set unique name and load default/initial value
              const itemSubField = { ...subField };
              if (initialVal && initialVal[subField.name] !== undefined) {
                itemSubField.default = initialVal[subField.name];
              }
              const subEl = createFieldElement(itemSubField, uniquePath);
              if (subEl) {
                itemContent.appendChild(subEl);
              }
            });
          }
        } else {
          // Primitive item (string, number, integer, boolean)
          itemCard.dataset.itemKind = 'primitive';
          const primitiveField = {
            name: 'value',
            label: 'Valeur',
            type: field.itemType || 'string',
            required: true,
            default: initialVal !== null ? initialVal : ''
          };
          const primEl = createFieldElement(primitiveField, uniquePath);
          if (primEl) {
            // Remove label for cleaner array display
            const lbl = primEl.querySelector('.form-label-container');
            if (lbl) lbl.remove();
            itemContent.appendChild(primEl);
          }
        }

        const btnRemove = document.createElement('button');
        btnRemove.type = 'button';
        btnRemove.className = 'btn-remove-item';
        btnRemove.title = 'Supprimer cet élément';
        btnRemove.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        `;

        btnRemove.addEventListener('click', () => {
          itemCard.style.animation = 'fadeIn 0.2s reverse ease-out';
          setTimeout(() => {
            itemCard.remove();
            updateEmptyState();
            updateLiveOutput();
          }, 180);
        });

        itemCard.appendChild(itemContent);
        itemCard.appendChild(btnRemove);

        // Listen to dynamic inputs inside new row
        const newInputs = itemCard.querySelectorAll('input, select, textarea');
        newInputs.forEach(inp => {
          inp.addEventListener('input', updateLiveOutput);
          inp.addEventListener('change', updateLiveOutput);
        });

        itemsList.appendChild(itemCard);
        itemIndex++;

        updateEmptyState();
      };

      const updateEmptyState = () => {
        const emptyState = arrayContainer.querySelector('.array-empty-state');
        if (itemsList.children.length === 0) {
          if (!emptyState) {
            const empty = document.createElement('div');
            empty.className = 'array-empty-state';
            empty.textContent = 'Aucun élément saisi.';
            arrayContainer.insertBefore(empty, btnAdd);
          }
        } else if (emptyState) {
          emptyState.remove();
        }
      };

      // Load initial array defaults if present (handle map array formats)
      const arrayValues = cachedVal !== undefined ? cachedVal : field.default;
      if (arrayValues) {
        let displayValues = arrayValues;
        const isMap = field.itemType === 'object' &&
          field.fields && field.fields.length === 2 &&
          field.fields[0].name === 'key' &&
          field.fields[1].name === 'value';

        if (isMap && displayValues && typeof displayValues === 'object' && !Array.isArray(displayValues)) {
          displayValues = Object.entries(displayValues).map(([k, v]) => ({ key: k, value: v }));
        }

        if (Array.isArray(displayValues)) {
          displayValues.forEach(val => createItemRow(val));
        }
      }

      btnAdd.addEventListener('click', () => {
        createItemRow();
        updateLiveOutput();
      });

      arrayContainer.appendChild(itemsList);
      arrayContainer.appendChild(btnAdd);
      formGroup.appendChild(arrayContainer);

      updateEmptyState();
      break;

    case 'string':
    default:
      const txtInput = document.createElement('input');
      txtInput.type = 'text';
      txtInput.className = 'form-control';
      txtInput.name = fieldPath;
      txtInput.required = !!field.required;
      txtInput.dataset.fieldBind = 'string';

      const finalTxtVal = cachedVal !== undefined ? cachedVal : (field.default !== undefined ? field.default : '');
      txtInput.value = finalTxtVal;
      formGroup.appendChild(txtInput);
      break;
  }

  return formGroup;
}

// Recursively traverse and extract data from DOM tree matching form fields
function extractFormData() {
  const activeSchema = isMultiDoc ? appSchema[activeTabIndex].schema : appSchema;
  if (!activeSchema || !activeSchema.fields) return {};

  const data = {};

  activeSchema.fields.forEach(field => {
    // Find the root form group for this field
    const formGroup = elFormFieldsContainer.querySelector(`[data-field-name="${field.name}"]`);
    if (formGroup) {
      data[field.name] = extractFieldValue(formGroup, field);
    }
  });

  return data;
}

function extractFieldValue(formGroup, field) {
  switch (field.type) {
    case 'boolean':
      const cb = formGroup.querySelector('input[type="checkbox"]');
      return cb ? cb.checked : false;

    case 'select':
      const sel = formGroup.querySelector('select');
      return sel ? sel.value : '';

    case 'integer':
      const intInput = formGroup.querySelector('input[type="number"]');
      return intInput && intInput.value !== '' ? parseInt(intInput.value, 10) : undefined;

    case 'number':
      const numInput = formGroup.querySelector('input[type="number"]');
      return numInput && numInput.value !== '' ? parseFloat(numInput.value) : undefined;

    case 'string':
      const txtInput = formGroup.querySelector('input[type="text"]');
      return txtInput ? txtInput.value : '';

    case 'object':
      const objectContainer = formGroup.querySelector('[data-object-container="true"]');
      if (!objectContainer || !field.fields) return {};

      const objData = {};
      field.fields.forEach(subField => {
        const subGroup = objectContainer.querySelector(`[data-field-name="${subField.name}"]`);
        if (subGroup) {
          const val = extractFieldValue(subGroup, subField);
          if (val !== undefined) {
            objData[subField.name] = val;
          }
        }
      });
      return objData;

    case 'array':
      const itemsList = formGroup.querySelector('[data-array-items-list="true"]');
      if (!itemsList) return [];

      const itemCards = itemsList.querySelectorAll('.array-item-card');

      // Check if this is a map representation (key/value pairs)
      const isMap = field.itemType === 'object' &&
        field.fields && field.fields.length === 2 &&
        field.fields[0].name === 'key' &&
        field.fields[1].name === 'value';

      if (isMap) {
        const mapData = {};
        itemCards.forEach(itemCard => {
          const keyGroup = itemCard.querySelector('[data-field-name="key"]');
          const valueGroup = itemCard.querySelector('[data-field-name="value"]');
          if (keyGroup && valueGroup) {
            const k = extractFieldValue(keyGroup, { type: 'string' });
            const v = extractFieldValue(valueGroup, { type: field.fields[1].type || 'string' });
            if (k) {
              mapData[k] = v;
            }
          }
        });
        return mapData;
      }

      const arrayData = [];
      itemCards.forEach(itemCard => {
        if (itemCard.dataset.itemKind === 'object') {
          // Object item in array
          const itemVal = {};
          if (field.fields) {
            field.fields.forEach(subField => {
              const subGroup = itemCard.querySelector(`[data-field-name="${subField.name}"]`);
              if (subGroup) {
                const val = extractFieldValue(subGroup, subField);
                if (val !== undefined) {
                  itemVal[subField.name] = val;
                }
              }
            });
          }
          arrayData.push(itemVal);
        } else {
          // Primitive item in array (has a wrapper div with data-field-name="value")
          const valueGroup = itemCard.querySelector('[data-field-name="value"]');
          if (valueGroup) {
            const primitiveField = { type: field.itemType || 'string' };
            const val = extractFieldValue(valueGroup, primitiveField);
            if (val !== undefined) {
              arrayData.push(val);
            }
          }
        }
      });
      return arrayData;

    default:
      const fallbackInput = formGroup.querySelector('input');
      return fallbackInput ? fallbackInput.value : '';
  }
}

// Convert JSON object data to HCL (HashiCorp Configuration Language) format
function toHCL(obj, indent = 0) {
  const spaces = '  '.repeat(indent);
  let hcl = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) {
      continue;
    }

    const hclKey = key;

    if (typeof value === 'boolean') {
      hcl += `${spaces}${hclKey} = ${value}\n`;
    } else if (typeof value === 'number') {
      hcl += `${spaces}${hclKey} = ${value}\n`;
    } else if (typeof value === 'string') {
      hcl += `${spaces}${hclKey} = "${escapeHclString(value)}"\n`;
    } else if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        // Output array of objects as HCL list of blocks
        hcl += `${spaces}${hclKey} = [\n`;
        value.forEach((item, index) => {
          hcl += `${spaces}  {\n`;
          hcl += toHCL(item, indent + 2);
          hcl += `${spaces}  }${index < value.length - 1 ? ',' : ''}\n`;
        });
        hcl += `${spaces}]\n`;
      } else {
        // Output array of primitives as HCL list
        const itemsStr = value.map(val => {
          if (typeof val === 'string') return `"${escapeHclString(val)}"`;
          return val;
        }).join(', ');
        hcl += `${spaces}${hclKey} = [${itemsStr}]\n`;
      }
    } else if (typeof value === 'object') {
      // Output object as HCL assignment block
      hcl += `${spaces}${hclKey} = {\n`;
      hcl += toHCL(value, indent + 1);
      hcl += `${spaces}}\n`;
    }
  }
  return hcl;
}

function escapeHclString(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// Clean empty strings, empty arrays, and empty objects recursively
function cleanEmptyValues(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map(item => (item && typeof item === 'object') ? cleanEmptyValues(item) : item)
      .filter(item => {
        if (item === undefined || item === null || item === '') return false;
        if (Array.isArray(item) && item.length === 0) return false;
        if (typeof item === 'object' && Object.keys(item).length === 0) return false;
        return true;
      });
  } else if (typeof obj === 'object' && obj !== null) {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (Array.isArray(value) && value.length === 0) {
        continue;
      }
      if (typeof value === 'object') {
        const cleanedVal = cleanEmptyValues(value);
        if (cleanedVal === undefined || cleanedVal === null) continue;
        if (Array.isArray(cleanedVal) && cleanedVal.length === 0) continue;
        if (typeof cleanedVal === 'object' && Object.keys(cleanedVal).length === 0) continue;
        cleaned[key] = cleanedVal;
        continue;
      }
      cleaned[key] = value;
    }
    return cleaned;
  }
  return obj;
}

// Refresh code output panel
function updateLiveOutput() {
  if (!appSchema) return;

  // Update cache for the active tab with current values
  if (isMultiDoc) {
    tabDataCache[activeTabIndex] = extractFormData();
  }

  let formData = extractFormData();

  // Clean empty values if checkbox is not checked
  if (elChkKeepEmpty && !elChkKeepEmpty.checked) {
    formData = cleanEmptyValues(formData);
  }

  let formattedText = '';

  try {
    switch (currentFormat) {
      case 'json':
        formattedText = JSON.stringify(formData, null, 2);
        break;
      case 'hcl':
        formattedText = toHCL(formData).trim();
        if (formattedText === '') {
          formattedText = '# Aucun champ configuré';
        }
        break;
      case 'yaml':
      default:
        // Use the loaded jsyaml library to dump
        formattedText = jsyaml.dump(formData, {
          indent: 2,
          noRefs: true,
          lineWidth: -1
        });
        break;
    }
  } catch (err) {
    formattedText = `# Erreur de formatage : ${err.message}`;
  }

  elCodeOutput.textContent = formattedText;

  // Highlight syntax using Prism
  Prism.highlightElement(elCodeOutput);
}

// Copy to Clipboard Action
function copyToClipboard() {
  const codeText = elCodeOutput.textContent;
  if (!codeText) return;

  navigator.clipboard.writeText(codeText).then(() => {
    // Show success state
    const originalText = elCopyText.textContent;
    elCopyText.textContent = 'Copié !';
    elBtnCopy.classList.add('btn-success');

    // Reset after 2 seconds
    setTimeout(() => {
      elCopyText.textContent = originalText;
      elBtnCopy.classList.remove('btn-success');
    }, 2000);
  }).catch(err => {
    console.error('Could not copy text: ', err);
    alert('Erreur lors de la copie dans le presse-papier.');
  });
}

// Helper to pre-populate default schema values
function getDefaultValues(fields) {
  const defaults = {};
  if (!fields || !Array.isArray(fields)) return defaults;

  fields.forEach(field => {
    if (field.type === 'object') {
      defaults[field.name] = getDefaultValues(field.fields);
    } else if (field.type === 'array') {
      if (field.default !== undefined) {
        defaults[field.name] = field.default;
      } else {
        defaults[field.name] = [];
      }
    } else {
      if (field.default !== undefined) {
        defaults[field.name] = field.default;
      }
    }
  });
  return defaults;
}

// ===== IMPORT FUNCTIONALITY =====

function toggleImportMode() {
  importModeActive = !importModeActive;
  if (importModeActive) {
    elImportContainer.style.display = 'block';
    elBtnImport.classList.add('active');
    elImportTextarea.value = '';
    elImportTextarea.focus();
  } else {
    elImportContainer.style.display = 'none';
    elBtnImport.classList.remove('active');
    elImportTextarea.value = '';
  }
}

function applyImport() {
  const rawText = elImportTextarea.value.trim();
  if (!rawText) {
    alert('Veuillez coller une configuration à importer.');
    return;
  }

  let parsedData = null;

  // Try JSON first
  try {
    parsedData = JSON.parse(rawText);
  } catch (e) { /* not JSON */ }

  // Try YAML
  if (!parsedData) {
    try {
      const yamlResult = jsyaml.load(rawText);
      if (yamlResult && typeof yamlResult === 'object') {
        parsedData = yamlResult;
      }
    } catch (e) { /* not YAML */ }
  }

  // Try HCL/tfvars
  if (!parsedData) {
    try {
      parsedData = parseTfvars(rawText);
      if (parsedData && Object.keys(parsedData).length === 0) {
        parsedData = null;
      }
    } catch (e) { /* not HCL */ }
  }

  if (!parsedData || typeof parsedData !== 'object') {
    alert('Impossible de parser l\'entrée. Formats supportés : JSON, YAML, HCL/tfvars.');
    return;
  }

  // Populate the form with parsed data
  const activeSchema = isMultiDoc ? appSchema[activeTabIndex].schema : appSchema;
  if (activeSchema && activeSchema.fields) {
    populateFormFromData(parsedData, activeSchema.fields);
  }

  // Update cache & live output
  if (isMultiDoc) {
    tabDataCache[activeTabIndex] = extractFormData();
  }
  updateLiveOutput();

  // Close import panel
  toggleImportMode();
}

// Populate form fields from imported data object
function populateFormFromData(data, fields) {
  if (!data || !fields) return;

  fields.forEach(field => {
    const value = data[field.name];
    if (value === undefined) return;

    const formGroup = elFormFieldsContainer.querySelector(`[data-field-name="${field.name}"]`);
    if (!formGroup) return;

    switch (field.type) {
      case 'boolean':
        const cb = formGroup.querySelector('input[type="checkbox"]');
        if (cb) {
          cb.checked = !!value;
        }
        break;

      case 'select':
        const sel = formGroup.querySelector('select');
        if (sel) {
          sel.value = String(value);
        }
        break;

      case 'integer':
      case 'number':
        const numInput = formGroup.querySelector('input[type="number"]');
        if (numInput) {
          numInput.value = value;
        }
        break;

      case 'string':
        const txtInput = formGroup.querySelector('input[type="text"]');
        if (txtInput) {
          txtInput.value = String(value);
        }
        break;

      case 'object':
        const objectContainer = formGroup.querySelector('[data-object-container="true"]');
        if (objectContainer && field.fields && typeof value === 'object') {
          // Recurse into nested objects
          field.fields.forEach(subField => {
            const subValue = value[subField.name];
            if (subValue === undefined) return;
            const subGroup = objectContainer.querySelector(`[data-field-name="${subField.name}"]`);
            if (!subGroup) return;
            populateFieldElement(subGroup, subField, subValue);
          });
        }
        break;

      case 'array':
        // For arrays, we need to re-render the form with cached data
        // The simplest approach: inject into cache and re-render
        if (isMultiDoc) {
          if (!tabDataCache[activeTabIndex]) tabDataCache[activeTabIndex] = {};
          tabDataCache[activeTabIndex][field.name] = value;
        }
        break;
    }
  });

  // For arrays, we need to re-render the form to pick up the new array values
  const hasArrays = fields.some(f => f.type === 'array');
  if (hasArrays) {
    const activeSchema = isMultiDoc ? appSchema[activeTabIndex].schema : appSchema;
    // Build merged cache: existing form data + imported array data
    const currentFormData = extractFormData();
    const mergedData = { ...currentFormData };
    fields.forEach(field => {
      if (field.type === 'array' && data[field.name] !== undefined) {
        mergedData[field.name] = data[field.name];
      }
    });
    renderForm(activeSchema.fields, mergedData);
  }
}

// Helper to populate a single field element
function populateFieldElement(formGroup, field, value) {
  switch (field.type) {
    case 'boolean':
      const cb = formGroup.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = !!value;
      break;
    case 'select':
      const sel = formGroup.querySelector('select');
      if (sel) sel.value = String(value);
      break;
    case 'integer':
    case 'number':
      const numInput = formGroup.querySelector('input[type="number"]');
      if (numInput) numInput.value = value;
      break;
    case 'string':
    default:
      const txtInput = formGroup.querySelector('input[type="text"]');
      if (txtInput) txtInput.value = String(value);
      break;
  }
}

// Parse HCL / tfvars format (simple key=value assignments)
function parseTfvars(text) {
  const result = {};
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      i++;
      continue;
    }

    // Match key = value pattern
    const match = line.match(/^([\w-]+)\s*=\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    let valueStr = match[2].trim();

    // Handle multi-line blocks: { ... } or [ ... ]
    if (valueStr === '{' || valueStr === '[') {
      const openChar = valueStr;
      const closeChar = openChar === '{' ? '}' : ']';
      let depth = 1;
      let block = valueStr + '\n';
      i++;

      while (i < lines.length && depth > 0) {
        const bline = lines[i];
        for (const ch of bline) {
          if (ch === openChar.charAt(0) || (openChar === '{' && ch === '{') || (openChar === '[' && ch === '[')) depth++;
          if (ch === closeChar) depth--;
        }
        block += bline + '\n';
        i++;
      }

      // Try parsing the block as JSON-like
      try {
        result[key] = JSON.parse(block.replace(/([\w-]+)\s*=/g, '"$1":').replace(/,\s*([}\]])/g, '$1'));
      } catch {
        result[key] = block.trim();
      }
      continue;
    }

    // Handle quoted strings
    if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
      result[key] = valueStr.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    }
    // Handle booleans
    else if (valueStr === 'true') {
      result[key] = true;
    } else if (valueStr === 'false') {
      result[key] = false;
    }
    // Handle numbers
    else if (!isNaN(valueStr) && valueStr !== '') {
      result[key] = Number(valueStr);
    }
    // Handle simple lists on one line ["a", "b"]
    else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
      try {
        result[key] = JSON.parse(valueStr);
      } catch {
        result[key] = valueStr;
      }
    }
    // Default: treat as string
    else {
      result[key] = valueStr;
    }

    i++;
  }

  return result;
}
