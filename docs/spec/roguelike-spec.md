# Tales of Words: the Roguelike — Game Spec

**Version:** Draft 1.11 (12 Oct 2026)
**Lore source for magic:** `world/magic-system.md` (to be expanded in the wiki)
**Visual version with screen mockups:** https://claude.ai/artifact/L1sHrieFqRf2CYbsc8m61s
**Sync rule:** This doc and the artifact above are the same spec. Any change to one must be applied to the other.

A narrative text roguelike for mobile, in the spirit of End of Winter (Tailormade Games), set in the Tales of Words universe. Android first, iOS later. Portrait, one-handed, offline single-player. Names marked "placeholder" show the shape of the content and don't fix the lore.

## Changelog
- **1.11:** Rewards, items and level-ups (decided 12 Oct 2026): after every won fight, pick 1 of 3 rewards (skill or Word, item, crowns purse) drawn from the act's table for the fight's tier, with rarity; Intelligence adds skill or Word options; rerolls (3 per run) redraw the screen on their own stream; one item per slot, a new item replaces the old one and the cards items give leave with them; level-ups after elite and boss fights (2 stats, one favoured, +2 / +1, cap 7), Vitality gains heal by the same amount.
- **1.10:** Combat node (decided 12 Oct 2026): enemies and enemy groups as data; groups tiered normal / hard / elite / boss; the act's tier weights shift by step band, no stat scaling; HP carries over, Shield refills, statuses and cooldowns reset each fight; a fall mid-fight can be revived and the fight continues (half HP, Shield full, the player's statuses cleared, the player acts next); fights give no crowns directly (crowns come from rewards, step 4).
- **1.9:** Run map (decided 12 Oct 2026): no map ahead, choices drawn at each step; always 3 options with at least two node types, no merchant right after a merchant; step count rolled once per act from `act.json`; fixed nodes (mid-act event, boss) replace the choice at their step; routes after the boss by story flags; run state is plain data and quitting mid-node restarts that node with the same seed; revive at half HP rounded up.
- **1.8:** Loadout assembly: how stats, HP, Shield, powers, traits and starting cards are built from the five picks; stat floor 0; the run cap of 7 limits level-ups only; the starting technique offer (2 favoured + 1 any; more options with Intelligence 4 and 6); the companion's skill counts toward the 5 cards (fixes a contradiction).
- **1.7:** No energy: one action per turn (Strike, one ready skill incl. the companion's, or pass); skill costs removed; cooldowns are the only limit. Cards in combat (target choice, multi-hit damage effects). Enemy moves: weighted, with cooldowns, one per turn, picked in advance so the intent is exact.
- **1.6:** Consume effects can set a cap (eat up to N stacks). Slow decay names the statuses it slows (by id or tag) and whose (own or the other side's). New decay floors: a status never decays below a minimum (Glutton's Path).
- **1.5:** Damage-over-time powers: Bleed power (every hit), Burn power and Poison power (once per attack) from any source; Bleed power replaces the old "+1 Bleeding on a physical hit". Synergies defined: Afflictions and stack-count scaling, consume (a normal hit, stacks kept if deflected), convert triggers with a recursion cap of 4, slow decay (enemy DoTs lose stacks every other round).
- **1.4:** Stun and paralysis are build-up meters: Stun power (applied every hit, −1 per turn, full again each fight) and Paralysis power (applied once per attack, never drops) fill the target's meter; at 10 stacks the target loses its next turn (Stunned) or has a 50% chance to (Paralysed), then the meter resets. No immunity turn. Lei gives Stunned 4, Bing Paralysed 3. Turn order (higher Agility side first), cooldown meaning, turn details defined.
- **1.3:** Hit order details: Piercing ignores Warded (fixes the contradiction with "Warded bosses demand Piercing"); fallen units; status hooks get owner and stacks; hook lists built once at load; certain chances use no RNG; damage modifiers net out and round down; Shield damage counts for damage triggers; Thorns damage is untyped and hits Shield first; resistance on timed statuses removes turns; charges are used when the hit starts; deflected and 0-damage hits defined.
- **1.2:** Magic is words of power: every arcane skill is a Word (spoken form + glyph + meaning), cast with one generic animation (shout, glyph appears, flies to target). Firebolt renamed 火 Huo. Stats reframed for words (Arcana = power, Intelligence = vocabulary, Wisdom = healing/warding words). Placeholder Words; compound Words as a later idea.
- **1.1:** Technology decided: web app in TypeScript packaged with Capacitor (React, Vite, inkjs, RevenueCat, AdMob, Capgo live updates, preview links). Monetisation finalised: Ink unlocks everything; bundles £1.99 as shortcut; Premium £2.99 removes ads. Ads: revive (rewarded, max 2/run), reroll rewards (rewarded, max 3/run), end-of-run interstitial; Premium keeps the same limits. Limits enforced in the rules core. Art pipeline (one image per unit, generic animations). New Rewards screen with reroll.
- **1.0:** Added "Architecture and development": engine-free C# rules core, data-driven content, determinism, event stream, performance budgets, test strategy, code rules, agent workflow, deployment pipeline, build milestones. Engine choice (Unity vs Godot) left pending.
- **0.9:** Stacking rules (unlimited stacks; ticking, charge and timed decay; resistance lowers stacks applied). Thorns now fires on being attacked, even when Warded deflects. Synergy effects (Afflictions, consume, convert, slow decay) and example OP builds. Poisoned and Bleeding twists confirmed.
- **0.8:** Two life bars for every unit: Shield (hit first, refills each fight) and HP (carries over). Armor, accessories and some weapons give Shield and HP. Full named status list (Burning, Poisoned, Bleeding, Stunned, Paralysed, Ambushed, Enfeebled, Dimmed, Emboldened, Kindled, Warded, Thorns, Leeching, Piercing). Damage typed physical or arcane. Hit order defined. Hidden merged into Warded; Dirty Trick now applies Enfeebled.
- **0.7:** Max 5 skills total (Strike and companion skill included); gaining one when full means forgetting one or leaving the new one. Strike is the only no-cooldown skill and can be forgotten. Intelligence no longer gives a skill slot (gives an extra option when offered skills). New modular turn pipeline and status system (stun, paralysis, ambush, silence, etc.). New "Learning a skill" screen.
- **0.6:** Combat screen redesigned for portrait: arena on top (character and companion left vs enemy right), floating damage/heal/effect text from each head, intent line, character panel with HP/armor/energy and buff/debuff chips, skill cards along the bottom.
- **0.5:** Slots redefined. Character = 2 favoured stats that level faster (+2 vs +1) and event triggers (via tags). Companions = special skill and event triggers. Weapon = flat stat bonus and basic attack (no cooldown). Armor = stats and/or HP. Accessory = flexible (skill, stats, HP). Starting technique pick added (1 of 3 before Act I). All characters start at 2 in every stat, 3 in favoured.
- **0.4:** Each skill now scales with its own stats (not its item's). Skills are the combat actions, plus a free default attack (Strike) from the weapon. Starting skills: 1 each from character, weapon, armor, accessory. Items no longer have primary/secondary stats; the weapon's Strike scales with the weapon's stat.
- **0.3:** Three affinities replaced by seven stats: Might, Vitality, Cunning, Agility, Arcana, Intelligence, Wisdom. Items now have a primary and an optional secondary stat. Act-end stat raises added.
- **0.2:** Playable characters are now three class-free backgrounds (Scholar, Sellsword, Urchin) instead of the sisters. Loadout slots are now character, weapon, armor, accessory, path. Companions join during runs instead of being a loadout pick. Books removed as a slot. The sisters become legendary non-playable figures of the world. Bundles updated to match.
- **0.1:** First draft.

## Core loop
1. **Loadout:** pick one character, weapon, armor, accessory and path.
2. **Act opening:** illustration and prologue text.
3. **Steps:** 10–14 steps per act. At each step the player picks from 3 next nodes (event, combat, merchant; see "Run map"), each described in story words with its type shown as a tag.
4. **Act boss:** fixed combat at act end, then a route choice into the next act.
5. **End of run:** victory or death; earn Ink and lore entries.
6. **Archive:** spend Ink on unlocks, start a new tale.

First release: 3 acts for a full win, about 40–60 minutes. Runs can be paused and resumed at any node.

**Naming:** "Path" = the way-of-living loadout slot. Story branches between acts = **routes**.

## Characters
Characters are ordinary people of the world, defined by background rather than class. None is locked to a weapon or school of combat. A character gives two things: **favoured stats** that grow faster, and **event triggers** (story choices only that background can take).

### The seven stats
Every stat has one job in combat and one in events, so no stat is a dead pick.

| Stat | In combat | In events |
|---|---|---|
| Might | Physical damage of heavy weapons; breaking enemy Shield | Force, lifting, intimidation |
| Vitality | Max HP (20 + 5 per point); resisting bleed and poison | Endurance, cold, hunger, disease |
| Cunning | Critical hit chance; strength of bleed, poison and traps | Lies, locks, theft, haggling |
| Agility | Dodge chance; physical damage of light weapons and bows; acting first | Climbing, fleeing, sleight of hand |
| Arcana | The power behind spoken Words: arcane damage and summons | Sensing magic, using relics |
| Intelligence | Vocabulary: one extra option whenever you are offered skills or Words; shows enemy intent more precisely | Reading inscriptions and Words, history, languages, puzzles |
| Wisdom | Words of healing and warding; resisting fear, curses and madness | Insight, reading people, faith |

### Shield and HP
Every unit, player and enemy, has two life bars.
- **Shield** (blue, on top) takes damage first. Comes from items: armor mostly, some accessories and a few weapons (buckler, parrying dagger). Skills can restore it during a fight.
- **HP** (red) takes whatever gets through. Base HP = 20 + 5 per Vitality, plus HP from items. At 0 HP the unit falls.
- **Shield refills to full at the start of every fight; HP carries over** between fights and only returns through healing, rest and merchants. Shield = surviving one fight, HP = surviving the run.
- Piercing hits and Poisoned skip Shield and go straight to HP.

### Base characters
- Every character starts at 2 in all seven stats and 3 in its two favoured stats.
- At each level-up (end of each act, and after elite fights), the player is offered two stats, one always favoured, and raises one. A favoured stat gains +2; any other stat gains +1. Run cap is 7.
- Most characters have two favoured stats. Later characters can break the rule (e.g. one favoured stat and stronger event triggers).

| Character | Favoured stats | Base HP | Event triggers |
|---|---|---|---|
| The Scholar (attuned to magic) | Arcana, Intelligence | 30 | Reads old tongues and forbidden texts; welcome at academies and libraries; recognised by other mages |
| The Sellsword (martial training) | Might, Vitality | 35 | Old company contacts; guards and soldiers deal straight; can take bounty contracts |
| The Urchin (raised on the streets) | Cunning, Agility | 30 | Street contacts and thieves' signs; spots scams and traps; back-alley routes in towns |

Names are placeholder archetypes; they can become named people of the universe later. All three are free. Paid bundles add more backgrounds (e.g. a deserter with Might and Cunning, a pilgrim with Vitality and Wisdom).

Event triggers work through tags: an event choice asks for `soldier` rather than naming the Sellsword, so a future character with the same tag gets those choices for free.

### How stats, items and skills combine
- Every skill scales with its own stats, chosen to fit what it does. Dirty Trick scales with Cunning and Agility, the fire Word Huo with Arcana, Mend with Wisdom.
- The character decides which stats grow fastest. Items add flat stats and HP on top. Skills are worth more when they match your strongest stats.
- Off-type builds are allowed and change over a run. A Sellsword can carry an Ember Charm; at Arcana 2 its Huo is weak, but spending level-ups on Arcana makes it real. A Scholar gets there twice as fast.
- Items and paths can lower stats too, as the malus on strong items (heavy armor lowers Agility).

## Loadout slots
Every slot item is a data file with a list of modifiers. Most give a bonus; strong items also carry a malus. Modifiers are read the same way regardless of slot, so balancing is one system.

| Slot | What it gives | Example |
|---|---|---|
| Character | 2 favoured stats that level faster, plus event triggers | The Urchin: Cunning and Agility favoured; street contacts, spots scams |
| Weapon | A flat stat bonus and the basic attack (Strike): free, no cooldown. Some also give Shield. | Twin Knives: +1 Agility; Strike 3 damage +2 per Agility · Sword and Buckler: +1 Might, +6 Shield |
| Armor | Any mix of stats, HP and Shield | Riveted Brigandine: +1 Vitality, +10 HP, +8 Shield; malus: −1 Agility · Ward-stitched Robe: +1 Wisdom, +10 Shield |
| Accessory | Flexible: a skill, stats, HP, Shield, or a mix | Ember Charm: the Word 火 Huo · Lodestone Ring: +1 Arcana, +1 Intelligence · Iron Locket: +8 HP · Glass Ward: +6 Shield |
| Path | Way of living; stat changes and rule-bending modifiers that shape choices | The Sworn Road: +1 Wisdom; malus: locks dishonest choices |

### Loadout assembly (decided 12 Oct 2026)
The five picks build the player unit at the start of a run:
- **Stats:** every stat starts at 2, the character's favoured stats at 3. Then the stat modifiers of the weapon, armor, accessory and path are added. A stat never goes below 0 (a malus that would take it lower stops at 0).
- **Run cap:** level-ups can't raise a stat above 7, but items and paths can push it higher (Might 7 + Longsword = 8). The cap counts the stat without item and path bonuses.
- **HP:** max HP = 20 + 5 × Vitality (after modifiers) + the HP the items give. A run starts at full HP.
- **Shield:** max Shield = the sum of the items' Shield.
- **Powers and traits:** items and paths can give powers (Bleed, Burn, Poison, Stun, Paralysis: they add up) and traits (converts, slow decay, decay floors). Several decay floors on the same status: the highest counts.
- **Starting cards**, in this order: the weapon's Strike, the skill or Word the accessory grants (if any), then the starting technique. The companion's skill joins later and counts toward the 5.
- **Starting technique offer:** before Act I the player picks 1 of 3 skills from the technique pool (skills tagged `technique`). Two of the three scale with one of the character's favoured stats, the third is drawn from the whole pool. Intelligence (after modifiers) adds options: 4 at Intelligence 4, 5 at Intelligence 6, the extra ones drawn from the whole pool. Offers never repeat a skill or offer one already held. If the pool is too small, the offer is shorter. Drawn on its own RNG stream, so the offer doesn't change combat or map randomness.
- **Intelligence everywhere:** the same thresholds (+1 option at 4, +2 at 6) apply whenever the player is offered skills or Words.
- **Story tags:** the character's event tags and the path's rules travel with the run for events.
- **Details:**
  - The floor of 0 applies once, after all modifiers are added (weapon −3 then path +2 on a stat of 2 gives 1).
  - Modifiers, powers and traits are read in slot order: weapon, armor, accessory, path. Combined converts and slow-decay entries keep that order (converts fire in it).
  - Only items give HP and Shield; paths change stats, rules, powers and traits.
  - A skill "scales with" a stat when any scaling entry in any of its effects uses that stat.
  - A technique the player already holds can't be picked (it is never offered).
  - If fewer than two techniques scale with a favoured stat, the missing ones come from the whole pool, so the offer stays full while the pool allows.
  - The player may start without a technique (as when leaving a new skill); an empty offer means starting without one.
  - The offer's order carries no meaning; the screen decides how to show it.
  - A convert gives at least 1 stack.
  - Analyse is listed as a technique but needs effect types that don't exist yet (reveal intent); it joins the pool when they do.

### Companions
Companions join during a run through events, one at a time. Each gives a **special skill** (it counts toward the 5 cards; joining when you hold 5 works like learning a skill: forget one card or leave the companion's skill) plus their own **event triggers**. They can leave or betray you depending on your choices and path. Placeholder examples:

| Companion | Special skill | Event triggers |
|---|---|---|
| Mara, a smuggler | Smoke Bomb: Warded 1, next attack deflected (Warded 2 at Cunning 4+) | Hidden routes, black markets, knows people on the water |
| Brother Aldo, a defrocked priest | Last Rites: heal 6 +2 per Wisdom, remove one curse or status | Speaks with the dead, temple rites, old church grudges |

### The sisters in the game
Seffira, Viskan and Lina are not playable. They are legendary figures of the world, like Elminster in the Forgotten Realms. They appear in rare events, rumours told at merchants, and lore entries, and can shape the story without the player controlling them.

## Skills
- Skills are the combat actions, shown as cards. **A player holds at most 5.** Every skill counts: the weapon's Strike, the companion's skill, the starting technique and everything learned.
- **One action per turn.** On your turn you do exactly one thing: Strike, use one ready skill (the companion's skill included), or pass. There is no energy and skills have no cost; cooldowns are the only limit.
- **Strike** (weapon basic attack) is the only skill with no cooldown, so it is always available as your action. Every other skill has a cooldown of at least 1 turn.
- **Gaining a skill when full:** the new card is shown above the current five. The player forgets one current skill or leaves the new one. Forgetting is permanent for the run.
- **Strike can be forgotten.** A player can run only cooldown skills, risking turns where nothing is ready; then the only option is to pass. The game warns once before Strike is dropped.
- Changing weapon mid-run: the old weapon's Strike leaves with it, and the new weapon's Strike is gained like any new skill (it takes the free slot; if the old Strike had been forgotten and the hand is full, forget one or leave it). The weapon's stat bonus applies either way. The same holds for an accessory's granted skill or Word (see "Rewards, items and level-ups").
- Forgetting the companion's skill doesn't make them leave; they keep their event triggers. If they leave, their skill goes with them and frees the slot.
- Sources: accessory (if it gives one), companion, a **starting technique** (pick 1 of 3 before Act I, weighted to favoured stats), scrolls, trainers in events, merchants, level-ups, boss rewards.
- Each skill lists its own scaling stats (one or two) with a value per point. The card shows the current number from your stats.
- A skill is a list of effects built from a small set of building blocks: damage (physical or arcane, with a number of hits), heal, restore Shield, apply status, consume, summon, modify enemy intent. Each effect targets the user, the chosen enemy, or all enemies. New skills are new data, not new code.
- Upgrades (e.g. "Cleave+") are separate entries pointing to their base skill; an upgrade can lower the cooldown.

### Cards in combat (decided 11 Oct 2026)
- **A unit's cards** are its skills for the fight, at most 5 for the player. Each card is ready or on cooldown (see "Turn details": cooldown N means N turns of waiting).
- **Using a card** is the turn's one action. It must be ready and allowed by the action gate (a restrict filter can forbid it). The player chooses an enemy target for effects that target "the chosen enemy"; with one enemy it is chosen automatically. Effects run in the card's order; each damage effect is one attack of 1 or more hits (Twin Knives: 2). Then the card goes on cooldown and the turn ends.
- **Statuses on a damaging card ride on its hits.** If a card has a damage effect on the chosen enemy, its status effects on that enemy are carried by every hit of the first such damage effect (step 7 of the hit order), so a deflected hit applies none (Dirty Trick into Warded: no Enfeebled). A card with no damage effect applies its statuses directly: chance and resistance apply, but nothing can deflect it, since it is not an attack. Effects on the user (heal, restore Shield, own statuses) always apply directly.
- **Which enemies a riding status reaches:** a status effect on enemies rides on the hits of the card's first damage effect on any enemy; enemies that damage effect doesn't hit get the status directly (it never rides on a later damage effect). A status on "the chosen enemy" only rides on hits against that enemy.
- Statuses a card puts on its user are the user's own, so resistance doesn't apply (as for converts).
- Heal and restore Shield scale only with the user's stats and statuses, never the target's.
- Only player-side units use cards; an enemy acts through its moves. A card or move whose target has fallen during the card is skipped for that target.
- **Passing** ends the turn with no action. A turn with no ready card can only pass.
- **Strike once:** since every turn is one action, Strike can be used at most once per turn.

### Enemy moves (decided 11 Oct 2026)
- An enemy has a list of **moves** (data): each with a weight, a cooldown and the same effects as skills, plus a written intent line.
- **One move per turn.** The enemy's next move is picked by weight among its ready moves, on the combat RNG, at the start of the fight and right after each of its turns (a lost turn counts: its cooldowns have ticked, so it picks again), so its intent always shows the move it will use. If its chosen move becomes unusable (restricted), it picks again among the allowed ready moves; with none, it passes.
- Enemy moves target the player unless the move says otherwise.

### Sample skills
| Skill | Source | Cooldown | Effect | Scales with |
|---|---|---|---|---|
| Strike | Notched Longsword (basic) | none | 4 damage | +2 per Might |
| Strike | Twin Knives (basic) | none | 3 damage, 2 hits | +2 per Agility |
| 火 Huo (Word) | Ember Charm (accessory) | 1 | 3 arcane damage, Burning 2 | +3 per Arcana |
| Smoke Bomb | Mara (companion) | 3 | Warded 1 | Warded 2 at Cunning 4+ |
| Last Rites | Brother Aldo (companion) | 3 | Heal 6, remove 1 status | +2 per Wisdom |
| Cleave | Starting technique, scroll | 1 | 6 damage | +2 per Might, +1 per Agility |
| Dirty Trick | Starting technique, scroll | 1 | 3 physical damage, Enfeebled 2 | +2 per Cunning, +1 per Agility |
| Analyse | Starting technique, scroll | 2 | Reveal intent; next hit +10% | +10% per Intelligence |
| Mend | Starting technique, scroll, merchant | 2 | Heal 4 | +3 per Wisdom |
| Shore Up | Starting technique, scroll, armorer | 2 | Restore 5 Shield | +2 per Vitality |
| Bloodletter | Scroll, boss reward | 2 | 4 physical damage, Piercing, Bleeding 3 | +2 per Cunning |

Worked example, Sellsword in the mockups: base 2 everywhere, Might and Vitality 3. Longsword +1 Might; Brigandine +1 Vitality, +10 HP, −1 Agility; Sworn Road +1 Wisdom. Result: Might 4, Vitality 4, Agility 1, Arcana 2, Wisdom 3, 50 HP, 8 Shield. Strike 12, Cleave 15, Huo 9, Mend 13.

Example data:
```json
// content/characters/sellsword.json
{
  "id": "char.sellsword",
  "favoured": ["might", "vitality"],
  "eventTags": ["soldier", "mercenary_company", "bounty"]
}

// content/weapons/notched_longsword.json
{
  "id": "weapon.notched_longsword",
  "name": "weapon.notched_longsword.name",
  "stats": { "might": 1 },
  "attack": { "damage": 4, "scaling": [ { "stat": "might", "per": 2 } ] }
}

// content/skills/dirty_trick.json
{
  "id": "skill.dirty_trick",
  "cooldown": 1,
  "effects": [
    { "type": "damage", "damageType": "physical", "amount": 3, "target": "enemy",
      "scaling": [ { "stat": "cunning", "per": 2 }, { "stat": "agility", "per": 1 } ] },
    { "type": "status", "status": "enfeebled", "stacks": 2, "target": "enemy" }
  ],
  "upgrade": "skill.dirty_trick_plus"
}
```

## Magic: words of power
All magic follows the Tales of Words magic system: **a caster summons a word, and the word's power takes effect.** The mage opens a hand, shouts the word ("Huo!"), the written character for it (火, fire) appears in front of them, and the fire attack follows. The full system will be defined in the wiki; this section covers how the game represents it and should be updated as the wiki grows.

### Words in the game
- **Every arcane skill is a Word.** A Word is a skill with extra data: the glyph, the spoken form, its meaning (translated), its element tags and its effects. It follows every skill rule: a card, max 5 cards, cooldowns, one action per turn, its own scaling.
- **Casting is one generic animation, the same for every Word:**
  1. The caster's shout floats up from their head ("Huo!").
  2. The glyph appears in front of the caster, large and glowing in the element's colour.
  3. It flies or bursts toward the target, and the effect lands with its floating numbers.
  It takes about 0.8 seconds, shorter in fast mode. A new Word needs no new animation code.
- **Word cards show the glyph as their art**, with the spoken name and meaning: 火 Huo · Fire.
- **Learning Words:** from scrolls, teachers met in events, inscriptions and rewards, like any skill.
- **Carried Words:** an item can hold a Word so non-mages can speak it. The Ember Charm has 火 carved into it, which is how a Sellsword can shout Huo, weakly at Arcana 2.

### What the stats mean for Words
| Stat | Role in word magic |
|---|---|
| Arcana | The power behind the word: damage and effect size of Words |
| Intelligence | Vocabulary: one more Word offered when choosing, reading inscriptions and sigils in events, and later combining Words |
| Wisdom | Words of healing, warding and protection |

### Placeholder Words
These exist only to build and test the system until the wiki defines the real vocabulary. The glyphs and readings are standard Chinese; their game effects are suggestions.

| Glyph | Spoken | Meaning | Effect (suggestion) | Scales with |
|---|---|---|---|---|
| 火 | Huo | Fire | 3 arcane damage, Burning 2 | +3 per Arcana |
| 冰 | Bing | Ice | 4 arcane damage, Paralysed 3 | +2 per Arcana |
| 雷 | Lei | Thunder | 6 arcane damage, Stunned 4 | +3 per Arcana |
| 盾 | Dun | Shield | Warded 1 and restore 4 Shield | +2 Shield per Wisdom |
| 愈 | Yu | Heal | Heal 4 | +3 per Wisdom |

### Idea for later: compound Words
Holding two Words that form a compound unlocks a stronger third. For example, 火 (fire) and 山 (mountain) form 火山, volcano. The architecture supports this as a new effect module that checks the cards a unit holds. To decide once the wiki's rules on combining words exist.

### Words in events and localisation
- Inscriptions, sigils and seals in events are Words. Reading them is an Intelligence check, and a Word read in an event can sometimes be learned.
- **The spoken form and the glyph are never translated.** Only the meaning is translated ("Fire", "Feu").
- Glyphs are drawn from a web font cut down to only the characters the game uses, which keeps the app small. Any glyph can later be replaced by hand-drawn calligraphy through the art manifest, with no code change.

## Turns and status effects
Statuses change whether a unit acts, how hard it hits, and what happens when it is hit. None is special-cased in the combat code. Every status is a small module hooking into fixed points of a turn or a hit; the combat code only asks the statuses what to do.

### Turn pipeline
1. **Turn start:** statuses run start hooks (bleed and burn damage, regeneration).
2. **Action gate:** each status returns allow, skip (with reason), restrict (a filter on usable cards) or redirect (a forced action, e.g. confusion picks a random card). Skip beats redirect, redirect beats restrict, restrict beats allow.
3. **Action:** if not skipped, the unit takes **one action**: the player uses one ready card that passes the filter (Strike, a skill or the companion's skill) on a chosen target, or passes. Enemies use one move (see "Enemy moves").
4. **Resolve:** skill effects run; each hit follows the hit order below.
5. **Turn end:** cooldowns tick down, **including on skipped turns**. Ticking statuses lose a stack; ones at 0 are removed (details below).

**Turn details** (decided 11 Oct 2026):
- **Fight start:** every unit's Shield refills to full and its Stun power goes back to full (see "Stun and paralysis").
- **Turn order:** the side with the higher Agility acts first: the player's Agility against the highest Agility among the enemies. Ties go to the player. Then turns alternate: the player, then each living enemy in order, then the player again. One pass through all living units is a **round**.
- **Turn start, in order:** damage over time ticks (Burning, then Bleeding, then Poisoned). Each deals damage equal to its stacks, then loses 1 stack (except under slow decay, see "Synergy effects"). Burning and Bleeding hit Shield first; Poisoned goes straight to HP. This damage is not an attack: it triggers no Thorns, Warded, Leeching or powers. A unit that falls here takes no action and its turn ends.
- **Action gate:** checked after turn-start damage. Ambushed, then Stunned 10+, then Paralysed 10+ (see "Stun and paralysis"). A turn that is already lost doesn't check the others: their stacks stay for the next turn. A lost turn still runs turn end.
- **Cooldowns:** a skill with cooldown N can't be used on its owner's next N turns. Cooldown 1: used on turn 1, not ready on turn 2, ready on turn 3. Counters go down at the end of each of the owner's turns, skipped turns included, except on the turn the skill was used.
- **Turn end, in order:** cooldowns tick; ticking statuses other than damage over time lose 1 stack (Emboldened, Enfeebled, Kindled, Dimmed, Thorns, Leeching); the unit's Stun power drops by 1 (minimum 0).
- **The fight ends** as soon as every unit on one side has fallen, checked after every hit and every damage-over-time tick. If both sides fall in the same hit, the enemies win: a fallen player always reaches the death screen (and its revive).
- **Falling during your own turn:** a unit that falls to damage over time takes no action; its remaining damage-over-time statuses don't tick and its turn ends at once, without turn-end effects. A unit that falls during its action (to Thorns) also skips its turn-end effects.
- **Ambushed N:** each stack is one lost turn at the start of the fight, used when it causes a skip. The encounter usually applies Ambushed 1.
- **Between fights:** statuses and meters don't carry over. Each fight starts with only the statuses that items, the path and the encounter give.

### Stun and paralysis
Stunning and paralysing are builds. Many sources can give them (weapons, items, skills, Words, companions), and they add up.
- **Stun power X** (a unit attribute): every hit the unit lands adds X Stunned stacks to the target. A two-hit attack adds it twice. Stun power drops by 1 at the end of each of the unit's turns (minimum 0) and is back to full at the start of every fight.
- **Paralysis power X** (a unit attribute): every attack (a skill or Strike use, whatever its number of hits) adds X Paralysed stacks to the target once, if at least one of its hits landed. Paralysis power never drops.
- Skills and Words can also add a fixed number of stacks, like any status (Lei: Stunned 4 on each hit).
- **The meters:** Stunned and Paralysed stacks never decay on their own. At the target's action gate:
  - **Stunned 10 or more:** the target loses that turn, and Stunned resets to 0.
  - **Paralysed 10 or more:** 50% chance to lose that turn; Paralysed resets to 0 either way.
- **Resistance** works as for every status: Vitality against Stunned, Wisdom against Paralysed; each point above 2 removes 1 stack from each application (minimum 1).
- Stacks follow the hit rules: a deflected hit adds none; a 0-damage hit still adds them; Stun power 0 adds nothing. Stun power is added at step 7, after the hit's own statuses, even if the target fell during that hit (as for every status). Paralysis power is added after the attack's last hit, and not if the attacker or the target has fallen by then.
- Example: Stun 7 against a Vitality 2 enemy, one hit per turn: +7 (7), +6 (13, so the enemy loses its next turn and resets to 0), then +5, +4, +3 (12, stunned again).
- Example: Paralysis 2, one attack per turn: after 5 attacks the enemy has 10 stacks, rolls 50% on its next turn, resets to 0 and the build-up starts again.

### Hit order
Every hit (skill, Strike or enemy move) goes through the same steps:
1. **Base value** from the skill and the attacker's stats.
2. **Attacker modifiers:** Emboldened/Enfeebled for physical damage, Kindled/Dimmed for arcane.
3. **Attacked triggers:** Thorns fires now, whether or not the hit lands.
4. **Warded check:** if the target is Warded, the hit is deflected, one charge is used, and the hit stops (no damage, no statuses). A Piercing hit is never deflected and uses no Warded charge.
5. **Shield, then HP:** damage takes Shield first, the rest goes to HP. Piercing skips Shield.
6. **Damage triggers:** Leeching heals the attacker. Thorns damage is not an attack, so it never triggers Thorns or Warded back.
7. **Statuses** carried by the skill are applied, reduced by the target's resistance stat. Then the attacker's powers that act on every hit: Bleed power, then Stun power (see "Powers").

**Hit order details** (decided 10 Oct 2026):
- **Damage modifiers net out, then round down.** Emboldened and Enfeebled (physical), or Kindled and Dimmed (arcane), combine as one modifier: (buff stacks − debuff stacks) × 25%. Emboldened 3 and Enfeebled 1 = +50%. The result is rounded down and is never below 0.
- **Shield damage counts as damage.** Any damage to Shield or HP counts for damage triggers. Leeching heals up to the total damage dealt to Shield and HP.
- **Thorns damage is untyped.** It hits the attacker's Shield first, then HP. It is neither physical nor arcane, so attacker modifiers don't apply to it. It triggers nothing: no Thorns, Warded or Leeching, and no powers.
- **A hit always finishes.** If the attacker falls to Thorns at step 3, or the target falls at step 5, the remaining steps still run; statuses on a fallen unit have no effect later.
- **Several resisting stats** (Ambushed: Agility, Cunning): the highest one counts. A resisting stat of 2 or less has no effect (it never adds stacks).
- **Fallen units:** a hit by or against a unit that has already fallen does nothing. A unit that falls during a hit cannot be healed by that hit (no Leeching on an attacker killed by Thorns).
- **Resistance on timed statuses reduces turns.** For timed statuses (Ambushed), each point of the resisting stat above 2 removes 1 turn (minimum 1). Stunned and Paralysed are build-up meters and lose stacks like any status. A chance to apply is rolled first; resistance never changes the chance. Only chances strictly between 0% and 100% use the combat RNG, so certain effects never shift later rolls.
- **Piercing ignores Warded.** A Piercing hit (the keyword on the hit, or a Piercing charge on the attacker) is never deflected, uses no Warded charge, and skips Shield. A Piercing charge is used at step 2; a hit that already has the Piercing keyword uses no charge. A Warded charge is used at step 4.
- **A deflected hit triggers nothing after step 4:** no damage, no Leeching, no statuses, no powers. The Warded charge is used before the deflect is reported.
- **A hit that deals 0 damage** (e.g. after modifiers) still goes through steps 5–7, so its statuses still apply. It triggers no damage triggers (nothing was dealt).

A skipped turn shows the reason as floating text over the unit ("Stunned", "Ambushed") and moves on after a short pause.

```
// A status is a stateless definition (id, buff/debuff, decay, resisted by) plus hooks.
// Hit hooks get the hit, the unit that owns the status, its current stacks, and the context.
interface StatusEffect {
  onApply?(unit, ctx)
  onTurnStart?(owner, stacks, ctx)                // burning, bleeding, poisoned (in that order)
  gateAction?(owner, stacks, ctx): ActionGate     // Allow | Skip(reason) | Restrict(filter) | Redirect(action)
  modifyOutgoing?(hit, owner, stacks, ctx)        // emboldened, enfeebled, kindled, dimmed, piercing
  onAttacked?(hit, owner, stacks, ctx)            // thorns: fires even when deflected
  modifyIncoming?(hit, owner, stacks, ctx)        // warded
  onDealtDamage?(hit, owner, stacks, ctx)         // leeching
  onTookDamage?(hit, owner, stacks, ctx)          // no status uses it today (converts are unit traits)
  onTurnEnd?(owner, stacks, ctx)                  // ticking statuses lose a stack
  onExpire?(unit, ctx)
}

function runTurn(unit, ctx) {
  each(unit.statuses, s => s.onTurnStart?.(unit, ctx))
  const gate = combineGates(unit.statuses.map(s => s.gateAction?.(unit, ctx)))
  if (gate.skip)          ctx.showFloat(unit, gate.reason)
  else if (gate.redirect) resolve(gate.redirect, ctx)
  else                    resolve(await chooseAction(unit, gate.filter), ctx)  // one action; may be "pass"
  unit.cards.tickCooldowns()             // always, even when skipped
  each(unit.statuses, s => s.onTurnEnd?.(unit, ctx))   // ticking statuses lose a stack; Stun power −1
}
```

### Status list
Proposed names for the first set; numbers are starting values for playtesting.

| Status | Kind | Effect | Hook | Resisted by |
|---|---|---|---|---|
| **Damage over time** (stacks = damage, −1 stack each turn) | | | | |
| Burning | Debuff | At turn start, take damage equal to stacks, then lose 1 stack. Hits Shield first. | Turn start | Arcana |
| Poisoned | Debuff | Same, but goes straight to HP, ignoring Shield. | Turn start | Vitality |
| Bleeding | Debuff | Same, hits Shield first. Filled by Bleed power on every hit (so multi-hit attacks bleed faster), or by skills. | Turn start | Vitality |
| **Lost turns** | | | | |
| Stunned | Debuff | Build-up meter. At 10+ stacks the unit loses its next turn and the meter resets to 0. Filled by Stun power on every hit, or by skills. | Action gate | Vitality |
| Paralysed | Debuff | Build-up meter. At 10+ stacks the unit has a 50% chance to lose its next turn, then the meter resets to 0. Filled by Paralysis power once per attack, or by skills. | Action gate | Wisdom |
| Ambushed | Debuff | Skip the first turn of combat. Applied by the encounter. | Action gate | Agility, Cunning (spot it in the event before) |
| **Damage modifiers** (last N turns) | | | | |
| Enfeebled | Debuff | Physical damage dealt −25%. | Outgoing hit | Vitality |
| Dimmed | Debuff | Arcane damage dealt −25%. | Outgoing hit | Wisdom |
| Emboldened | Buff | Physical damage dealt +25%. | Outgoing hit | |
| Kindled | Buff | Arcane damage dealt +25%. | Outgoing hit | |
| **Defence and on-hit** | | | | |
| Warded | Buff | Deflect the next attack completely. Stacks are charges. | Incoming hit | |
| Thorns X | Buff | Each time you are attacked, the attacker takes X damage, even if the attack is deflected. | Attacked | |
| Leeching X | Buff | Each time you deal damage, heal X HP (up to damage dealt). | Dealt damage | |
| Piercing | Buff / keyword | Your next hits skip Shield and go straight to HP; stacks are charges. Also a keyword on single skills (Bloodletter). | Outgoing hit | |

Name notes: Weakened → **Enfeebled**, Weak will → **Dimmed**, Empowered → **Emboldened**, Strong will → **Kindled** (pairs read as opposites). Shielded → **Warded** (avoids confusion with the Shield bar). Drain life → **Leeching**.

Poisoned ignores Shield and Bleeding is applied on every hit, so the three damage-over-time effects play differently and reward different builds.

### Stacking
Stacking statuses is the main way to build something overpowered, and that's intended.
- **Every status has stacks.** Reapplying adds stacks (Burning 3 + Burning 2 = Burning 5). No cap.
- **Different statuses never replace each other.** A target can be Burning, Bleeding and Poisoned at once; all tick at turn start in that order (Burning and Bleeding wear down Shield, then Poisoned goes into HP).
- **Three ways stacks run out** (set per status in data):
  - *Ticking:* −1 stack at end of each turn. DoTs, Emboldened, Enfeebled, Kindled, Dimmed, Thorns, Leeching. Damage modifiers are ±25% per stack (Emboldened 3 = +75% this turn, +50% next).
  - *Charges:* −1 per use. Warded (per deflect), Piercing (per hit).
  - *Timed:* lasts N turns, no intensity. Ambushed.
  - *Build-up:* never decays; triggers at 10 stacks, then resets to 0. Stunned, Paralysed (see "Stun and paralysis").
- **Resistance** lowers stacks applied, not the chance: each point of the resisting stat above 2 removes 1 stack from an incoming application (minimum 1).
- **Lost turns can't chain forever:** the meters reset to 0 after they trigger, and Stun power drops every turn, so another lost turn always needs a new build-up. There is no immunity turn.
- Enemies follow the same rules (Thorns enemies punish multi-hit; Warded bosses demand Piercing).

### Powers
A power is a unit attribute that adds a status to the target as you attack. Many sources give powers (weapons, items, skills, Words, companions, paths) and they add up, so each status can be a build.

| Power | Adds | When | Changes during a fight |
|---|---|---|---|
| Bleed power X | Bleeding X | Every hit that lands | Never drops |
| Burn power X | Burning X | Once per attack, if a hit landed | Never drops |
| Poison power X | Poisoned X | Once per attack, if a hit landed | Never drops |
| Stun power X | Stunned X | Every hit that lands | −1 at the end of each of your turns; full again each fight |
| Paralysis power X | Paralysed X | Once per attack, if a hit landed | Never drops |

- Per-hit powers are added at hit step 7, after the hit's own statuses: Bleed power, then Stun power. Per-attack powers are added after the attack's last hit: Burn, Poison, then Paralysis power.
- Powers follow the hit rules: no stacks from a deflected hit; a 0-damage hit still adds them; power 0 adds nothing; resistance applies to each application (minimum 1). Per-attack powers are not added if the attacker or the target has fallen by the end of the attack.
- Damage over time does the rest: each stack does 1 damage at the unit's turn start, then 1 stack is lost, so keeping a DoT topped up builds into large damage.

### Synergy effects
Items, skills and paths can read statuses as well as apply them:
- **Afflictions** = number of different DoTs on a target (0–3). Damage can scale with it, and with the number of stacks of a tag on the target (Fester: 4 damage per Affliction + 1 per DoT stack).
- **Consume** effects remove all stacks of one status for a burst: a normal typed hit dealing stacks × multiplier (Combustion: all Burning, ×3, arcane). It goes through the hit order: modifiers apply, Warded can deflect it, Shield first. The stacks are counted when the hit starts. If the hit isn't deflected, all stacks of that status are removed at the end of the hit (including any the hit itself added); a deflected consume keeps them. A consume with 0 stacks still hits for 0.
  - **Cap (optional, per skill):** a consume can set a maximum ("consume up to 10 Burning, ×3"). It then counts min(stacks, cap) when the hit starts, deals that × multiplier, and removes exactly that many stacks at the end of the hit if it isn't deflected; the rest stay. Without a cap it eats all stacks, as above. In content, a consume is an effect `{ "type": "consume", "status", "multiplier", "damageType", "target", "max"? }`.
- **Convert** effects are triggers: when something happens to a unit, it gains a status (Mirror Ward: each deflect gives +1 Thorns). Triggers: a deflect, being attacked, dealing damage, taking damage. Once triggers exist that can be set off by other triggers (none do today), chains are capped at a depth of 4 per hit; deeper triggers are ignored and the event log notes it. Trigger details:
  - **Timing:** a deflect trigger fires right after the deflect; dealing-damage then taking-damage triggers fire at step 6, after Leeching; being-attacked triggers fire at the end of the hit (after a consume has removed its stacks). A trigger never changes the hit that set it off (being attacked can't grant a Warded that deflects that same hit).
  - The status gained is the unit's own, so resistance doesn't apply.
  - A unit that has fallen doesn't trigger.
  - Thorns damage and damage over time set off no triggers.
- **Slow decay** (a unit trait from items, paths or companions): it names which statuses it slows (by id or tag, e.g. the `dot` tag) and whose (the holder's own, or the units of the other side). While the holder is alive, those statuses lose a stack only every other round (rounds 2, 4, 6…); on the other rounds their decay is skipped. Damage over time still deals its damage every turn. Several sources covering the same status don't stack. "Alive" is checked when each decay happens, so killing the holder restores normal decay at once. Plague Censer: the other side's damage over time.
- **Decay floors** (a unit trait): a status on the holder never decays below a minimum (The Glutton's Path: Leeching never drops below 1). A floor only stops decay (turn-end ticking and the damage-over-time −1); it never creates a status the unit doesn't have or raises one already below the floor, and stacks spent as charges, consumed, or reset by a meter still go to 0. Several floors on the same status: the highest counts. Floors and slow decay combine: a slowed status skips its decay on odd rounds and never drops below its floor.
All of these are new effect types and hooks in the same system.

### Example builds
| Build | Core statuses | Key pieces (placeholders) | Weak against |
|---|---|---|---|
| The Triple Rot | Burning, Bleeding, Poisoned | Fester (skill): 4 damage per Affliction + 1 per DoT stack · Plague Censer (accessory): DoTs lose stacks every other round · Bloodletter | Short fights, cleansing enemies, high-Vitality bosses |
| The Bramble Wall | Warded, Thorns | Briar Mail (armor): start fights with Thorns 3 · Mirror Ward (accessory): each deflect gives +1 Thorns · Mara's Smoke Bomb | Enemies that don't attack (DoT casters), Piercing |
| The Red Feast | Emboldened, Leeching | Multi-hit Strike (Twin Knives) · Bloodthirst (skill): Emboldened 2, Leeching 3 · The Glutton's Path: Leeching never drops below 1 | Warded enemies, Thorns |
| The Pyre | Kindled, Burning | Huo (火), Ember Charm · Combustion (skill): consume all Burning, deal triple · Ashwood Staff (arcane Strike) | Dimmed, high-Arcana enemies |
| The Needle | Piercing, Poisoned | Ignores Shield entirely; kills armored bosses that stall other builds | Unshielded swarms |

Each build has a natural counter among enemy types, so runs must adapt. If one build wins every run, fix it with enemy variety and item rarity, not stack caps.

**Candidates for later**, already supported by the hooks: Frightened (no Might skills), Silenced (no-cooldown skills only, so Strike only), Confused (random ready card), Blinded (50% of attacks miss), Regenerating (heal each turn).

New statuses are modules registered by id, same pattern as node types. Status numbers live in content files; only genuinely new behaviour needs code. Enemies use the same pipeline.

## Nodes (modular)
Each node type is a self-contained module registered with the run engine. The engine only does: show node → wait → apply result. New types later (rest site, shrine, puzzle, ambush) = one new module and its screen.

```
interface NodeType {
  id: "event" | "combat" | "merchant" | ...
  mayFollowItself: bool             // false for the merchant
  canAppear(run, act, pack): bool   // filters by act, flags, loadout
  build({run, act, pack, ref, fixed, rng}): option   // rolls loot, enemies, stock; story text and tag
}
// The node then runs its own interaction (fight, Ink event, shop) and hands the run a node result.
// Its screen lives in the app, registered by the same id. Details in "Run map".
NodeRegistry.register(new EventNode())
NodeRegistry.register(new CombatNode())
NodeRegistry.register(new MerchantNode())
```

- **Events:** written in Ink (inkle), one file per event. Choices can check character triggers, companion triggers, any of the seven stats, character, path, items, companions or story flags. Locked options stay visible (greyed, with requirement).
- **Combat:** turn-based, one action per turn: the weapon Strike, the companion skill or one of your skills; each skill card shows its current value and scaling stats. Enemies are data files (stats, weighted moves, a written intent line per move). Intent is a text hint, not a number. Bosses can switch move sets at HP thresholds.
- **Merchant:** stock rolled from the act's loot table, prices scaled by act, spends crowns (in-run currency). Merchants can be recurring characters.

### Combat screen (portrait)
Top to bottom:
1. **Arena** (about the top 40%): character and companion on the left, enemy on the right (groups of up to three enemies stack on the right). Name and HP bar under each unit.
2. **Floating text:** damage, heals and effects pop up from the head of the unit they hit, bounce slightly, rise and fade within about a second. Damage white on enemies and red on you, damage absorbed by Shield blue with ⛨, heals green, statuses blue (good) or orange (bad). Consecutive popups stagger so they don't overlap.
3. **Enemy intent** under the arena: the written hint, plus a precise readout (type and rough damage) only with enough Intelligence.
4. **Character panel:** Shield bar over HP bar, then buff and debuff chips. Tapping a chip explains it. Every arena unit shows the same two bars under its feet.
5. **Skill cards** along the bottom, in thumb reach. Each card: name, current value from your stats, scaling stats, source. Strike always first with a gold edge; companion card has its own colour; cooldown cards dimmed with turns left. Never more than five cards, so the row always fits.
6. **Pass** button (ends the turn with no action). Full combat log one tap away, not on screen.

Tap a card to select, then tap an enemy to use it on (with one enemy, tap the card again). Using a card ends your turn. Long press shows full card text. Floating text and screen shake can be reduced in settings.


Example event (`content/acts/act1/events/ferryman.ink`):
```
=== ferryman ===
A ferryman waits where the causeway breaks.
He names his price before you speak: "Something you will miss."
* {might >= 3 and path == "sworn_road"} [Refuse, and wade across.]
    ~ hp(-8)
* [Give him 30 crowns.] ~ gold(-30)
* {hasTag("soldier")} [Show him your old company seal.]
* {companion == "mara"} [Let Mara talk.]
* {intelligence >= 3} [Read the sigil burned into his lantern.]
* {hasTag("street")} [Cut his mooring rope while he counts.]
    ~ flag("ferryman_wronged")
```

## Acts, routes and content packs
All story content lives in content packs discovered at startup. Base game = one pack; each new act or bundle = another pack. New universe material slots in without code changes.

```
content/
  base/
    pack.json
    characters/  scholar.json  sellsword.json  urchin.json
    weapons/  armor/  accessories/  paths/
    skills/  words/  companions/  enemies/  items/
    acts/
      act1_drowned_marches/   (placeholder name)
        act.json   prologue.ink   events/   art/
    lore/
    loc/ en.json fr.json
  bundle_deserter/            (paid pack, same structure)
```

`act.json` defines step count, node weights (e.g. event 50 / combat 35 / merchant 15), fixed nodes at given steps (mid-act event, boss), and routes to next acts conditioned on story flags.

### Run map (decided 12 Oct 2026)
There is no map ahead: after each node, the next choices are drawn.

**`act.json`** (content kind `act`, id `act.<name>`):
- `steps`: `{ "min", "max" }`, integers with 2 ≤ min ≤ max. The run rolls the act's step count once, when it enters the act, uniformly in that range. The count is shown ("step 4 / 12").
- `weights`: node type id → non-negative integer, e.g. `{ "event": 50, "combat": 35, "merchant": 15 }`. At least one weight above 0. A type id the run engine has no module for is an error when the run starts (content validation doesn't know the modules).
- `fixed`: fixed nodes, each `{ "at", "type", "ref" }`. `at` is a step number from 1 to min − 1, or `"last"`. Exactly one fixed node is `"last"` (the boss). At most one fixed node per step. `ref` is the data the node module builds from (an event id, a boss group id); the module checks it.
- `routes` (optional): the next acts, each `{ "to", "flags"?, "notFlags"? }`. `to` is an act id in the same pack. A route is open when every flag in `flags` is set and none in `notFlags` is. If an act has routes, at least one has no conditions, so a route is always open. An act with no routes ends the run in victory after its boss.
- `first` (optional, `true`): the act a run starts in. At most one per pack.
- `fixed` is required (every act has a boss). `routes: []` means no routes; a route with empty `flags` and `notFlags` has no conditions.
- When a run starts, every node type named by any act in the pack (in `weights`, even at weight 0, or in `fixed`) must have a module, or the run doesn't start.

**Choices at a step:**
- A step with a fixed node offers only that node (the player confirms it; there is no choice). Weights and the rules below don't apply to it.
- Otherwise the step offers **3 options**. The node types that can be drawn are those with a weight above 0 whose module allows them now (`canAppear`), minus a type that may not follow itself (the merchant) if the player's previous node was of that type. The previous node can be in the previous act, and a fixed node counts.
- Options 1 and 2 are drawn by weight from those types (the same type may come twice). If they are the same type and another type can be drawn, option 3 is drawn by weight from the other types only; otherwise option 3 is drawn like the first two. So a step shows at least two types whenever two are possible.
- Each option is built when it is offered (enemies, stock, its story text and its tag such as "Combat · Hard"), so what the player reads is what they get. Two options of the same type are different nodes.
- If no type can be drawn at a step, the content is broken: the run engine reports an error rather than skip the step.
- Randomness: the step count, each step's draw and each option's build use their own streams from the run seed, the act's position in the run (1st, 2nd, …), the act and the step (and the option's position), so nothing else in the run shifts them, and an act visited twice is drawn afresh.
- Options are shown in the order drawn (option 3 last).

**Node modules.** The engine knows only the interface: a node type has an id, says whether it may follow itself, says whether it can appear now, and builds an option from the run, the act, an optional `ref` and its RNG. The node then runs its own interaction (a fight, an Ink event, a shop) and hands the engine a **node result**: HP change, crowns change, story flags set or cleared (the combat node also reports the fight's tier, which opens the rewards and level-up steps). The engine applies it: HP stays between 0 and max HP; crowns never go below 0 (a result that would is a module bug and is refused). Event, combat and merchant modules arrive in later M2 steps.

**Run state** is plain data (it survives a JSON round trip): seed, phase, the loadout picks and assembled player data (HP, max HP, cards, base stats, event tags, path rules), crowns (start at 0, a placeholder for balance), story flags, run limits, the current act, step and step count, the current offer, the node being played and the previous node's type. Node progress (a fight in progress, a position in an Ink story) is not part of it.
- **Phases:** choosing a node → in a node → (after the boss) choosing a route → next act; or fallen; or ended (won or lost).
- **Pausing:** the run is saved between nodes and when a node is entered. Quitting in the middle of a node and resuming restarts that node from its beginning: it was built from its own seed, so the same enemies, stock and text come back.
- **Commands in, events out:** choosing an option, completing a node, choosing a route, reviving and ending the run are commands. A command that doesn't fit the phase, or names an option or route that doesn't exist, is refused and changes nothing.
- **Falling:** a node result that takes HP to 0 makes the player fall. They may revive (if the run limit allows it and a grant is given) at half max HP, rounded up, or let the tale end (the run is lost). Outside a fight, a revived player moves on as if the node had finished; how a revive continues a fight is decided with the combat node.
- When the run ends (won or lost), no node is current.
- After the last step's node, the run offers the open routes; choosing one starts that act at step 1 with a newly rolled step count. With no routes, the run is won.

### Combat node (decided 12 Oct 2026)
**Enemies** are data (content kind `enemy`, id `enemy.<name>`): a name key, stats (missing stats are 2), max HP, Shield, optional powers, traits and starting statuses, and a list of **moves** (each: id, weight > 0, cooldown ≥ 0, effects as in skills, an intent line key). Bosses switching move sets at HP thresholds come later.

**Enemy groups** (content kind `group`, id `group.<name>`): 1 to 3 enemy ids (the same enemy may appear more than once), a **tier** (`normal`, `hard`, `elite` or `boss`) and a story text key (what the player reads on the choice screen).

**Act data:** `act.json` gains `groups` (the group ids this act draws from) and `tiers`: a list of step bands, each `{ "from": step, "weights": { "normal": 70, "hard": 30 } }`. A band applies from its step until the next band; the first band starts at step 1. Tier weights are non-negative integers; `boss` can't be drawn (boss groups only appear as fixed nodes).
- Enemies don't scale with steps: their numbers come from their files, and later steps feel harder because the bands give more Hard and Elite fights.

**Building a combat option** (drawn, not fixed): the tier is drawn by the current band's weights among tiers that have at least one group in the act; then one group of that tier is drawn with equal chance. The option's tag is the tier ("Combat · Hard"); its text is the group's text. A fixed combat node uses its `ref` as the group id, whatever its tier. The combat type can appear at a step when its band has a tier with weight above 0 and at least one non-boss group of that tier in the act. Node modules read content through the run's content pack (ADR 0011).

**The fight:**
- The player unit is built from the run: the loadout's item and path modifiers on the run's base stats, the run's current HP (it carries over), Shield full, the run's cards in order, powers and traits from the loadout. Statuses, cooldowns and power meters start fresh every fight.
- Enemies are built from their files with ids in group order. The fight uses its own RNG stream from the run seed, the act's position, the act, the step and the option, so restarting the node replays the same fight for the same commands.
- Commands: play a card (with a target when needed) or pass. Enemy turns run on their own until it is the player's turn again or the fight is over.
- **Won:** the node result is the HP change (current HP − HP at the start). No crowns directly: fights pay through the rewards screen.
- **The player falls:** the run is told the player fell during the node (phase "fallen", the node stays current). If the player revives, the run goes back into the node with HP = half max HP rounded up, and the fight continues: Shield refilled, the player's statuses cleared, the enemies unchanged (HP, statuses, chosen intents, cooldowns), the player's cooldowns kept, and the player acts next. The turn in which the player fell is finished first: its unit's cooldowns tick, its Stun power drops by 1 and an enemy picks its next move (so the intent shown is the move it will use); statuses don't decay on that turn, so the enemies' statuses stay as they were. If the enemies had fallen too, the revived player has won the fight. If the tale ends, the run is lost.
- The run is also saved after a revive. Resuming in the middle of a fight restarts it from the beginning, with the HP and revives the save holds.
- **Details:** enemy stats are integers ≥ 0; starting stacks are integers ≥ 1; move weights are integers ≥ 1 and move ids are lowercase (`[a-z][a-z0-9_]*`), unique within the enemy. An act has `groups` and `tiers` together or neither; `tiers` is non-empty; a group id appears once in `groups`. A fixed combat node needs a `ref` naming a group. The fight's max HP is the run's max HP (level-ups change it later). An unknown card id in the run is a bug (error).

### Rewards, items and level-ups (decided 12 Oct 2026)
**Rewards after a fight.** Every won fight opens a rewards screen: **3 options, pick 1** (or take nothing). An option is a **skill or Word** (learned), an **item** (weapon, armor or accessory, equipped) or a **crowns purse**.
- The act's `rewards` table, by the fight's tier (`normal`, `hard`, `elite`, `boss`), gives the weights of the three kinds, the rarity weights (`common`, `uncommon`, `rare`) and the purse range. Elite and boss tables lean to better rarities.
- Skills, Words, weapons, armor and accessories have a `rarity` (default `common`). An option of kind skill/item draws a rarity by weight among rarities that have something left, then a thing of that rarity with equal chance.
- Never offered: a skill or Word the player holds, an item they wear, or the same thing twice on one screen. At most one crowns purse per screen. A kind with nothing left can't be drawn.
- **Intelligence** adds options (+1 at 4, +2 at 6, from the final stat), and the extra options are always skills or Words.
- **Rerolls** (3 per run, ad or Premium grant, limits in the core) redraw the whole screen. Each screen draw uses its own stream from the run seed, the node and the reroll number, so a reroll changes nothing else.
- Crowns are the in-run money for merchants; Ink is counted at the end of the run.

**Learning a skill or Word.** With fewer than 5 cards, the new card is added at the end. With 5, the player forgets one card (Strike included; forgetting is permanent for the run) or leaves the new one.

**Items.** One item per slot. Taking an item replaces the one in its slot, which is lost (the screen shows the comparison before the pick).
- Stats, powers and traits follow the new item at once. Max HP is recomputed (20 + 5 × Vitality + items' HP) and current HP moves by the same amount, staying between 1 and the new max. Shield is the items' Shield (it refills each fight anyway).
- **Cards belong to their item:** the old weapon's Strike or the old accessory's granted skill leaves with it (if still held). The new item's card is then gained like any new skill (added if there is room, otherwise forget one or leave it).

**Level-ups** come after each **elite** and **boss** fight, after its rewards.
- The player is offered **2 stats**: one of the character's favoured stats, and one more from the other stats (the other favoured stat included); only stats whose base value is below the run cap of 7 can be offered. If no favoured stat is below the cap, both come from the rest. Fewer eligible stats give a shorter offer; none means no level-up.
- Picking a favoured stat gives **+2**, any other **+1**, never above 7 (base value, before items and path). Drawn on its own stream; level-ups can't be rerolled.
- **Vitality:** each point gained raises max HP by 5 and **current HP by the same amount**.

**Order after a fight:** rewards, then learning (if a skill was taken with a full hand), then the level-up, then the next step (or, after the boss, the routes).

## Progression: Ink ✒
Meta currency earned every run (win or lose) from steps cleared, bosses, lore found and first-time events. Never sold for money.

| Unlock | Ink price | Rough runs |
|---|---|---|
| Single weapon / armor / accessory / path | 300–600 | 2–4 |
| Character | 1,200 | 7–9 |
| Full bundle item by item | ≈ 3,000 | 18–22 |

Assumes ~150 Ink per average losing run, ~400 per win. To tune with playtesting and analytics.

## Monetisation
Free to play. **Everything in the game can be unlocked by playing.** Money only buys time and removes ads.

| Offer | Price | What it does |
|---|---|---|
| Ink ✒ | Free, earned every run | Unlocks every character, item, path and bundle. Never sold for money. |
| Character bundle | £1.99 | Unlocks one bundle now instead of grinding Ink for it: 1 character, 1 weapon, 1 armor, 1 accessory, 1 path. |
| **Premium** | £2.99, one-time | Removes all ads. Revives and rerolls become instant, and the end-of-run ad disappears. The main purchase. |

### Ad placements
| Moment | Ad type | Player choice | Limit |
|---|---|---|---|
| Death | Rewarded video | Opt-in: watch to revive at half HP, or let the tale end | **2 per run** |
| Rewards after a combat or event | Rewarded video | Opt-in: watch to reroll the reward choices | **3 per run** |
| End of run, after the summary, before the main screen | Interstitial | Shown automatically | 1 per run |

- **Premium players keep exactly the same limits**: 2 revives and 3 rerolls per run, just without ads. Paying never makes a run stronger, so there is no pay-to-win.
- There are no banner ads and no ads anywhere else.
- **If no ad can load** (offline, no ad available), a revive or reroll is still granted after a short wait, so a bad connection never costs a run. The end-of-run ad is simply skipped.
- **Consent:** in the UK and EU, the game asks for ad consent (Google's consent form) before the first ad. Players who refuse still get ads, but non-personalised ones.
- The age rating and ad content filters need setting before launch (see "Still to decide").
- No gacha, no loot boxes, no premium currency, no energy timers.

## Technical approach
- A web app in TypeScript, packaged for Android with Capacitor. Details in "Architecture and development".
- No server of our own: local save, Google Play Games cloud save, RevenueCat and Google Play for purchases.
- Save: one JSON file written after every node, lightly encrypted and versioned; holds meta progress (Ink, unlocks) and the current run.
- Seeded runs for bug reports, replays and future daily challenges.
- Firebase Analytics (where runs end, choices picked, Ink per run, ad and purchase funnel) and Remote Config (Ink rates, prices, ad tuning). The per-run revive and reroll limits are fixed in the game rules, never in remote config.
- Every change playable on a private preview link; after launch, web-only updates ship as live updates without store review.

## Localisation
- Every player-facing string is a key; Ink files exported per event for translation.
- Launch in English and French; plan CJK font support from the start.
- UI leaves ~30% extra room for longer languages.
- Tags for gender and plurals in story text.

## Planned screens (mockups in the artifact)
1. Loadout · 2. Act opening · 3. Event · 4. Choosing the next node · 5. Combat (portrait arena + skill cards) · 6. Rewards (pick one, reroll with ad) · 7. Merchant · 8. Learning a skill (forget one or leave it) · 9. Death and revive · 10. Archive and store

## Architecture and development
This section is the working brief for anyone, human or agent, writing code for the game. **The spec above is the source of truth: rules change here first, then in tests, then in code.**

### Technology (decided 10 Oct 2026)
**A web app in TypeScript, packaged for Android (and later iOS) with Capacitor.**
- **Why:** the game is 2D text, cards, bars and images, which HTML and CSS handle well. Agents build and test web code best. Every change can be played in a browser without a store release. The approved HTML mockups carry over almost directly.
- **Stack:**
  - TypeScript in strict mode;
  - Vite to build;
  - React for screens;
  - CSS and the Web Animations API for motion;
  - inkjs for events;
  - Capacitor for the Android shell;
  - pnpm workspaces for the monorepo.
- **Fallback:** if the packaged app ever feels too un-native, the UI can move to React Native. The rules core doesn't depend on the UI, so combat and run logic stay untouched.
- **Not used:** Unity, Godot, 3D, and any heavyweight game engine. A PixiJS canvas layer can be added later for one screen if CSS isn't enough, without changing anything else.

### Principles
1. **The rules core is plain TypeScript with no UI or platform code.** Combat, statuses, stacking, hit order, skills, stats, runs, rewards, run limits, economy and content loading live in `packages/core`. It never imports React, the DOM, Capacitor, ads or billing.
2. **Content is data.** Characters, items, skills, status numbers, enemies, acts and events are JSON and Ink files; art is image files. New content never needs code. New *behaviour* is a new module registered by id (status, effect, node type), never an `if` in existing code.
3. **Deterministic.** All randomness comes from seeded RNG streams passed through the context, never `Math.random()` or the clock. Same seed + same commands = same result. This gives replays, reproducible bug reports and daily challenges.
4. **Commands in, events out.** The UI sends commands (`PlayCard`, `EndTurn`, `ChooseOption`, `Revive`, `RerollRewards`). The core resolves them instantly and returns events (`HitResolved`, `ShieldBroken`, `StatusApplied`, `TurnSkipped`, `RewardsRerolled`…). The UI plays those as animations and floating text. The core never waits for animation.
5. **Platform features sit behind adapters.** Ads, billing, storage, analytics, haptics and live updates are interfaces in `packages/platform`. Each has a native implementation (Capacitor plugins) and a **web mock**, so the full game, including revives, rerolls and purchases, works in a browser for testing.

### Solution layout
```
packages/
  core/          plain TS, no DOM, no platform
    combat/      turn controller, hit pipeline, combat state, events
    statuses/    status interface, registry, one file per status
    effects/     damage, heal, restore shield, apply status, consume, convert…
    units/       stats, Shield/HP, cards, loadout
    run/         run state, node graph, level-ups, rewards, RUN LIMITS, Ink, unlocks
    nodes/       node type interface, registry, event/combat/merchant
    content/     loaders, schema validation, id resolution
  narrative/     inkjs adapter: run state in as variables, effects out
  platform/      adapters: ads, billing, entitlements, storage, analytics,
                 haptics, live updates; native and web-mock implementations
  app/           React screens, animation, input, audio, localisation
content/
  base/ …        content packs (see "Acts, routes and content packs")
  art/           images + art manifest
tools/sim/       headless simulator (Node) for balance and performance
android/         Capacitor native project
docs/adr/        architecture decision records
```

### Combat core design
- **State:** `CombatState` holds the units, turn number, RNG streams and an event list. A unit holds stats, Shield, HP, its cards (max 5) and its statuses.
- **Statuses are one entry per id with a stack count**, not one object per application. Burning 50 is a single entry. Each status definition (decay type, resisting stats, hooks) is stateless and registered once; a unit holds only the stack count per id. Who applied a status is added only if a later rule needs it.
- **Hooks are pre-sorted.** For each hook (turn start, action gate, outgoing, attacked, incoming, took damage, dealt damage, turn end), the core keeps the list of statuses that implement it, built once at load. Dispatch only touches those statuses and skips any the unit has no stacks of (ADR 0005).
- **Statuses never name other statuses.** Cross-status logic goes through tags and queries (`countWithTag("dot")` for Afflictions), so adding a status never means editing another.
- **The hit pipeline is a fixed list of stages** matching the hit order in this spec. New behaviour adds a hook or an effect, not a stage, unless an ADR says otherwise.
- **Recursion guard:** triggers caused by triggers are capped at depth 4 per hit, so a bad content combination can't loop forever.
- **The event log** is the single output: the UI animates it, tests assert on it, replays compare it.

### Monetisation architecture
The rules on ads and limits are product rules, so they live where nothing can bypass them.
- **Run limits are enforced in the core.** `RunState.limits` tracks `revivesUsed` (max 2) and `rerollsUsed` (max 3). The core refuses a `Revive` or `RerollRewards` command past the limit, whatever the UI or premium status says. The limits are constants in the rules, not remote config, so they can't drift.
- **The core never knows about ads or money.** `Revive` and `RerollRewards` need a **grant** from the platform layer. The `MonetisationService` decides how to get one:
  - Premium owned: grant immediately.
  - Otherwise: show a rewarded ad, grant on the ad's reward callback.
  - No ad available: grant after a short wait.
- **The end-of-run ad** is triggered by the app on the `RunEnded` → summary → "back to menu" step, skipped for Premium or when no ad is available.
- **Rerolls don't change the rest of the run.** Rewards use their own RNG stream, seeded from the run seed, the node and the reroll number. A reroll changes only that reward screen, and replays record rerolls as commands.
- **Entitlements:**
  - Premium and bundles are non-consumable Google Play products.
  - They are bought and restored through RevenueCat's Capacitor SDK, which also covers iOS later.
  - Entitlements are cached locally, so the game works offline.
  - Ink is not sold, so it lives only in the local save; no server is needed.
- **Ads:** AdMob through the Capacitor AdMob plugin, rewarded video and interstitial only, with Google's consent form (UMP) before the first ad.
- **Web mock:** in browser builds, ads show a 3-second placeholder card and purchases succeed instantly with a test flag. Every monetisation flow can be tested and watched in the browser.

### Art and animation
- Each character, companion and enemy is **one transparent image** (WebP, with PNG accepted) in `content/art/`.
- `art-manifest.json` maps ids to files with:
  - display size;
  - a foot anchor (where it stands);
  - a head anchor (where floating text starts);
  - an optional tint colour.
- **Animations are generic code applied to any image:**
  - shake and red flash when hit;
  - a short lunge when attacking;
  - slow breathing scale at rest;
  - fade and drop on death;
  - status glows (orange Burning, green Poisoned, red Bleeding, blue shimmer Warded).
- **Swapping art means replacing a file with the same name.** No code change, no rebuild of logic. Scene illustrations for acts and events work the same way.
- Later, Rive or Spine animations can replace the image for specific characters behind the same manifest entry.
- **Words** (spells) need no art: the glyph is drawn from a cut-down CJK web font, with the generic cast animation (shout, glyph appears and glows, flies to the target). A hand-drawn calligraphy image can replace any glyph through the manifest.
- Animations only use `transform` and `opacity` (GPU-friendly), and respect the reduced-motion setting.

### Performance rules
- **No object churn in the hit pipeline.** Hits reuse pooled objects; no spreads, closures or array copies in hot paths. Garbage collection pauses are what make mobile combat stutter.
- **Stacks are integers**, so 50 stacks cost the same as 1.
- **Logic budgets** (to confirm on a real mid-range Android phone):
  - one hit with 10 statuses on each side: under 0.1 ms;
  - a whole player turn including the enemy response: under 2 ms;
  - the CI benchmark (10,000 simulated fights with 50+ stacks) fails the build if it gets more than 20% slower than its baseline.
- **UI budgets:**
  - 60 fps during combat animations on a mid-range Android phone;
  - at most 8 floating texts on screen at once (extra ones queue);
  - images sized at 2× display size;
  - act art loaded when the act starts;
  - app download under 60 MB at launch.

### Testing strategy
- **Unit tests** (Vitest) for every status, effect and stage.
- **Scenario tests written from the spec**, as readable data files that you can check too:
  ```yaml
  name: Warded plus Thorns deflects and reflects
  player: { char: sellsword, statuses: { warded: 1, thorns: 3 } }
  enemy:  { id: hollow_warden, hp: 50, shield: 0 }
  steps:  [ enemy_attacks: halberd_swing ]
  expect: { player.hp: unchanged, player.warded: 0, enemy.hp: 47 }
  ```
- **Invariant tests** (fast-check): thousands of random seeded fights and runs, checking rules that must always hold:
  - HP never above max; Shield and stacks never negative;
  - Thorns never triggers Thorns; trigger depth never above the cap;
  - cooldowns tick on skipped turns; Stunned and Paralysed reset to 0 when they trigger;
  - **never more than 2 revives or 3 rerolls in a run, premium or not**;
  - same seed and commands give the same event log.
- **Replay tests:** saved seeds and commands with their recorded result. Any change is flagged, so balance never changes by accident.
- **Content validation:** every content file checked against its schema, every referenced id and art file must exist, every Ink file must compile.
- **Browser tests** (Playwright) on the preview build with mock ads and billing. These cover full flows: start a run, fight, die and revive, reroll rewards, end the run, see the end-of-run ad placeholder, buy Premium, check that the ads are gone. They record video, and you can also watch them live in Claude's browser.
- **Device check** on the Google Play internal test track at each milestone: real ads (test units), real purchases (test accounts), performance.

### Code rules (the reviewer's checklist)
1. `packages/core` imports nothing from `app`, `platform`, React, the DOM or Capacitor (enforced by lint rules).
2. No content id is compared in rules code (`if (status.id === "burning")` is rejected). Use hooks, tags and data.
3. All randomness through the context's RNG streams. No `Math.random()` or `Date.now()` in rules.
4. TypeScript strict, no `any`, no non-null assertions in core.
5. All player-facing text through localisation keys.
6. No allocations, spreads or closures in the hit pipeline or turn controller.
7. **Revive and reroll limits only in the core.** The UI never grants a revive or reroll itself; ads and billing are only reached through the platform adapters.
8. Every rule in the spec has a scenario test; every new behaviour arrives with its tests.
9. Save data is versioned with a migration for every format change.
10. Any change to the core structure (new pipeline stage, new hook, new module type) needs a short ADR in `docs/adr/`.
11. Performance benchmark and browser tests must pass.

### Agent workflow
| Role | Who | Sees | Does |
|---|---|---|---|
| Orchestrator | Claude in the main session, with you | Spec, repo, results | Turns spec sections into tasks, hands them out, collects results, prepares merges |
| Spec-to-tests | Agent, fresh context | Spec only, never the code | Writes scenario tests, invariants and browser flows from the spec |
| Builder | Agent | Spec, task, tests, code | Implements until all tests pass; adds unit tests |
| Reviewer | Agent, fresh context | Diff, code rules, benchmark and test output | Checks the code rules and performance; can block a merge |
| Product owner | You | Everything, plus the preview link | Plays builds, approves merges, decides on the spec |

**Loop for each task:**
1. The orchestrator takes one spec section and writes a task.
2. Spec-to-tests writes the failing tests.
3. The builder makes them pass.
4. CI runs tests, simulation, benchmark, content validation and browser tests, and deploys a preview link.
5. The reviewer checks against the code rules.
6. You play the preview, approve, and the change is merged.

If the spec turns out to be unclear or wrong during a task, work stops and the spec is fixed first.

### Builds and deployment
You shouldn't need a store release to see progress.
- **Every change:** GitHub Actions runs all checks and publishes a **private preview link** (Cloudflare Pages). Open it on your phone or desktop to play that exact version.
- **Main branch:** a stable "staging" link that always has the latest approved build.
- **Milestones:** a version tag builds the Android app (Capacitor + Gradle) and fastlane uploads it to the Google Play **internal test track**, to check real ads, purchases and performance on a device.
- **After launch:** web-only changes (content, balance, UI, bug fixes) ship as **live updates** through Capgo, with no store review. Changes to native parts (new plugins, Capacitor upgrades) go through the store. Each live update is tied to the native versions it supports, so an old app never receives code it can't run.
- You promote releases to production by hand.

### Build order
| Milestone | Content | Done when |
|---|---|---|
| M0 Foundations | Monorepo, CI, preview links, lint boundaries, content schemas, empty core, simulator skeleton, first ADRs | A blank app is live on a preview link |
| M1 Combat core | Shield/HP, hit pipeline, turn pipeline, all 14 statuses with stacking, cards and Strike, cooldowns, enemy moves | All spec scenarios pass headless; benchmark baseline recorded |
| M2 Run layer | Loadout, stats and level-ups, node registry, events via inkjs, merchant, rewards and rerolls, learning skills, companions, run limits | A full Act I run plays headless in the simulator |
| M3 Game shell | Screens from the mockups, combat played from the event stream, art manifest and generic animations | Act I playable on the preview link, on a phone browser |
| M4 Platform | Saves and cloud save, Ink unlocks, Premium and bundles via RevenueCat, AdMob rewarded and interstitial, consent, web mocks, localisation | Revive, reroll, end-of-run ad, purchase and restore all work on an internal-track device |
| M5 Content and balance | Act I complete, enemies, items, balance with the simulator | Closed playtest build |
| M6 Release | Acts II and III, polish, store listing, live updates | Production release |

## Still to decide
- The real vocabulary of Words (from the wiki), and whether compound Words exist.
- Age rating and ad content filters (Play Console target audience and AdMob settings).
- Names and backstories for the three base characters, or whether they stay unnamed archetypes.
- Stat balance: starting values, the +2 / +1 level-up rule, skill scaling numbers and run cap of 7 are first guesses for playtesting.
- Which companions exist and how many can join per run.
- Whether forgotten skills can come back (a trainer who re-teaches them, at a price).
- Whether bosses get partial resistance to stacking (e.g. half stacks from lost-turn statuses).
- Companions: who they are, how they join, relationship meters.
- Where and how often the sisters appear in events and lore.
- Setting of Act I and the main threat across the three acts.
- Launch content volume (suggested: 3 acts, ~25 events per act).
- In-game art style: painted 2D, or stylised from the 3D renders.
- Difficulty tiers after the first win.
