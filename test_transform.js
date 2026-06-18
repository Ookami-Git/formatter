// ===== Test unitaire du moteur de transformation =====
'use strict';

// Charger le moteur via require (Node.js)
const { transformOutput } = require('./public/lib/transform-engine.js');

// ─── Données de test ──────────────────────────────────────────────────────────
const testFormData = {
  project_name: 'monprojet',
  env: 'prod',
  region: 'eu-west-1',
  worker_count: 3,
  vm_cpu: 4,
  vm_ram: 16,
  disque_supplementaire: {
    taille_go: 100,
    type_disque: 'ssd',
    point_montage: '/data'
  }
};

const testTemplate = {
  cluster_name: '${env}-${project_name}',
  environment: '${env}',
  vms: {
    '$repeat': 'worker_count',
    '$item': {
      name: '${env}-${project_name}-vm${_index + 1}',
      role: '${_index === 0 ? "primary" : "worker"}',
      cpu: '${vm_cpu}',
      extra_disk: {
        '$if': 'disque_supplementaire',
        '$then': {
          size_gb: '${disque_supplementaire.taille_go}',
          type: '${disque_supplementaire.type_disque}'
        }
      }
    }
  },
  metadata: {
    total_vms: '${worker_count}',
    total_cpu: '${worker_count * vm_cpu}'
  }
};

// ─── Tests ────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log('  ✅', label);
    passed++;
  } else {
    console.error('  ❌', label);
    console.error('     Attendu  :', JSON.stringify(expected));
    console.error('     Obtenu   :', JSON.stringify(actual));
    failed++;
  }
}

// Test 1 : Transformation complète avec disque
console.log('\n📋 Test 1 : Transformation avec disque supplémentaire actif');
const result = transformOutput(testFormData, testTemplate);
console.log('Output complet :\n' + JSON.stringify(result, null, 2) + '\n');
const vms = result.vms;
assert('cluster_name calculé',            result.cluster_name,          'prod-monprojet');
assert('environment passé',               result.environment,            'prod');
assert('nombre de VMs = 3',              Array.isArray(vms) && vms.length, 3);
assert('VM1 name',                        vms[0].name,                   'prod-monprojet-vm1');
assert('VM2 name',                        vms[1].name,                   'prod-monprojet-vm2');
assert('VM3 name',                        vms[2].name,                   'prod-monprojet-vm3');
assert('VM1 role = primary',              vms[0].role,                   'primary');
assert('VM2 role = worker',               vms[1].role,                   'worker');
assert('VM3 role = worker',               vms[2].role,                   'worker');
assert('VM1 cpu',                         vms[0].cpu,                    4);
assert('VM1 extra_disk.size_gb',          vms[0].extra_disk && vms[0].extra_disk.size_gb, 100);
assert('VM1 extra_disk.type',             vms[0].extra_disk && vms[0].extra_disk.type,    'ssd');
assert('metadata.total_vms',             result.metadata.total_vms,     3);
assert('metadata.total_cpu = 3*4 = 12', result.metadata.total_cpu,     12);

// Test 2 : Héritage conditionnel — disque désactivé (objet vide)
console.log('\n📋 Test 2 : Disque supplémentaire désactivé (objet vide)');
const testNoDisque = { ...testFormData, disque_supplementaire: {} };
const resultNoDisque = transformOutput(testNoDisque, testTemplate);
const vm1NoDisque = resultNoDisque.vms[0];
assert('extra_disk absent si objet vide', vm1NoDisque.extra_disk, undefined);

// Test 3 : Héritage conditionnel — champ booléen false
console.log('\n📋 Test 3 : Condition $if sur booléen false');
const templateBool = {
  feature: {
    '$if': 'enabled',
    '$then': 'active',
    '$else': 'inactive'
  }
};
const r3true  = transformOutput({ enabled: true  }, templateBool);
const r3false = transformOutput({ enabled: false }, templateBool);
assert('condition true  → "active"',   r3true.feature,  'active');
assert('condition false → "inactive"', r3false.feature, 'inactive');

// Test 4 : Itération avec $key (output dict)
console.log('\n📋 Test 4 : Itération avec $key → dictionnaire');
const templateDict = {
  machines: {
    '$repeat': 'count',
    '$key':    '${prefix}-${_index}',
    '$item':   { index: '${_index}' }
  }
};
const r4 = transformOutput({ count: 2, prefix: 'node' }, templateDict);
assert('dict key node-0 existe', 'node-0' in r4.machines, true);
assert('dict key node-1 existe', 'node-1' in r4.machines, true);
assert('dict node-0.index = 0', r4.machines['node-0'].index, 0);

// Test 5 : Rétrocompatibilité (pas d'outputTemplate)
console.log('\n📋 Test 5 : Rétrocompatibilité sans outputTemplate');
const rawData = { a: 1, b: 'hello' };
assert('transformOutput(data, null) = data', transformOutput(rawData, null), rawData);
assert('transformOutput(data, undef) = data', transformOutput(rawData, undefined), rawData);

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Résultat : ${passed} test(s) réussi(s), ${failed} échec(s)`);
if (failed > 0) process.exit(1);
else console.log('✅ Tous les tests sont passés !');
