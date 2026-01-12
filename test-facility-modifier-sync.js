/**
 * Test script to verify applyFacilityCostModifier synchronization
 * between server-side (helpers.js) and client-side (shared-handlers.js)
 * 
 * Usage: node test-facility-modifier-sync.js
 * 
 * This script ensures both implementations produce identical results.
 * Run this test whenever modifying the applyFacilityCostModifier function
 * to verify that both server-side and client-side implementations remain synchronized.
 * 
 * NOTE: The client-side implementation is manually copied here for testing.
 * If you modify shared-handlers.js, update the function below to match.
 */

const helpers = require('./helpers');

// Client-side implementation (copied from shared-handlers.js for testing)
function applyFacilityCostModifier_Client(basePrice, modifier) {
  const price = Number(basePrice);
  if (Number.isNaN(price) || price < 0) {
    return 0;
  }
  
  const mod = Number(modifier);
  if (Number.isNaN(mod)) {
    return Math.round(price / 50) * 50;
  }
  
  const clampedModifier = Math.max(-100, Math.min(300, mod));
  const modifiedPrice = price * (1 + clampedModifier / 100);
  return Math.round(modifiedPrice / 50) * 50;
}

// Test cases covering various scenarios
const testCases = [
  // [basePrice, modifier, description]
  [1000, 0, 'Base case: no modifier'],
  [1000, -30, 'Negative modifier'],
  [1000, 40, 'Positive modifier'],
  [1234, 0, 'Rounding with no modifier'],
  [1234, 15, 'Rounding with positive modifier'],
  [0, 50, 'Zero price'],
  [5000, -100, 'Maximum negative modifier'],
  [5000, 300, 'Maximum positive modifier'],
  [123, 25, 'Small price with modifier'],
  [99999, 150, 'Large price with modifier'],
  [1000, -101, 'Beyond min modifier (should clamp to -100)'],
  [1000, 350, 'Beyond max modifier (should clamp to 300)'],
  [50, 0, 'Price at rounding boundary'],
  [75, 0, 'Price between boundaries'],
  [25, 0, 'Price below boundary'],
];

console.log('Testing applyFacilityCostModifier synchronization...\n');

let passed = 0;
let failed = 0;

testCases.forEach(([basePrice, modifier, description]) => {
  const serverResult = helpers.applyFacilityCostModifier(basePrice, modifier);
  const clientResult = applyFacilityCostModifier_Client(basePrice, modifier);
  
  if (serverResult === clientResult) {
    console.log(`✓ PASS: ${description}`);
    console.log(`  Base: ${basePrice}, Modifier: ${modifier}% => ${serverResult}\n`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${description}`);
    console.log(`  Base: ${basePrice}, Modifier: ${modifier}%`);
    console.log(`  Server: ${serverResult}, Client: ${clientResult}\n`);
    failed++;
  }
});

console.log('='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n⚠️  WARNING: Implementations are NOT synchronized!');
  console.log('Update both helpers.js and shared-handlers.js to match.');
  process.exit(1);
} else {
  console.log('\n✓ All tests passed! Implementations are synchronized.');
  process.exit(0);
}
