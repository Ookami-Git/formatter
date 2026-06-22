/**
 * Custom Terraform variables.tf (HCL) Parser
 * Translates HCL variable definitions into JSON Form Schema.
 */



function parseTerraformVariables(hclText) {
  const fields = [];
  const warnings = [];
  
  // Regex to find variable blocks: variable "name" { ... }
  // Supports optional quotes around the variable name: variable name { ... }
  const regex = /variable\s+["']?([\w-]+)["']?\s*\{/g;
  let match;
  
  while ((match = regex.exec(hclText)) !== null) {
    const varName = match[1];
    const startIndex = regex.lastIndex;
    
    // Extract contents inside matching outer braces
    let braceCount = 1;
    let endIndex = startIndex;
    let inQuotes = false;
    
    while (braceCount > 0 && endIndex < hclText.length) {
      const char = hclText[endIndex];
      // Keep track of quotes to avoid false matches inside strings
      if (char === '"' && hclText[endIndex - 1] !== '\\') {
        inQuotes = !inQuotes;
      }
      
      if (!inQuotes) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
      }
      endIndex++;
    }
    
    if (braceCount > 0) {
      warnings.push(`Le bloc de la variable "${varName}" n'est pas fermé correctement (accolade manquante).`);
    }

    const blockContent = hclText.substring(startIndex, endIndex - 1);
    try {
      const parsedVar = parseVariableBlock(varName, blockContent);
      if (parsedVar && !parsedVar.ignore) {
        fields.push(parsedVar);
      }
    } catch (err) {
      warnings.push(`Erreur lors de l'analyse de la variable "${varName}" : ${err.message}`);
    }
  }
  
  return {
    title: "Variables Terraform",
    description: "Formulaire généré à partir de variables.tf",
    outputFormat: "hcl",
    fields: fields,
    warnings: warnings
  };
}

function checkBalancedBrackets(str) {
  const stack = [];
  let inQuotes = false;
  
  for (let idx = 0; idx < str.length; idx++) {
    const char = str[idx];
    if (char === '"' && str[idx - 1] !== '\\') {
      inQuotes = !inQuotes;
      continue;
    }
    
    if (!inQuotes) {
      if (char === '(' || char === '[' || char === '{') {
        stack.push({ char, index: idx });
      } else if (char === ')' || char === ']' || char === '}') {
        if (stack.length === 0) {
          return `Caractère de fermeture inattendu "${char}" à la position ${idx}.`;
        }
        const last = stack.pop();
        if (
          (char === ')' && last.char !== '(') ||
          (char === ']' && last.char !== '[') ||
          (char === '}' && last.char !== '{')
        ) {
          return `Caractère de fermeture de type différent "${char}" ne correspondant pas à "${last.char}".`;
        }
      }
    }
  }
  
  if (stack.length > 0) {
    return `Caractère d'ouverture "${stack[0].char}" non fermé.`;
  }
  
  return null;
}

