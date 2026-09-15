/**
 * The dispatch ledger: what the world remembers.
 *
 * The case that decides whether any of this is honest is the last one - can a
 * coalition that fires be explained, line by line, from what the player was
 * told and what they said back. If the receipts cannot be produced, the
 * coalition has no business firing.
 *
 * Runs against a scratch file, so it cannot touch a real campaign.
 *
 *   node scripts/check-dispatch-ledger.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DispatchLedger } from '../src/lore/DispatchLedger.js';
import { PRESSURE_BREAK } from '../src/director/dispatches.js';

let passed = 0;
let failed = 0;

/** @param {string} name @param {boolean} ok @param {string} [detail] */
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS  ${name}`); } else { failed += 1; console.log(`FAIL  ${name}`); }
  if (detail) console.log(`      ${detail}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-ledger-'));
const file = path.join(dir, 'dispatches.json');
const fresh = () => new DispatchLedger(file);
const reset = () => { try { fs.unlinkSync(file); } catch { /* first run */ } };

const castile = (ruler = 'Fernando III') => ({ primaryTitle: 'Kingdom of Castile', ruler });

// --------------------------------------------------------------------------
console.log('\nIt remembers across a restart\n');

reset();
{
  const a = fresh();
  a.record(castile(), 'ignore', { date: '1219.3.1', year: 1219, stance: 'alarmed' });
  a.record(castile(), 'ignore', { date: '1224.6.1', year: 1224, stance: 'alarmed' });

  // A second instance reading the same file is exactly what a restart is.
  const b = fresh();
  check('L1. pressure survives a new orchestrator process',
    b.pressureOf(castile()) === 2,
    `${b.pressureOf(castile())} of ${PRESSURE_BREAK} after two silences and a restart`);
}
{
  const a = fresh();
  a.record(castile(), 'ignore', { date: '1229.1.1', year: 1229, stance: 'alarmed' });
  check('L2. the third silence reaches the breaking point',
    a.pressureOf(castile()) === PRESSURE_BREAK && a.atBreakingPoint().length === 1,
    a.atBreakingPoint().map((r) => `${r.title} at ${r.pressure}`).join(', '));
}

// --------------------------------------------------------------------------
console.log('\nPressure belongs to the realm, not the ruler\n');

reset();
{
  const led = fresh();
  led.sawRuler(castile('Fernando III'), '1219.1.1');
  led.record(castile('Fernando III'), 'ignore', { date: '1219.1.1', year: 1219 });
  led.record(castile('Fernando III'), 'ignore', { date: '1222.1.1', year: 1222 });
  check('L3. two silences under one king',
    led.pressureOf(castile('Fernando III')) === 2);

  // The son inherits the frontier and the grievance, but a death is an opening.
  const succ = led.sawRuler(castile('Alfonso X'), '1230.1.1');
  check('L4. a succession decays pressure by one, not to zero',
    succ.decayed && succ.pressure === 1 && succ.from === 'Fernando III',
    `${succ.from} to ${succ.to}: pressure 2 to ${succ.pressure}`);

  check('L5. and the grievance is still Castile\'s, under a new name',
    led.pressureOf(castile('Alfonso X')) === 1,
    'a crown inherits its own frontier');
}
{
  const led = fresh();
  const same = led.sawRuler(castile('Alfonso X'), '1231.1.1');
  check('L6. seeing the same ruler again changes nothing',
    !same.decayed && same.pressure === 1);
}
{
  reset();
  const led = fresh();
  const first = led.sawRuler(castile('Fernando III'), '1219.1.1');
  check('L7. a realm seen for the FIRST time is not a succession',
    !first.decayed && first.pressure === 0,
    '"we have never looked at you" and "your predecessor died" are different facts');
}
{
  // A realm at peace with you, whose ruler dies. Nothing was owed, so nothing
  // is forgiven, and the sidebar must not be handed a "they have softened
  // towards you" it can report about a realm that never hardened.
  const led = fresh();
  const leon = (ruler) => ({ primaryTitle: 'Kingdom of Leon', ruler });
  led.sawRuler(leon('Alfonso IX'), '1219.1.1');
  const succ = led.sawRuler(leon('Berenguela'), '1230.1.1');
  check('L8. a death when there is nothing to forgive reports NO decay',
    succ.decayed === false && succ.pressure === 0 && succ.from === 'Alfonso IX',
    `${succ.from} to ${succ.to}: pressure ${succ.pressure}, decayed: ${succ.decayed}`);
}
{
  // And the same succession where something IS owed does report it, so the two
  // cases are distinguishable by the caller rather than only by the number.
  const led = fresh();
  const nav = (ruler) => ({ primaryTitle: 'Kingdom of Navarra', ruler });
  led.sawRuler(nav('Sancho VII'), '1219.1.1');
  led.record(nav('Sancho VII'), 'defy', { year: 1220 });
  const succ = led.sawRuler(nav('Teobaldo I'), '1234.1.1');
  check('L8b. and one where something IS owed reports the decay',
    succ.decayed === true && succ.pressure === 1,
    `${succ.from} to ${succ.to}: pressure 2 to ${succ.pressure}`);
}

