/**
 * A stand-in for the model, so the audit path can be exercised without
 * spending tokens. Speaks just enough of /chat/completions to be indistinguishable
 * from a real provider to LLMClient, and returns a fixed proposal built for the
 * Toledo scenario in simulate-game.mjs.
 *
 *   node scripts/stub-llm.mjs           # well-formed proposal
 *   node scripts/stub-llm.mjs --bad     # malformed, to prove validation bites
 */
import http from 'node:http';

const bad = process.argv.includes('--bad');
const andalusMode = process.argv.includes('--andalus');
const momentumMode = process.argv.includes('--momentum');

const good = {
  assessment:
    'Iberia in 1066 is broadly recognisable: Leon under Alfonso VI is the dominant Christian power and the southern taifas are fragmented as expected. One polity has drifted above its historical rank.',
  proposals: [
    {
      action: 'adjust_title_tier',
      args: { actor: 1001, target_tier: 'duchy' },
      headline: 'Toledo holds a kingdom it never was',
      divergence:
        'The game shows al-Mamun of Toledo at kingdom tier with nine counties. In 1066 Toledo was a taifa: a duchy-tier successor polity of the fallen Caliphate of Cordoba, paying parias to Leon rather than standing as a peer kingdom.',
      historical_context:
        'The taifa kingdoms emerged from the collapse of the Caliphate of Cordoba after 1031. Though contemporary Arabic sources style their rulers as muluk, their actual power was closer to that of a large duchy, and by the 1060s most were tributary to the northern Christian kingdoms. Toledo under al-Mamun paid parias to Alfonso VI and would fall to him outright in 1085.',
      consequences:
        'Toledo is demoted to its duchy title. It becomes a plausible target for Leonese pressure rather than a rival kingdom, restoring the paria dynamic that defined Iberian politics in this decade.',
      confidence: 'high',
    },
  ],
};

// The 1218 Andalusian case. Pairs with `simulate-game.mjs --andalus`, and
// exists to prove the mid-campaign gate end to end: this proposal is against a
// realm whose "since campaign start" column reads unchanged, which the gate
// refused outright before bookmarkTiers.js existed.
const andalus = {
  assessment:
    'This is an alt-history western Mediterranean. An Andalusian empire holds Iberia and the Maghreb together and a second empire-tier realm holds Italy and Sicily; the record for the late twelfth century has the Almohads in the first position and a Norman-Hohenstaufen kingdom, not an empire, in the second.',
  proposals: [
    {
      action: 'adjust_title_tier',
      args: { actor: 3001, target_tier: 'kingdom' },
      headline: 'An Andalusian empire the record does not carry',
      divergence:
        'The game shows the Banu Zahir at empire tier across sixty-five counties spanning Iberia and the Maghreb. At the 1178 bookmark the imperial powers of this space were the Almohad Caliphate, the Byzantines, the Holy Roman Empire, the Ayyubids and the Abbasids. No Andalusian empire of this extent appears in the record at any point in the period.',
      historical_context:
        'After the collapse of the Caliphate of Cordoba in 1031 al-Andalus was never again united under an indigenous Andalusian imperial dynasty. The unifying powers that followed were both Berber and both based in the Maghreb: the Almoravids from 1086 and the Almohads from 1147, who held al-Andalus as a province of a North African empire rather than the reverse.',
      consequences:
        'The Banu Zahir primary title is destroyed and the realm falls to kingdom tier. Vassals holding kingdom-tier titles under it will likely become independent, which will fragment Iberia and the Maghreb in a single stroke.',
      confidence: 'medium',
    },
  ],
};

// The amplified grant_claim. Pairs with `simulate-game.mjs --andalus`, whose
// Zahir III is Sunni and whose Alfonso IX is Catholic - so the faith gate on
// holy_war passes here, and would refuse the same proposal against the Sunni
// ruler of the Maghreb.
const momentum = {
  assessment:
    'The Andalusian empire holds Iberia south of the Duero while Leon persists in the north. The record has the Almohads pressing hard on the Christian kingdoms in exactly this decade, and the game shows no such pressure.',
  proposals: [
    {
      action: 'grant_claim',
      args: { actor: 3001, target: 3005, momentum: 'holy_war' },
      headline: 'Leon unpressed while the record has it under siege',
      divergence:
        'The game shows the Banu Zahir holding southern Iberia without contesting Leon. In the decades around 1218 the Almohads were pressing the northern Christian kingdoms continuously, and Leon was among the most exposed.',
      historical_context:
        'The Almohad Caliphate fought a sustained series of campaigns against the Iberian Christian kingdoms from the 1190s. Alarcos in 1195 was an Almohad victory that left Castile badly weakened; Las Navas de Tolosa in 1212 reversed it. Either way the border was under constant pressure, which is what the observed state lacks.',
      consequences:
        'Zahir III gains a pressed claim on Leon, together with the piety and money to declare and prosecute a religious war, and a lasting appetite for one. No war is started: the AI decides whether and when to act.',
      confidence: 'medium',
    },
  ],
};

const badResponse = {
  assessment: 'Testing validation.',
  proposals: [
    { action: 'delete_the_pope', args: {} },
    { action: 'adjust_title_tier', args: { actor: 1001, target_tier: 'kingdom' } },
    { action: 'set_relations', args: { actor: 9999, target: 1002, value: -50 } },
    { action: 'set_relations', args: { actor: 1001, target: 1002, value: -5000 } },
    { action: 'grant_claim', args: { actor: 1001, target: 1002 } },
  ],
};

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      console.log(`[stub] ${req.method} ${req.url} (${body.length} bytes of prompt)`);
      const payload = JSON.stringify(bad ? badResponse : momentumMode ? momentum : andalusMode ? andalus : good);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: payload } }],
        }),
      );
    });
  })
  .listen(7999, '127.0.0.1', () => console.log(`[stub] pretending to be a model on :7999 (${bad ? 'malformed' : momentumMode ? 'momentum' : andalusMode ? 'andalus' : 'well-formed'} output)`));