function parseHclBlockContent(blockContent) {
  const attrs = {
    validations: []
  };
  
  let i = 0;
  while (i < blockContent.length) {
    const char = blockContent[i];
    
    // Handle comments
    if (char === '#' || (char === '/' && blockContent[i + 1] === '/')) {
      while (i < blockContent.length && blockContent[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (char === '/' && blockContent[i + 1] === '*') {
      i += 2;
      while (i < blockContent.length - 1 && !(blockContent[i] === '*' && blockContent[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    
    // Skip whitespace
    if (/[\s\r\n]/.test(char)) {
      i++;
      continue;
    }
    
    // Read identifier
    let ident = '';
    while (i < blockContent.length && /[\w-]/.test(blockContent[i])) {
      ident += blockContent[i];
      i++;
    }
    
    if (!ident) {
      i++;
      continue;
    }
    
    // Skip whitespace after identifier
    while (i < blockContent.length && /[\s\r\n]/.test(blockContent[i])) {
      i++;
    }
    
    if (ident === 'validation') {
      if (blockContent[i] === '{') {
        i++; // consume '{'
        let braceCount = 1;
        let start = i;
        let inQuotes = false;
        while (braceCount > 0 && i < blockContent.length) {
          const ch = blockContent[i];
          if (ch === '"') {
            let slashCount = 0;
            let j = i - 1;
            while (j >= 0 && blockContent[j] === '\\') {
              slashCount++;
              j--;
            }
            if (slashCount % 2 === 0) {
              inQuotes = !inQuotes;
            }
          }
          if (!inQuotes) {
            if (ch === '{') braceCount++;
            else if (ch === '}') braceCount--;
          }
          i++;
        }
        if (braceCount > 0) {
          throw new Error(`Le bloc "validation" n'est pas fermé correctement.`);
        }
        const validationContent = blockContent.substring(start, i - 1);
        attrs.validations.push(validationContent);
      } else {
        throw new Error(`Le bloc "validation" doit être suivi de "{".`);
      }
    } else {
      // Expect '=' or ':'
      if (blockContent[i] === '=' || blockContent[i] === ':') {
        const op = blockContent[i];
        i++; // consume '=' or ':'
        // Skip whitespace
        while (i < blockContent.length && /[\s\r\n]/.test(blockContent[i])) {
          i++;
        }
        
        // Check for invalid operators or duplicate assignations
        if (blockContent[i] === '=' || blockContent[i] === '+' || blockContent[i] === ':' || blockContent[i] === '*') {
          throw new Error(`Opérateur d'assignation ou de syntaxe invalide "${op}${blockContent[i]}..." pour l'attribut "${ident}".`);
        }

        let valExpr = '';
        let parenCount = 0;
        let braceCount = 0;
        let bracketCount = 0;
        let inQuotes = false;
        
        while (i < blockContent.length) {
          const ch = blockContent[i];
          if (ch === '"') {
            let slashCount = 0;
            let j = i - 1;
            while (j >= 0 && blockContent[j] === '\\') {
              slashCount++;
              j--;
            }
            if (slashCount % 2 === 0) {
              inQuotes = !inQuotes;
            }
          }
          
          if (!inQuotes) {
            if (ch === '(') parenCount++;
            else if (ch === ')') parenCount--;
            else if (ch === '{') braceCount++;
            else if (ch === '}') braceCount--;
            else if (ch === '[') bracketCount++;
            else if (ch === ']') bracketCount--;
            
            if (parenCount === 0 && braceCount === 0 && bracketCount === 0) {
              if (ch === '\n' || ch === ',' || ch === ';' || ch === '#' || (ch === '/' && blockContent[i + 1] === '/')) {
                break;
              }
            }
          }
          valExpr += ch;
          i++;
        }
        
        const trimmedValExpr = valExpr.trim();
        const err = checkBalancedBrackets(trimmedValExpr);
        if (err) {
          throw new Error(`Erreur de syntaxe dans la valeur de "${ident}" : ${err}`);
        }

        attrs[ident] = trimmedValExpr;
      } else {
        throw new Error(`Attribut "${ident}" non suivi de "=" ou ":".`);
      }
    }
  }
  return attrs;
}

function parseVariableBlock(varName, blockContent) {
  const field = {
    name: varName,
    label: formatLabel(varName),
    type: 'string',
    required: false
  };
  
  const attrs = parseHclBlockContent(blockContent);
  
  const validAttributes = ['type', 'default', 'description', 'nullable', 'validation', 'sensitive', 'validations'];
  for (const key of Object.keys(attrs)) {
    if (!validAttributes.includes(key)) {
      throw new Error(`Attribut non supporté ou invalide "${key}" dans le bloc de la variable "${varName}".`);
    }
  }
  
  // Parse description
  if (attrs.description) {
    let rawDesc = attrs.description;
    if (rawDesc.startsWith('"') && rawDesc.endsWith('"')) {
      rawDesc = rawDesc.slice(1, -1).replace(/\\"/g, '"');
    }
    
    // Parse @ignore annotations
    if (/@ignore\b/i.test(rawDesc)) {
      field.ignore = true;
      rawDesc = rawDesc.replace(/@ignore(\s*\(\s*\))?/ig, '').trim();
    }
    
    // Parse @optionsFrom / @optionsForm annotations
    const annotations = [];
    let optIndex = -1;
    const idxFrom = rawDesc.indexOf('@optionsFrom');
    const idxForm = rawDesc.indexOf('@optionsForm');
    if (idxFrom !== -1 && idxForm !== -1) {
      optIndex = Math.min(idxFrom, idxForm);
    } else {
      optIndex = idxFrom !== -1 ? idxFrom : idxForm;
    }
    
    while (optIndex !== -1) {
      const openParen = rawDesc.indexOf('(', optIndex);
      if (openParen !== -1 && openParen < optIndex + 18) {
        let parenCount = 1;
        let scanIndex = openParen + 1;
        let optContent = '';
        while (parenCount > 0 && scanIndex < rawDesc.length) {
          const ch = rawDesc[scanIndex];
          if (ch === '(') parenCount++;
          else if (ch === ')') parenCount--;
          if (parenCount > 0) {
            optContent += ch;
          }
          scanIndex++;
        }
        
        if (parenCount === 0) {
          const fullAnnotation = rawDesc.substring(optIndex, scanIndex);
          const eqIndex = optContent.indexOf('=');
          if (eqIndex !== -1) {
            const targetPath = optContent.substring(0, eqIndex).trim();
            const sourceValStr = optContent.substring(eqIndex + 1).trim();
            
            if (sourceValStr.startsWith('[') && sourceValStr.endsWith(']')) {
              const parsedArray = parseHclValue(sourceValStr);
              annotations.push({
                targetPath,
                options: parsedArray
              });
            } else {
              annotations.push({
                targetPath,
                sourcePath: sourceValStr
              });
            }
          }
          rawDesc = rawDesc.replace(fullAnnotation, '');
        } else {
          break;
        }
      } else {
        break;
      }
      
      const nextFrom = rawDesc.indexOf('@optionsFrom');
      const nextForm = rawDesc.indexOf('@optionsForm');
      if (nextFrom !== -1 && nextForm !== -1) {
        optIndex = Math.min(nextFrom, nextForm);
      } else {
        optIndex = nextFrom !== -1 ? nextFrom : nextForm;
      }
    }

    // Parse @optionsUrl annotations
    const optionsUrlRegex = /@optionsUrl\s*\(\s*([\w\-.*]+)\s*=\s*([^\s)]+|{[^\n)]+})\s*\)/g;
    let urlMatch;
    const urlAnnotations = [];
    while ((urlMatch = optionsUrlRegex.exec(rawDesc)) !== null) {
      let sourceVal = urlMatch[2].trim();
      if (sourceVal.startsWith('{') && sourceVal.endsWith('}')) {
        try {
          sourceVal = JSON.parse(sourceVal);
        } catch (e) {
          try {
            // Relax parser by replacing single quotes with double quotes
            const relaxedJson = sourceVal.replace(/'/g, '"');
            sourceVal = JSON.parse(relaxedJson);
          } catch (e2) {
            console.warn(`[Parser] Failed to parse optionsUrl JSON annotation for ${varName}:`, e.message);
          }
        }
      } else {
        // Strip leading/trailing single or double quotes for plain strings/URLs
        if ((sourceVal.startsWith('"') && sourceVal.endsWith('"')) || 
            (sourceVal.startsWith("'") && sourceVal.endsWith("'"))) {
          sourceVal = sourceVal.slice(1, -1);
        }
      }
      urlAnnotations.push({
        targetPath: urlMatch[1].trim(),
        sourceVal: sourceVal
      });
    }

    // Parse @condition annotations
    const conditionAnnotations = [];
    let condIndex = rawDesc.indexOf('@condition');
    while (condIndex !== -1) {
      const openParen = rawDesc.indexOf('(', condIndex);
      if (openParen !== -1 && openParen < condIndex + 15) {
        let parenCount = 1;
        let scanIndex = openParen + 1;
        let condContent = '';
        while (parenCount > 0 && scanIndex < rawDesc.length) {
          const ch = rawDesc[scanIndex];
          if (ch === '(') parenCount++;
          else if (ch === ')') parenCount--;
          if (parenCount > 0) {
            condContent += ch;
          }
          scanIndex++;
        }
        
        if (parenCount === 0) {
          const fullAnnotation = rawDesc.substring(condIndex, scanIndex);
          let targetPath = '';
          let expression = condContent.trim();
          
          const targetPathMatch = expression.match(/^([\w\-.*]+)\s*=\s*(?!=)(.*)$/);
          if (targetPathMatch) {
            targetPath = targetPathMatch[1].trim();
            expression = targetPathMatch[2].trim();
          } else {
            targetPath = varName;
          }
          
          conditionAnnotations.push({
            targetPath,
            expression
          });
          
          rawDesc = rawDesc.replace(fullAnnotation, '');
        } else {
          break;
        }
      } else {
        break;
      }
      condIndex = rawDesc.indexOf('@condition');
    }
    
    // Clean description from annotations
    rawDesc = rawDesc.replace(/@optionsFrom\s*\(\s*[\w\-.*]+\s*=\s*[^\s)]+\s*\)/g, '').trim();
    rawDesc = rawDesc.replace(/@optionsUrl\s*\(\s*[\w\-.*]+\s*=\s*(?:[^\s)]+|{[^\n)]+})\s*\)/g, '').trim();
    field.description = rawDesc;
    
    if (annotations.length > 0) {
      field._optionsFromAnnotations = annotations;
    }
    if (urlAnnotations.length > 0) {
      field._optionsUrlAnnotations = urlAnnotations;
    }
    if (conditionAnnotations.length > 0) {
      field._conditionAnnotations = conditionAnnotations;
    }
  }
  
  // Parse type expression
  if (attrs.type) {
    const parsedTypeInfo = parseHclType(varName, attrs.type);
    Object.assign(field, parsedTypeInfo);
  }
  
  // Parse default value
  if (attrs.default) {
    field.default = parseHclValue(attrs.default);
  }
  
  // Determine if nullable is set to false (meaning it's required)
  if (attrs.nullable === 'false') {
    field.required = true;
  }
  
  // If no default value, and it's not explicitly declared nullable = true, 
  // we can check if it's required. In TF, a variable with no default is required at execution.
  const hasNullableTrue = attrs.nullable === 'true' || blockContent.includes('nullable = true');
  if (field.default === undefined && !field.optional && !hasNullableTrue) {
    field.required = true;
  }
  
  // If it's a map (rendered as array of key/value pairs), convert default object to list format
  if (field.type === 'array' && field.itemType === 'object' && isMapFields(field.fields)) {
    if (field.default && typeof field.default === 'object' && !Array.isArray(field.default)) {
      field.default = Object.entries(field.default).map(([k, v]) => ({ key: k, value: v }));
    }
  }

  // Parse validation blocks
  for (const validationBlock of attrs.validations) {
    // Extract full condition expression (may span multiple lines inside parens)
    const conditionStart = validationBlock.indexOf('condition');
    if (conditionStart === -1) continue;
    const condEqIdx = validationBlock.indexOf('=', conditionStart);
    if (condEqIdx === -1) continue;
    let ci = condEqIdx + 1;
    while (ci < validationBlock.length && /[\s\r\n]/.test(validationBlock[ci])) ci++;
    let conditionStr = '';
    let cParen = 0, cBracket = 0, cBrace = 0, cInQ = false;
    while (ci < validationBlock.length) {
      const ch = validationBlock[ci];
      if (ch === '"' && validationBlock[ci - 1] !== '\\') cInQ = !cInQ;
      if (!cInQ) {
        if (ch === '(') cParen++;
        else if (ch === ')') cParen--;
        else if (ch === '[') cBracket++;
        else if (ch === ']') cBracket--;
        else if (ch === '{') cBrace++;
        else if (ch === '}') cBrace--;
        if (cParen === 0 && cBracket === 0 && cBrace === 0 && (ch === '\n' || ch === '#')) break;
      }
      conditionStr += ch;
      ci++;
    }
    conditionStr = conditionStr.trim();

    // Extract error_message
    const msgMatch = validationBlock.match(/error_message\s*=\s*"([^"]+)"/);
    const errorMessage = msgMatch ? msgMatch[1] : undefined;

    // ── 1. contains([...], var.x) ──────────────────────────────────────────────
    const containsRegex = /contains\s*\(\s*\[\s*([^\]]+)\s*\]\s*,\s*(?:upper|lower)?\(?\s*var\.[\w_-]+\s*\)?\s*\)/i;
    const containsMatch = conditionStr.match(containsRegex);
    if (containsMatch) {
      const rawOptions = containsMatch[1];
      const options = rawOptions.split(',')
        .map(opt => opt.trim())
        .map(opt => {
          if (opt.startsWith('"') && opt.endsWith('"')) return opt.slice(1, -1);
          if (opt.startsWith("'") && opt.endsWith("'")) return opt.slice(1, -1);
          return opt;
        })
        .filter(opt => opt !== '');

      if (options.length > 0) {
        field.type = 'select';
        field.options = options;
        break; // select takes priority — stop processing validations
      }
    }

    // ── 2. can(regex("pattern", var.x)) ──────────────────────────────────────
    // ── 3. length(regexall("pattern", var.x)) > 0 ────────────────────────────
    // ── 4. alltrue([for ... : can(regex("pattern", v))]) ─────────────────────
    if (!field.validation) {
      const regexPatternMatch = conditionStr.match(
        /(?:can\s*\(\s*regex\s*\(|regexall\s*\()\s*"((?:[^"\\]|\\.)+)"/);
      if (regexPatternMatch) {
        field.validation = {
          regex: regexPatternMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        };
        if (errorMessage) {
          field.validation.message = errorMessage;
        }
      }
    }
  }
  
  if (field._optionsFromAnnotations) {
    applyOptionsFromAnnotations(field);
  }
  if (field._optionsUrlAnnotations) {
    applyOptionsUrlAnnotations(field);
  }
  if (field._conditionAnnotations) {
    applyConditionAnnotations(field);
  }
  
  return field;
}

function applyOptionsFromAnnotations(field) {
  if (!field._optionsFromAnnotations) return;
  
  field._optionsFromAnnotations.forEach(({ targetPath, sourcePath, options }) => {
    if (targetPath === field.name || targetPath === '') {
      if (options) {
        field.options = options;
        field.type = 'select';
      } else {
        field.optionsFrom = sourcePath;
      }
      return;
    }
    
    const pathSegments = targetPath.split('.')
      .map(s => s.trim())
      .filter(s => s && s !== '*');
      
    let current = field;
    let found = true;
    for (const segment of pathSegments) {
      if (current.fields && Array.isArray(current.fields)) {
        const next = current.fields.find(f => f.name === segment);
        if (next) {
          current = next;
        } else {
          found = false;
          break;
        }
      } else {
        found = false;
        break;
      }
    }
    if (found) {
      if (options) {
        current.options = options;
        current.type = 'select';
      } else {
        current.optionsFrom = sourcePath;
      }
    }
  });
  
  delete field._optionsFromAnnotations;
}

function applyOptionsUrlAnnotations(field) {
  if (!field._optionsUrlAnnotations) return;
  
  field._optionsUrlAnnotations.forEach(({ targetPath, sourceVal }) => {
    if (targetPath === field.name || targetPath === '') {
      field.optionsUrl = sourceVal;
      field.type = 'select';
      return;
    }
    
    const pathSegments = targetPath.split('.')
      .map(s => s.trim())
      .filter(s => s && s !== '*');
      
    let current = field;
    let found = true;
    for (const segment of pathSegments) {
      if (current.fields && Array.isArray(current.fields)) {
        const next = current.fields.find(f => f.name === segment);
        if (next) {
          current = next;
        } else {
          found = false;
          break;
        }
      } else {
        found = false;
        break;
      }
    }
    if (found) {
      current.optionsUrl = sourceVal;
      current.type = 'select';
    }
  });
  
  delete field._optionsUrlAnnotations;
}

function applyConditionAnnotations(field) {
  if (!field._conditionAnnotations) return;
  
  field._conditionAnnotations.forEach(({ targetPath, expression }) => {
    if (targetPath === field.name || targetPath === '') {
      field.condition = expression;
      return;
    }
    
    const pathSegments = targetPath.split('.')
      .map(s => s.trim())
      .filter(s => s && s !== '*');
      
    let current = field;
    let found = true;
    for (const segment of pathSegments) {
      if (current.fields && Array.isArray(current.fields)) {
        const next = current.fields.find(f => f.name === segment);
        if (next) {
          current = next;
        } else {
          found = false;
          break;
        }
      } else {
        found = false;
        break;
      }
    }
    if (found) {
      current.condition = expression;
    }
  });
  
  delete field._conditionAnnotations;
}

function isMapFields(fields) {
  return fields && fields.length === 2 && 
    fields[0].name === 'key' && 
    fields[1].name === 'value';
}

// Format snake_case or camelCase variables to Title Case Labels
function formatLabel(name) {
  return name
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase());
}

// Parse arguments inside optional(type, default)
function parseOptionalArgs(argsStr) {
  let typeExpr = '';
  let defaultExpr = '';
  let commaIndex = -1;
  let parenCount = 0;
  let braceCount = 0;
  let bracketCount = 0;
  let inQuotes = false;
  
  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    if (char === '"' && argsStr[i - 1] !== '\\') {
      inQuotes = !inQuotes;
    }
    
    if (!inQuotes) {
      if (char === '(') parenCount++;
      else if (char === ')') parenCount--;
      else if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
      
      if (char === ',' && parenCount === 0 && braceCount === 0 && bracketCount === 0) {
        commaIndex = i;
        break;
      }
    }
  }
  
  if (commaIndex !== -1) {
    typeExpr = argsStr.substring(0, commaIndex).trim();
    defaultExpr = argsStr.substring(commaIndex + 1).trim();
  } else {
    typeExpr = argsStr.trim();
  }
  
  return { typeExpr, defaultExpr };
}

// Convert HCL type expression into schema properties
function parseHclType(varName, typeStr) {
  typeStr = typeStr.trim();

  // optional(...) wraps any other Terraform type and should preserve its shape.
  const optionalMatch = typeStr.match(/^optional\((.*)\)$/s);
  if (optionalMatch) {
    const { typeExpr, defaultExpr } = parseOptionalArgs(optionalMatch[1]);
    const parsedInner = parseHclType(varName, typeExpr);
    const result = {
      ...parsedInner,
      required: false,
      optional: true
    };
    if (defaultExpr) {
      result.default = parseHclValue(defaultExpr);
    }
    return result;
  }
  
  if (typeStr === 'string') {
    return { type: 'string' };
  }
  if (typeStr === 'number') {
    return { type: 'number' };
  }
  if (typeStr === 'bool') {
    return { type: 'boolean' };
  }
  if (typeStr === 'any') {
    return { type: 'string' };
  }
  
  // list(...) or set(...) or tuple(...)
  const listMatch = typeStr.match(/^(?:list|set|tuple)\((.*)\)$/s);
  if (listMatch) {
    const innerType = listMatch[1].trim();
    if (innerType.startsWith('object(')) {
      const parsedInner = parseHclType(varName, innerType);
      return {
        type: 'array',
        itemType: 'object',
        fields: parsedInner.fields || []
      };
    } else {
      const parsedInner = parseHclType(varName, innerType);
      return {
        type: 'array',
        itemType: parsedInner.type || 'string'
      };
    }
  }
  
  // map(...)
  const mapMatch = typeStr.match(/^map\((.*)\)$/s);
  if (mapMatch) {
    const innerType = mapMatch[1].trim();
    const parsedInner = parseHclType(varName, innerType);

    // Terraform map(object(...)) doit être rendu comme un objet dynamique:
    // chaque clé est libre, et la valeur reprend la structure complète de l'objet.
    if (parsedInner.type === 'object' && Array.isArray(parsedInner.fields)) {
      return {
        type: 'object',
        dynamicKeys: true,
        keyLabel: 'Clé',
        fields: parsedInner.fields
      };
    }

    // Represent maps as array of key/value pairs in the UI
    return {
      type: 'array',
      itemType: 'object',
      fields: [
        { name: 'key', label: 'Clé', type: 'string', required: true },
        { name: 'value', label: 'Valeur', type: parsedInner.type || 'string', required: true }
      ]
    };
  }
  
  // object({ ... })
  const objectMatch = typeStr.match(/^object\(\{(.*)\}\)$/s);
  if (objectMatch) {
    const innerFieldsStr = objectMatch[1].trim();
    return {
      type: 'object',
      fields: parseObjectFields(innerFieldsStr)
    };
  }
  
  throw new Error(`Type Terraform invalide ou non supporté : "${typeStr}"`);
}

// Parse fields inside object({ key = type, ... })
function parseObjectFields(fieldsStr) {
  const fields = [];
  let i = 0;
  
  while (i < fieldsStr.length) {
    // Skip spaces, commas, newlines, semicolons
    while (i < fieldsStr.length && /[\s,;\n]/.test(fieldsStr[i])) i++;
    if (i >= fieldsStr.length) break;
    
    // Read field identifier
    let key = '';
    while (i < fieldsStr.length && /[\w-]/.test(fieldsStr[i])) {
      key += fieldsStr[i];
      i++;
    }
    
    // Skip spaces, expect '=' or ':'
    while (i < fieldsStr.length && /\s/.test(fieldsStr[i])) i++;
    if (fieldsStr[i] !== '=' && fieldsStr[i] !== ':') {
      i++;
      continue;
    }
    i++; // consume '=' or ':'
    
    // Skip spaces
    while (i < fieldsStr.length && /\s/.test(fieldsStr[i])) i++;
    
    // Read type expression (handle nested balanced parens/braces)
    let typeExpr = '';
    let parenCount = 0;
    let braceCount = 0;
    let inQuotes = false;
    
    while (i < fieldsStr.length) {
      const char = fieldsStr[i];
      if (char === '"' && fieldsStr[i - 1] !== '\\') {
        inQuotes = !inQuotes;
      }
      
      if (!inQuotes) {
        if (char === '(') parenCount++;
        else if (char === ')') parenCount--;
        else if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
        
        if (parenCount === 0 && braceCount === 0) {
          if (char === ',' || char === '\n' || char === '}') {
            break;
          }
        }
      }
      
      typeExpr += char;
      i++;
    }
    
    typeExpr = typeExpr.trim();
    if (key && typeExpr) {
      const fieldInfo = parseHclType(key, typeExpr);
      fields.push({
        name: key,
        label: formatLabel(key),
        ...fieldInfo,
        required: fieldInfo.required !== false
      });
    }
  }
  
  return fields;
}

// Parse HCL values to JS objects recursively
function parseHclValue(valStr) {
  valStr = valStr.trim();
  if (!valStr) return undefined;

  // Booleans
  if (valStr === 'true') return true;
  if (valStr === 'false') return false;

  // Strings
  if (valStr.startsWith('"') && valStr.endsWith('"')) {
    return valStr.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Numbers
  if (!isNaN(Number(valStr))) {
    return Number(valStr);
  }

  // Arrays/Lists
  if (valStr.startsWith('[') && valStr.endsWith(']')) {
    const inner = valStr.slice(1, -1).trim();
    if (!inner) return [];
    
    const items = [];
    let i = 0;
    while (i < inner.length) {
      while (i < inner.length && /[\s,]/.test(inner[i])) i++;
      if (i >= inner.length) break;
      
      let itemStr = '';
      let parenCount = 0;
      let braceCount = 0;
      let bracketCount = 0;
      let inQuotes = false;
      
      while (i < inner.length) {
        const char = inner[i];
        if (char === '"' && inner[i - 1] !== '\\') inQuotes = !inQuotes;
        
        if (!inQuotes) {
          if (char === '(') parenCount++;
          else if (char === ')') parenCount--;
          else if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
          else if (char === '[') bracketCount++;
          else if (char === ']') bracketCount--;
          
          if (parenCount === 0 && braceCount === 0 && bracketCount === 0 && char === ',') {
            break;
          }
        }
        itemStr += char;
        i++;
      }
      items.push(parseHclValue(itemStr));
    }
    return items;
  }

  // Objects/Maps
  if (valStr.startsWith('{') && valStr.endsWith('}')) {
    const inner = valStr.slice(1, -1).trim();
    if (!inner) return {};
    
    const obj = {};
    let i = 0;
    while (i < inner.length) {
      while (i < inner.length && /[\s,;\n]/.test(inner[i])) i++;
      if (i >= inner.length) break;
      
      // Read Key
      let key = '';
      if (inner[i] === '"') {
        i++; // consume "
        while (i < inner.length && (inner[i] !== '"' || inner[i-1] === '\\')) {
          key += inner[i];
          i++;
        }
        i++; // consume "
      } else {
        while (i < inner.length && /[\w-]/.test(inner[i])) {
          key += inner[i];
          i++;
        }
      }
      
      // Equals or colon
      while (i < inner.length && /\s/.test(inner[i])) i++;
      if (inner[i] !== '=' && inner[i] !== ':') {
        i++;
        continue;
      }
      i++; // consume '=' or ':'
      
      // Value
      while (i < inner.length && /\s/.test(inner[i])) i++;
      
      let valPart = '';
      let parenCount = 0;
      let braceCount = 0;
      let bracketCount = 0;
      let inQuotes = false;
      
      while (i < inner.length) {
        const char = inner[i];
        if (char === '"' && inner[i - 1] !== '\\') inQuotes = !inQuotes;
        
        if (!inQuotes) {
          if (char === '(') parenCount++;
          else if (char === ')') parenCount--;
          else if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
          else if (char === '[') bracketCount++;
          else if (char === ']') bracketCount--;
          
          if (parenCount === 0 && braceCount === 0 && bracketCount === 0 && (char === ',' || char === '\n' || char === '}')) {
            break;
          }
        }
        valPart += char;
        i++;
      }
      
      if (key && valPart) {
        obj[key.trim()] = parseHclValue(valPart);
      }
    }
    return obj;
  }

  // Fallback to raw string
  return valStr;
}

module.exports = {
  parseTerraformVariables
};
