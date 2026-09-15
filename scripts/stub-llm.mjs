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
const dynamicMode = process.argv.includes('--dynamic');
// A model that runs out of room. It writes a reply larger than whatever
// max_tokens the request carried and returns only what fits, with
// finish_reason "length" - which is what a real provider does, and what a live
// 1245 campaign at the old 2000 default is believed to have been hitting.
const truncateMode = process.argv.includes('--truncate');

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

// The 1071 Anatolian case. Pairs with `simulate-game.mjs --anatolia`, and
// exercises the three v0.11 paths at once: an ahistorical holding found by the
// seat probe, the dynamic event carrying the model's own argument to the card,
// and a watchlist that makes the next death interrupt the cadence.
const dynamic = {
  assessment:
    'Anatolia in 1071 is recognisable but for one thing: a French king holds the Duchy of Anatolia from a court the sweep cannot even find, which is not a different outcome of the eleventh century so much as a different eleventh century. Manzikert is weeks away and neither party is positioned for it.',
  proposals: [
    {
      action: 'trigger_dynamic_event',
      args: {
        actor: 5001,
        kind: 'historical_justice',
        title: 'A Duchy Held From Beyond the Map',
        description:
          'The game gives the Duchy of Anatolia to Philippe I of France, ruled from a court so distant the survey cannot place it. No French king held ground in Anatolia in this century; the Byzantine themes were lost to the Seljuks, not to the Capetians, and the record has Romanos IV marching east this very summer to recover them.',
        other: 5003,
        effects: { prestige: 150 },
      },
      headline: 'A French duchy in Anatolia',
      divergence:
        'Philippe I holds nine counties in Anatolia and the Duchy of Anatolia with them, from a seat outside the observed sphere. The record has this ground contested between the Byzantines and the Seljuks throughout the 1070s and nobody else.',
      historical_context:
        'Anatolia in 1071 was Byzantine territory under increasing Seljuk pressure. Romanos IV Diogenes marched east in the summer of that year and was defeated and captured at Manzikert on 26 August, after which the Byzantine position in the interior collapsed. No western European ruler held territory in Anatolia before the First Crusade, and the Latin principalities that followed were founded after 1098.',
      consequences:
        "Romanos IV receives the Director's event and 150 prestige. Nothing is claimed, nothing is transferred, and no war begins: this puts the argument in front of the player and the ground in front of the court.",
      confidence: 'high',
      narrative:
        'The clerks have been at the archive since Lent, and what they have produced is not a grievance but an inventory. Anatolia has been held from Constantinople since before there was a Constantinople to hold it from, and the banner over the Duchy is one no scribe in the city can read. The Sultan is moving east of Lake Van and the themes that should be meeting him answer to Paris.',
    },
  ],
  watchlist: [
    { id: 5002, why: 'Alp Arslan is the Seljuk advance. If he dies before Manzikert the whole eastern question changes shape.' },
    { id: 5003, why: 'The French holding rests on one man; his death is when the duchy either fragments or is inherited by somebody nearer.' },
    { id: 5005, why: "Armenia is the buffer. Its collapse is the record's own signal that Anatolia is open." },
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
      if (truncateMode) {
        const cap = Number(JSON.parse(body || '{}').max_tokens) || 2000;
        const limit = Math.floor(cap * 3.7);
        // Padded past the cap on purpose: the point is a reply that did not fit.
        const full = JSON.stringify({ ...good, assessment: `${good.assessment} `.repeat(Math.ceil((limit * 1.2) / good.assessment.length)) });
        console.log(`[stub] reply is ${full.length} chars against a ${cap}-token cap (${limit} chars): cut off, finish_reason=length`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: full.slice(0, limit) }, finish_reason: 'length' }] }));
        return;
      }
      const payload = JSON.stringify(
        bad ? badResponse
          : dynamicMode ? dynamic
            : momentumMode ? momentum
              : andalusMode ? andalus
                : good,
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: payload } }],
        }),
      );
    });
  })
  .listen(7999, '127.0.0.1', () => console.log(`[stub] pretending to be a model on :7999 (${bad ? 'malformed' : dynamicMode ? 'dynamic event' : momentumMode ? 'momentum' : andalusMode ? 'andalus' : 'well-formed'} output)`));
