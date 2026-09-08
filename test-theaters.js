/**
 * Tests for the Operational Theaters feature.
 * - Validates theater/location schema shape against sample data
 * - Verifies migrateTheatersIfNeeded is idempotent and back-fills fields
 *
 * Self-contained: uses a temporary data directory so it never touches real data.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ==================== Schema shape validation ====================

function validateLocation(loc, pathLabel) {
  assert(typeof loc.id === 'string' && loc.id.length > 0, `${pathLabel}.id must be non-empty string`);
  assert(typeof loc.name === 'string' && loc.name.length > 0, `${pathLabel}.name must be non-empty string`);
  if (loc.description !== undefined) {
    assert(typeof loc.description === 'string', `${pathLabel}.description must be a string`);
  }
  if (loc.galacticPos !== undefined) {
    assert(typeof loc.galacticPos === 'string', `${pathLabel}.galacticPos must be a string`);
  }
  assert(Array.isArray(loc.assignedJobIds), `${pathLabel}.assignedJobIds must be an array`);
  assert(typeof loc.visibleToPlayers === 'boolean', `${pathLabel}.visibleToPlayers must be boolean`);
  if (loc.x !== null && loc.x !== undefined) {
    assert(loc.x >= 0 && loc.x <= 1, `${pathLabel}.x must be within [0,1]`);
  }
  if (loc.y !== null && loc.y !== undefined) {
    assert(loc.y >= 0 && loc.y <= 1, `${pathLabel}.y must be within [0,1]`);
  }
}

function validateTheater(theater, pathLabel) {
  assert(typeof theater.id === 'string' && theater.id.length > 0, `${pathLabel}.id must be non-empty string`);
  assert(typeof theater.name === 'string' && theater.name.length > 0, `${pathLabel}.name must be non-empty string`);
  if (theater.description !== undefined) {
    assert(typeof theater.description === 'string', `${pathLabel}.description must be a string`);
  }
  if (theater.galacticPos !== undefined) {
    assert(typeof theater.galacticPos === 'string', `${pathLabel}.galacticPos must be a string`);
  }
  assert(['flat', 'planet'].includes(theater.type), `${pathLabel}.type must be flat|planet`);
  assert(Array.isArray(theater.locations), `${pathLabel}.locations must be an array`);
  theater.locations.forEach((loc, i) => validateLocation(loc, `${pathLabel}.locations[${i}]`));
}

test('sample theater conforms to expected shape', () => {
  const sample = {
    id: 'theater-1',
    name: 'Skaer-5 Theater',
    galacticPos: 'SKAER-5',
    description: 'Primary operational area',
    type: 'flat',
    backgroundImage: 'map1.png',
    textureImage: null,
    locations: [
      {
        id: 'loc-1',
        name: 'Drop Site Alpha',
        galacticPos: 'SKAER-5 // ALPHA',
        description: 'LZ',
        icon: 'token--world.svg',
        iconColor: '#e0e0e0',
        iconScale: 1,
        x: 0.42,
        y: 0.63,
        lat: null,
        lon: null,
        assignedJobIds: [],
        visibleToPlayers: true,
        childTheaterId: null
      }
    ]
  };
  validateTheater(sample, 'sample');
});

test('planet theater with lat/lon location is valid', () => {
  const sample = {
    id: 'theater-2',
    name: 'Cradle',
    type: 'planet',
    backgroundImage: null,
    textureImage: 'cradle.jpg',
    locations: [
      {
        id: 'loc-2',
        name: 'Northern Spire',
        icon: 'token--planets.svg',
        iconColor: '#ffcc00',
        iconScale: 1.5,
        x: null,
        y: null,
        lat: 45.2,
        lon: -12.7,
        assignedJobIds: ['job-abc'],
        visibleToPlayers: true,
        childTheaterId: null
      }
    ]
  };
  validateTheater(sample, 'planet-sample');
});

// ==================== Migration idempotency ====================

test('migrateTheatersIfNeeded back-fills fields and is idempotent', () => {
  // Set up a temporary BASE_PATH so dataStore writes into an isolated dir
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'theaters-test-'));
  const dataDir = path.join(tmpBase, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Minimal default_data reads are required by dataStore.init
  const repoRoot = __dirname;
  const dataStore = require('./models/dataStore');
  dataStore.init({
    BASE_PATH: tmpBase,
    DEFAULT_RESERVES: JSON.parse(fs.readFileSync(path.join(repoRoot, 'default_data', 'default_reserves.json'), 'utf8')),
    DEFAULT_CORE_MAJOR_FACILITIES: JSON.parse(fs.readFileSync(path.join(repoRoot, 'default_data', 'default_base_core_major_facilities.json'), 'utf8')),
    DEFAULT_MINOR_FACILITIES: JSON.parse(fs.readFileSync(path.join(repoRoot, 'default_data', 'default_base_minor_facilities.json'), 'utf8'))
  });

  // Write a legacy-shaped theater missing new fields
  const theatersFile = path.join(dataDir, 'theaters.json');
  const legacy = [
    {
      id: 'legacy-1',
      name: 'Legacy Theater',
      backgroundImage: 'legacy.png',
      locations: [
        { id: 'll-1', name: 'Old Location', x: 0.5, y: 0.5 }
      ]
    }
  ];
  fs.writeFileSync(theatersFile, JSON.stringify(legacy, null, 2));

  // First migration should back-fill
  dataStore.migrateTheatersIfNeeded();
  const afterFirst = JSON.parse(fs.readFileSync(theatersFile, 'utf8'));

  assert(afterFirst[0].type === 'flat', 'type should default to flat');
  assert(afterFirst[0].textureImage === null, 'textureImage should be back-filled to null');
  const loc = afterFirst[0].locations[0];
  assert(Array.isArray(loc.assignedJobIds), 'assignedJobIds should be back-filled to array');
  assert(loc.lat === null && loc.lon === null, 'lat/lon back-filled to null');
  assert(loc.childTheaterId === null, 'childTheaterId back-filled to null');
  assert(loc.iconColor === '#e0e0e0', 'iconColor back-filled');
  assert(loc.iconScale === 1, 'iconScale back-filled');
  assert(loc.visibleToPlayers === true, 'visibleToPlayers back-filled');

  // Second migration should be a no-op (idempotent)
  const before = fs.readFileSync(theatersFile, 'utf8');
  dataStore.migrateTheatersIfNeeded();
  const after = fs.readFileSync(theatersFile, 'utf8');
  assert(before === after, 'second migration should not change the file');

  // Clean up temp dir
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

// ==================== Summary ====================

console.log('\n' + '='.repeat(50));
console.log(`Theaters tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed === 0 ? 0 : 1);