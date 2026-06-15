// State Management
let appSchema = null; // Can be a single schema object or an array of { tabName, schema }
let currentFormat = 'json';
let isMultiDoc = false;
let activeTabIndex = 0;
let tabDataCache = []; // Cache for form state per tab
let currentConfigMeta = null;

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

// Git branch selector elements
const elBranchSelectorContainer = document.getElementById('branch-selector-container');
const elSelectGitBranch = document.getElementById('select-git-branch');

// Format Buttons
const elFormatYaml = document.getElementById('format-yaml');
const elFormatJson = document.getElementById('format-json');
const elFormatHcl = document.getElementById('format-hcl');
const formatButtons = [elFormatYaml, elFormatJson, elFormatHcl];

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  loadConfig(false);

  // Set up event listeners
  elBtnRefresh.addEventListener('click', () => {
    if (confirm("Attention : Recharger le schéma va réinitialiser le formulaire et vous perdrez vos modifications actuelles. Voulez-vous continuer ?")) {
      branchesLoaded = false; // Reset branches cache on manual refresh
      loadConfig(true);
    }
  });
  elBtnCopy.addEventListener('click', copyToClipboard);
  elChkKeepEmpty.addEventListener('change', updateLiveOutput);

  // Import event listeners
  elBtnImport.addEventListener('click', toggleImportMode);
  elBtnCancelImport.addEventListener('click', toggleImportMode);
  elBtnApplyImport.addEventListener('click', applyImport);

  // Git branch selector
  elSelectGitBranch.addEventListener('change', () => {
    const selectedBranch = elSelectGitBranch.value;
    if (selectedBranch) {
      localStorage.setItem('active_git_branch', selectedBranch);
      loadConfig(true);
    }
  });


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
    const savedBranch = localStorage.getItem('active_git_branch');
    let url = '/api/config?';
    if (forceRefresh) url += 'refresh=true&';
    if (savedBranch) url += `branch=${encodeURIComponent(savedBranch)}&`;

    const response = await fetch(url);

    if (!response.ok) {
      const errRes = await response.json().catch(() => ({}));
      throw new Error(errRes.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to parse config');
    }

    isMultiDoc = !!result.isMultiDoc;
    currentConfigMeta = {
      source: result.source,
      sourceType: result.sourceType
    };

    if (result.sourceType === 'git') {
      elBranchSelectorContainer.style.display = 'flex';
      // Load branches list from API and set select element active option
      loadGitBranches(result.gitBranch || savedBranch);
    } else {
      elBranchSelectorContainer.style.display = 'none';
    }

    if (isMultiDoc) {
      appSchema = result.data; // Array of { tabName, schema }
      activeTabIndex = 0;
      tabDataCache = appSchema.map(tabItem => getDefaultValues(tabItem.schema.fields));

      const activeSchema = appSchema[activeTabIndex].schema;

      elTabBarContainer.style.display = 'flex';
      renderTabs();

      renderForm(activeSchema.fields);
    } else {
      appSchema = result.data; // Single schema object
      isMultiDoc = false;
      tabDataCache = [];

      elTabBarContainer.style.display = 'none';
      elTabBarContainer.innerHTML = '';

      renderForm(appSchema.fields);
    }

    updateAppHeader();

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
  updateAppHeader();

  // Re-render form with cached data
  renderForm(activeSchema.fields, tabDataCache[activeTabIndex]);

  updateLiveOutput();
}

function pathBasename(pathStr) {
  return pathStr.split(/[\\/]/).pop();
}