// --------------------------------------------------------------------------
console.log('\nAnswering works\n');

reset();
{
  const led = fresh();
  led.record(castile(), 'ignore', { year: 1219 });
  led.record(castile(), 'defy', { year: 1220 });
  check('L9. defiance heats it faster than silence', led.pressureOf(castile()) === 3);
  led.record(castile(), 'tribute', { year: 1221 });
  check('L10. and tribute cools it', led.pressureOf(castile()) === 1);
  check('L11. a cooled realm leaves the breaking list', led.atBreakingPoint().length === 0);
}

// --------------------------------------------------------------------------
console.log('\nRobustness\n');

reset();
{
  const led = fresh();
  check('L12. a realm with no primary title cannot be remembered, and says so quietly',
    led.record({ ruler: 'Nobody' }, 'ignore').pressure === 0
      && led.all().length === 0,
    'a realm the snapshot could not name has no honest key to carry a grievance under');
}
{
  fs.writeFileSync(file, 'not json at all', 'utf8');
  let threw = false;
  let led = null;
  try { led = new DispatchLedger(file); } catch { threw = true; }
  check('L13. a corrupt ledger starts over rather than refusing to start',
    !threw && led.all().length === 0,
    'a world that has forgotten is recoverable; one that will not load is not');
}
{
  fs.writeFileSync(file, '[1,2,3]', 'utf8');
  const led = new DispatchLedger(file);
  check('L14. and so does one of the wrong shape', led.all().length === 0);
}

// --------------------------------------------------------------------------
console.log('\nThe receipts - the case a coalition has to be able to make\n');

reset();
{
  const led = fresh();
  led.sawRuler(castile(), '1219.3.1');
  led.record(castile(), 'ignore', { date: '1219.3.1', year: 1219, stance: 'alarmed' });
  led.record(castile(), 'defy', { date: '1224.6.1', year: 1224, stance: 'alarmed' });
  led.record(castile(), 'ignore', { date: '1229.1.1', year: 1229, stance: 'alarmed' });

  const history = led.historyOf('Kingdom of Castile');
  check('L15. every warning and every answer is on the record',
    /1219.3.1/.test(history) && /1224.6.1/.test(history) && /1229.1.1/.test(history)
      && /ignore/.test(history) && /defy/.test(history),
    'if this cannot be produced, the coalition should not fire');

  check('L16. and the pressure at each step, so the sequence reads as a sequence',
    /pressure 0 to 1/.test(history) && /pressure 3 to 3/.test(history));

  console.log('\n--- what the sidebar would show when Castile finally moves ---\n');
  console.log(history);
  console.log('');
}
{
  const led = fresh();
  check('L17. a realm nobody has written to says so plainly',
    /never been answered/.test(led.historyOf('Kingdom of Nowhere')));
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