function updateAppHeader() {
  if (!appSchema) return;
  
  elAppTitle.textContent = "Formulaire de Configuration";
  
  const sourceName = currentConfigMeta ? pathBasename(currentConfigMeta.source) : '';
  const sourceTypeLabel = currentConfigMeta && currentConfigMeta.sourceType === 'git' ? 'Git' : 'Local';
  const sourceTypeClass = currentConfigMeta ? currentConfigMeta.sourceType : 'local';
  
  let schemaTitle = '';
  
  if (isMultiDoc) {
    const activeSchema = appSchema[activeTabIndex].schema;
    schemaTitle = activeSchema.title || 'Multi-documents';
  } else {
    schemaTitle = appSchema.title || 'Configuration';
  }
  
  let subtitleHtml = `Schéma : <strong>${schemaTitle}</strong>`;
  if (currentConfigMeta) {
    subtitleHtml += ` <span class="header-separator">•</span> Source : <span class="source-tag source-${sourceTypeClass}" title="${currentConfigMeta.source}">${sourceName} (${sourceTypeLabel})</span>`;
  }
  
  elAppDescription.innerHTML = subtitleHtml;
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

  // Add regex badge hint if field has regex validation
  if (field.validation && field.validation.regex) {
    const regexBadge = document.createElement('span');
    regexBadge.className = 'regex-hint-badge';
    regexBadge.textContent = 'regex';
    regexBadge.title = `Pattern: ${field.validation.regex}`;
    labelEl.appendChild(regexBadge);
  }

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
      if (field.dynamicKeys) {
        // Dynamic object keys: render as a list of named entries, each holding the same object shape.
        const objectContainer = document.createElement('div');
        objectContainer.className = 'array-container dynamic-object-container';
        objectContainer.dataset.dynamicObjectContainer = 'true';

        const entriesList = document.createElement('div');
        entriesList.className = 'array-items-list';
        entriesList.dataset.dynamicObjectEntriesList = 'true';

        const btnAddEntry = document.createElement('button');
        btnAddEntry.type = 'button';
        btnAddEntry.className = 'btn btn-secondary btn-sm';
        btnAddEntry.style.alignSelf = 'flex-start';
        btnAddEntry.textContent = 'Ajouter une entrée';

        let entryIndex = 0;
        const createEntryRow = (entryName = '', initialVal = null) => {
          const entryCard = document.createElement('div');
          entryCard.className = 'array-item-card dynamic-object-entry';
          entryCard.dataset.dynamicObjectEntryIndex = entryIndex;

          const entryContent = document.createElement('div');
          entryContent.className = 'array-item-content';

          const keyGroup = document.createElement('div');
          keyGroup.className = 'form-group dynamic-object-key-group';
          keyGroup.dataset.fieldName = 'key';
          keyGroup.dataset.fieldType = 'string';

          const keyLabel = document.createElement('label');
          keyLabel.className = 'form-label required';
          keyLabel.textContent = field.keyLabel || 'Nom de l\'objet';
          keyGroup.appendChild(keyLabel);

          const keyInput = document.createElement('input');
          keyInput.type = 'text';
          keyInput.className = 'form-control';
          keyInput.value = entryName;
          keyInput.required = true;
          keyInput.dataset.dynamicObjectKey = 'true';
          keyGroup.appendChild(keyInput);

          entryContent.appendChild(keyGroup);

          const valueGroup = document.createElement('div');
          valueGroup.className = 'nested-object-card dynamic-object-value';
          valueGroup.dataset.fieldName = 'value';
          valueGroup.dataset.fieldType = 'object';
          valueGroup.dataset.objectContainer = 'true';

          if (field.fields && Array.isArray(field.fields)) {
            field.fields.forEach(subField => {
              const subCachedVal = initialVal && initialVal[subField.name] !== undefined ? initialVal[subField.name] : undefined;
              const subEl = createFieldElement(subField, `${fieldPath}.${entryName || 'entry'}`, subCachedVal);
              if (subEl) {
                valueGroup.appendChild(subEl);
              }
            });
          } else {
            valueGroup.innerHTML = '<p class="array-empty-state">Objet vide</p>';
          }

          const btnRemove = document.createElement('button');
          btnRemove.type = 'button';
          btnRemove.className = 'btn-remove-item';
          btnRemove.title = 'Supprimer cette entrée';
          btnRemove.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          `;

          btnRemove.addEventListener('click', () => {
            entryCard.style.animation = 'fadeIn 0.2s reverse ease-out';
            setTimeout(() => {
              entryCard.remove();
              updateEmptyState();
              updateLiveOutput();
            }, 180);
          });

          entryCard.appendChild(entryContent);
          entryCard.appendChild(valueGroup);
          entryCard.appendChild(btnRemove);

          const newInputs = entryCard.querySelectorAll('input, select, textarea');
          newInputs.forEach(inp => {
            inp.addEventListener('input', updateLiveOutput);
            inp.addEventListener('change', updateLiveOutput);
          });

          entriesList.appendChild(entryCard);
          entryIndex++;
          updateEmptyState();
        };

        const updateEmptyState = () => {
          const emptyState = objectContainer.querySelector(':scope > [data-dynamic-object-empty-state="true"]');
          if (entriesList.children.length === 0) {
            if (!emptyState) {
              const empty = document.createElement('div');
              empty.className = 'array-empty-state';
              empty.dataset.dynamicObjectEmptyState = 'true';
              empty.textContent = 'Aucune entrée définie.';
              objectContainer.insertBefore(empty, btnAddEntry);
            }
          } else if (emptyState) {
            emptyState.remove();
          }
        };

        const objectValues = cachedVal !== undefined ? cachedVal : field.default;
        if (objectValues && typeof objectValues === 'object' && !Array.isArray(objectValues)) {
          Object.entries(objectValues).forEach(([entryName, entryValue]) => {
            createEntryRow(entryName, entryValue);
          });
        }

        btnAddEntry.addEventListener('click', () => {
          createEntryRow();
          updateLiveOutput();
        });

        objectContainer.appendChild(entriesList);
        objectContainer.appendChild(btnAddEntry);
        formGroup.appendChild(objectContainer);

        updateEmptyState();
      } else {
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
      }
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

      // Apply regex validation if defined
      if (field.validation && field.validation.regex) {
        txtInput.dataset.regexPattern = field.validation.regex;
        const validationMsg = field.validation.message || `Format invalide (regex: ${field.validation.regex})`;
        txtInput.dataset.regexMessage = validationMsg;

        const errEl = document.createElement('span');
        errEl.className = 'field-validation-error';
        errEl.setAttribute('aria-live', 'polite');
        errEl.style.display = 'none';
        errEl.textContent = validationMsg;

        const validateInput = () => {
          if (txtInput.value === '') {
            txtInput.classList.remove('input-invalid');
            errEl.style.display = 'none';
            return;
          }
          try {
            const rx = new RegExp(field.validation.regex);
            if (rx.test(txtInput.value)) {
              txtInput.classList.remove('input-invalid');
              errEl.style.display = 'none';
            } else {
              txtInput.classList.add('input-invalid');
              errEl.style.display = 'block';
            }
          } catch (e) {
            // invalid regex pattern — ignore silently
          }
        };

        txtInput.addEventListener('input', validateInput);
        txtInput.addEventListener('change', validateInput);
        // Run immediately for pre-filled values
        validateInput();

        formGroup.appendChild(txtInput);
        formGroup.appendChild(errEl);
      } else {
        formGroup.appendChild(txtInput);
      }
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
    const formGroup = elFormFieldsContainer.querySelector(`:scope > [data-field-name="${field.name}"]`);
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
      if (field.dynamicKeys) {
        const dynamicContainer = formGroup.querySelector(':scope > [data-dynamic-object-container="true"]');
        if (!dynamicContainer) return {};

        const dynamicData = {};
        const entryCards = dynamicContainer.querySelectorAll(':scope > [data-dynamic-object-entries-list="true"] > .dynamic-object-entry');
        entryCards.forEach(entryCard => {
          const keyInput = entryCard.querySelector(':scope .array-item-content [data-dynamic-object-key="true"]');
          const valueGroup = entryCard.querySelector(':scope > .dynamic-object-value');
          const entryKey = keyInput ? keyInput.value.trim() : '';

          if (!entryKey || !valueGroup) return;

          const entryValue = {};
          if (field.fields) {
            field.fields.forEach(subField => {
              const subGroup = valueGroup.querySelector(`:scope > [data-field-name="${subField.name}"]`);
              if (subGroup) {
                const val = extractFieldValue(subGroup, subField);
                if (val !== undefined) {
                  entryValue[subField.name] = val;
                }
              }
            });
          }

          dynamicData[entryKey] = entryValue;
        });

        return dynamicData;
      }

      const objectContainer = formGroup.querySelector(':scope > [data-object-container="true"]');
      if (!objectContainer || !field.fields) return {};

      const objData = {};
      field.fields.forEach(subField => {
        const subGroup = objectContainer.querySelector(`:scope > [data-field-name="${subField.name}"]`);
        if (subGroup) {
          const val = extractFieldValue(subGroup, subField);
          if (val !== undefined) {
            objData[subField.name] = val;
          }
        }
      });
      return objData;

    case 'array':
      const itemsList = formGroup.querySelector(':scope > .array-container > [data-array-items-list="true"]');
      if (!itemsList) return [];

      const itemCards = itemsList.querySelectorAll(':scope > .array-item-card');

      // Check if this is a map representation (key/value pairs)
      const isMap = field.itemType === 'object' &&
        field.fields && field.fields.length === 2 &&
        field.fields[0].name === 'key' &&
        field.fields[1].name === 'value';

      if (isMap) {
        const mapData = {};
        itemCards.forEach(itemCard => {
          const keyGroup = itemCard.querySelector(':scope > .array-item-content > [data-field-name="key"]');
          const valueGroup = itemCard.querySelector(':scope > .array-item-content > [data-field-name="value"]');
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
              const subGroup = itemCard.querySelector(`:scope > .array-item-content > [data-field-name="${subField.name}"]`);
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
          const valueGroup = itemCard.querySelector(':scope > .array-item-content > [data-field-name="value"]');
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

  const onSuccess = () => {
    const iconEl = elBtnCopy.querySelector('.icon-copy');
    if (iconEl) {
      iconEl.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
    }
    elBtnCopy.classList.add('btn-copied');

    setTimeout(() => {
      if (iconEl) {
        iconEl.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
      }
      elBtnCopy.classList.remove('btn-copied');
    }, 2000);
  };

  const onError = (err) => {
    console.error('Could not copy text: ', err);
    alert('Erreur lors de la copie dans le presse-papier.');
  };

  // navigator.clipboard requires a secure context (HTTPS or localhost)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(codeText).then(onSuccess).catch(onError);
  } else {
    // Fallback for HTTP contexts (e.g. container accessed via IP)
    try {
      const textarea = document.createElement('textarea');
      textarea.value = codeText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      onSuccess();
    } catch (err) {
      onError(err);
    }
  }
}

// Helper to pre-populate default schema values
function getDefaultValues(fields) {
  const defaults = {};
  if (!fields || !Array.isArray(fields)) return defaults;

  fields.forEach(field => {
    if (field.type === 'object') {
      if (field.dynamicKeys) {
        defaults[field.name] = field.default !== undefined ? field.default : {};
      } else {
        defaults[field.name] = getDefaultValues(field.fields);
      }
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

    const formGroup = elFormFieldsContainer.querySelector(`:scope > [data-field-name="${field.name}"]`);
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
        if (field.dynamicKeys) {
          const dynamicContainer = formGroup.querySelector(':scope > [data-dynamic-object-container="true"]');
          if (dynamicContainer && value && typeof value === 'object' && !Array.isArray(value)) {
            const entriesList = dynamicContainer.querySelector(':scope > [data-dynamic-object-entries-list="true"]');
            const addButton = dynamicContainer.querySelector(':scope > button');
            if (entriesList && addButton) {
              entriesList.innerHTML = '';
              Object.entries(value).forEach(([entryName, entryValue]) => {
                addButton.click();
                const entryCard = entriesList.lastElementChild;
                if (!entryCard) return;

                const keyInput = entryCard.querySelector(':scope .array-item-content [data-dynamic-object-key="true"]');
                if (keyInput) {
                  keyInput.value = entryName;
                }

                const valueGroup = entryCard.querySelector(':scope > .dynamic-object-value');
                if (valueGroup && field.fields && entryValue && typeof entryValue === 'object') {
                  field.fields.forEach(subField => {
                    const subValue = entryValue[subField.name];
                    if (subValue === undefined) return;
                    const subGroup = valueGroup.querySelector(`:scope > [data-field-name="${subField.name}"]`);
                    if (subGroup) {
                      populateFieldElement(subGroup, subField, subValue);
                    }
                  });
                }
              });
            }
          }
          break;
        }

        const objectContainer = formGroup.querySelector(':scope > [data-object-container="true"]');
        if (objectContainer && field.fields && typeof value === 'object') {
          // Recurse into nested objects
          field.fields.forEach(subField => {
            const subValue = value[subField.name];
            if (subValue === undefined) return;
            const subGroup = objectContainer.querySelector(`:scope > [data-field-name="${subField.name}"]`);
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
    case 'object':
      if (field.dynamicKeys) {
        const dynamicContainer = formGroup.querySelector(':scope > [data-dynamic-object-container="true"]');
        const entriesList = dynamicContainer ? dynamicContainer.querySelector(':scope > [data-dynamic-object-entries-list="true"]') : null;
        const addButton = dynamicContainer ? dynamicContainer.querySelector(':scope > button') : null;

        if (!dynamicContainer || !entriesList || !addButton || !value || typeof value !== 'object' || Array.isArray(value)) {
          break;
        }

        entriesList.innerHTML = '';
        Object.entries(value).forEach(([entryName, entryValue]) => {
          addButton.click();
          const entryCard = entriesList.lastElementChild;
          if (!entryCard) return;

          const keyInput = entryCard.querySelector(':scope .array-item-content [data-dynamic-object-key="true"]');
          if (keyInput) {
            keyInput.value = entryName;
          }

          const valueGroup = entryCard.querySelector(':scope > .dynamic-object-value');
          if (valueGroup && field.fields && entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)) {
            field.fields.forEach(subField => {
              const subValue = entryValue[subField.name];
              if (subValue === undefined) return;
              const subGroup = valueGroup.querySelector(`:scope > [data-field-name="${subField.name}"]`);
              if (subGroup) {
                populateFieldElement(subGroup, subField, subValue);
              }
            });
          }
        });
        break;
      }

      const objectContainer = formGroup.querySelector(':scope > [data-object-container="true"]');
      if (!objectContainer || !field.fields || !value || typeof value !== 'object' || Array.isArray(value)) {
        break;
      }

      field.fields.forEach(subField => {
        const subValue = value[subField.name];
        if (subValue === undefined) return;
        const subGroup = objectContainer.querySelector(`:scope > [data-field-name="${subField.name}"]`);
        if (subGroup) {
          populateFieldElement(subGroup, subField, subValue);
        }
      });
      break;

    case 'array': {
      const arrayContainer = formGroup.querySelector(':scope > .array-container');
      const itemsList = arrayContainer ? arrayContainer.querySelector(':scope > [data-array-items-list="true"]') : null;
      const addButton = arrayContainer ? arrayContainer.querySelector(':scope > button') : null;

      if (!arrayContainer || !itemsList || !addButton) {
        break;
      }

      const isMap = field.itemType === 'object' &&
        field.fields && field.fields.length === 2 &&
        field.fields[0].name === 'key' &&
        field.fields[1].name === 'value';

      let items = value;
      if (isMap && items && typeof items === 'object' && !Array.isArray(items)) {
        items = Object.entries(items).map(([k, v]) => ({ key: k, value: v }));
      }

      if (!Array.isArray(items)) {
        break;
      }

      itemsList.innerHTML = '';
      items.forEach(itemValue => {
        addButton.click();
        const itemCard = itemsList.lastElementChild;
        if (!itemCard) return;

        if (field.itemType === 'object') {
          if (!field.fields || !itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) {
            return;
          }

          field.fields.forEach(subField => {
            const subValue = itemValue[subField.name];
            if (subValue === undefined) return;
            const subGroup = itemCard.querySelector(`:scope > .array-item-content > [data-field-name="${subField.name}"]`);
            if (subGroup) {
              populateFieldElement(subGroup, subField, subValue);
            }
          });
        } else {
          const valueGroup = itemCard.querySelector(':scope > .array-item-content > [data-field-name="value"]');
          if (valueGroup) {
            populateFieldElement(valueGroup, { type: field.itemType || 'string' }, itemValue);
          }
        }
      });
      break;
    }
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

// ===== GIT BRANCH SELECTOR FUNCTIONALITY =====

let branchesLoaded = false;

async function loadGitBranches(activeBranch) {
  if (branchesLoaded) {
    if (activeBranch) elSelectGitBranch.value = activeBranch;
    return;
  }
  
  try {
    const response = await fetch('/api/branches');
    if (!response.ok) {
      throw new Error('Impossible de charger les branches/tags');
    }
    const result = await response.json();
    if (result.success && (Array.isArray(result.branches) || Array.isArray(result.tags))) {
      elSelectGitBranch.innerHTML = '';
      
      let branchToSelect = activeBranch;
      
      // Render Branches Group
      if (Array.isArray(result.branches) && result.branches.length > 0) {
        const branchesGroup = document.createElement('optgroup');
        branchesGroup.label = 'Branches';
        
        result.branches.forEach(branch => {
          const opt = document.createElement('option');
          opt.value = branch;
          opt.textContent = branch;
          branchesGroup.appendChild(opt);
        });
        elSelectGitBranch.appendChild(branchesGroup);
      }
      
      // Render Tags Group
      if (Array.isArray(result.tags) && result.tags.length > 0) {
        const tagsGroup = document.createElement('optgroup');
        tagsGroup.label = 'Tags / Versions';
        
        result.tags.forEach(tag => {
          const opt = document.createElement('option');
          opt.value = tag;
          opt.textContent = tag;
          tagsGroup.appendChild(opt);
        });
        elSelectGitBranch.appendChild(tagsGroup);
      }

      // Fallback selection
      if (!branchToSelect) {
        if (result.branches && result.branches.length > 0) {
          branchToSelect = result.branches[0];
        } else if (result.tags && result.tags.length > 0) {
          branchToSelect = result.tags[0];
        }
      }

      if (branchToSelect) {
        elSelectGitBranch.value = branchToSelect;
        localStorage.setItem('active_git_branch', branchToSelect);
      }
      branchesLoaded = true;
    }
  } catch (error) {
    console.error('Error fetching branches/tags:', error);
  }
}

