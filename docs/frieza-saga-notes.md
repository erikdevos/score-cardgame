# Frieza Saga — transcription notes for the reviewer

142 cards (1-125, promos P1-P11, wrapper redemptions P12-P17) transcribed from the card images on 2026-10-18, all `verified: false`. 74 cards carry a `needsReview` note. The notes below come from the five transcription passes (one per number range) and list new handlers, assumptions and odd cards. Engine status and open questions are in `docs/dsl-gaps.md` ("Frieza Saga").

## Part A notes: Frieza Saga 1-28 (all commons)

28 cards, 11 with needsReview. Validator: 0 invalid. No personalities, no Dragon Balls, no new card types in this range.

### New handlers

| Handler | Params | Behaviour | Cards |
|---|---|---|---|
| `ifInPlay` | `{ cardName?: string, character?: string, anywhere: boolean, then: Effect[] }` | Resolve `then` only when a card with that name (or a personality/ally of that character) is in play; `anywhere: true` = on any player's side. | FS-15, FS-16, FS-27 |
| `variableCost` | `{ costType: "LIFE_CARDS", min: 1, max: 7, damageLifeCardsEqualsCost: true }` | The player picks a cost between min and max; if the attack succeeds, the defender takes that many life cards. | FS-24 |

### Existing handlers with new params

- `ifUsedBy` + `role: "mainPersonality"` (FS-13: "If Piccolo or Nail is your main personality"). Could also become part of the proposed generic condition wrapper.
- `preventAttack` + `protectsAlignment: "Villain"` (FS-17: "No physical attacks will work against villains this combat").
- `removeFromGame` + `zone: "discard" | "lifeDeck"`, `position: "top"` (FS-14: top 3 of the opponent's discard pile; FS-21: top card of your own life deck).
- `removeFromGame` + `amount: "choice"`, `perOwnLifeCardsRemoved: 2`, `optional: true` (FS-23: remove 1 opponent drill per 2 own life cards removed from the game).
- `endNextCombat` + `trigger: "currentOrNextOpponentCombat"`, `timing: "immediate"` (FS-19: "Stops an opponent's current or next combat").

### Titles, styles, types

- No personalities, so no titles list.
- No new styles. Styles used: Orange, Red, Blue, Saiyan.
- Printed spelling kept: FS-2 "Orange Kamehemeha Attack" (sic), FS-20 "Straining, Floating Attack Move" (with comma).
- FS-8 "Recoome Boom": green Saiyan-colour card with "Villains, Goku, and Gohan only" but no style word and no style kanji: no style, named Recoome.
- FS-12 "Saiyan Energy Focus" and FS-18 vs FS-12: FS-12 is a Saiyan-style card without the printed Villains/Goku/Gohan restriction, so no usableBy (same as SS-197).

### Rules observations

- FS-23 "Straining Defense Move" is type Combat with a sword icon (attack phase) even though its title says Defense.
- FS-24 and FS-25: life cards as a cost ("costing 1-7 life cards", "Costs 2 life cards"); FS-22 too (LIFE_CARDS 1).
- FS-15 references "Dragon Ball 6" without Earth/Namekian; with Namekian Dragon Balls in this set the reference is ambiguous.
- FS-13, FS-15, FS-27: "raise/lower ... 2 levels" when a condition holds is read as 2 in total (not 1 + 2).
- FS-13 and FS-15 say "Hero's anger": read as the user's anger, no usableBy added. Could be meant as Heroes only.
- FS-21 removes the top card of the attacker's own life deck when successful (looks like a drawback; transcribed literally).
- FS-22: END_COMBAT must happen after damage (hit or miss); it sits in onPlaySecondary, so the engine order matters.

### Cards with needsReview

FS-8 (style), FS-12 (power-up recipient, no usableBy), FS-13 (Hero's anger, total 2, ifUsedBy role), FS-15 (Dragon Ball 6 ambiguity, Hero's anger), FS-17 (protectsAlignment), FS-19 (endNextCombat trigger/timing), FS-21 (own life deck), FS-22 (END_COMBAT timing), FS-23 (sword icon, new params), FS-24 (variableCost), FS-27 (total 2, in play anywhere).

### Icons

Sword: FS-1 to FS-11, FS-14 to FS-17, FS-20 to FS-24. Starburst: FS-25, FS-27, FS-28. None (Non-Combat): FS-12, FS-13, FS-18, FS-19, FS-26.

## Part B notes: Frieza Saga 29-56

28 cards (FS-29 to FS-36 Common, FS-37 to FS-56 Uncommon). Validated: 0 invalid. 14 flagged with needsReview.

### New CUSTOM handlers

| Handler | Params | Behaviour | Cards |
|---|---|---|---|
| `damageIfStopped` | `{ stages: number, lifeCards: number }` | If the attack is stopped by a defense, the defender still takes this damage. | FS-37 |
| `conditionalDamage` | `{ condition: "characterInPlay", character: string, stages?: number, lifeCards?: number }` | Extra damage on a successful attack only when the named character is in play. | FS-41 |
| `cannotBeStoppedBy` | `{ source: "combatCards" }` | This attack cannot be stopped by defenses from Combat cards (personality powers and drills can still stop it). | FS-46, FS-47 |

### New params on existing handlers

- `playTiming` `when: "endOfCombat"` (FS-48 Dende Lv1).
- `allyEffect` `action: "returnFromDiscard"` `{ target, count, stage }`: put an ally from your discard pile into play at stage N (FS-48).
- `allyEffect` `action: "modifyStages"` `{ target: "OPPONENT" | "ALL", allAllies: true, amount }`: stage loss for allies, next to MODIFY_STAGES for the main personality (FS-50, FS-51).
- `requiresCondition` `condition: "firstCardInCombat"` (FS-49).
- `preventAttack` `attackType: "choice"` with `options: ["ENERGY","PHYSICAL"]` (FS-49).
- `damageModifier` `scope: "VILLAINS"`, `stagesOrLifeCards: -1` (FS-55): reduce damage on any villain by 1 stage or 1 life card.

### Titles (printed title longer than the character name)

- FS-44 Yajirobe Lv3: "Yajirobe the Hero"
- FS-48 Dende Lv1: "Dende the Unlikely Hero"

### Styles and types

- FS-34 Saiyan Planet Explosion and FS-35 Saiyan Focusing Power: style Saiyan (title + green kanji). FS-35 has a different restriction ("Goku, Gohan, Vegeta, Nappa, Raditz, and other Saiyans and half Saiyans only"). The schema has no race field, so usableBy only lists the five names.
- FS-55 Guldo's Time Freeze Drill: the type bar says **Non-Combat**, but the title says Drill. Typed as `Drill` (it behaves as one). Reviewer: decide whether the printed type should win.
- No new card types or new styles in this range.

### Rules observations

- Frieza Saga personality ratings are much higher (Dodoria Lv1 52,000-80,000; Guldo Lv3 80,000-125,000), while heroes like Chi-Chi, Bulma and Dende stay at 500-1,400. The PAT brackets in rules.json may need to handle ratings this high.
- New characters (all flagged "alignment assumed"): Jeice, Dodoria, Guldo (Villain), Dende (Hero).
- FS-48 Dende Lv1 prints PUR 2 on a level 1 card.
- FS-50 uses named "Captain Ginyu" (as printed in the character box). It may need an alias with "Ginyu".
- FS-32 Flames of Fury "also does 3 power stages of damage" is encoded like SS-65 (onHit MODIFY_STAGES OPPONENT -3, default energy damage).

### needsReview cards

- FS-30: DEFENSE_ANY STOP plus preventAttack ANY for this combat.
- FS-35: Saiyan/half-Saiyan restriction, style.
- FS-37, FS-38, FS-45, FS-46, FS-47: new character alignment.
- FS-41: scope of "Goku is present".
- FS-42: the power has no explicit "Energy attack" action; read as an energy attack with an optional capture.
- FS-48: alignment, PUR 2 at level 1, new timing value.
- FS-49: choice of attack type, and whether the current attack is stopped only when it matches the chosen type; first-card condition.
- FS-50: named alias.
- FS-51: "All opponents and allies" read literally as all allies, including your own (unlike FS-50's "their allies").
- FS-55: type (printed Non-Combat), the misspelling "Villians" kept in rawText, and how the reduction works.

## Part C notes: Frieza Saga 57-84

28 cards, all Uncommon (bucket "uncommons"), all `verified: false`. 13 have needsReview. Validator: 0 invalid.

### Card types
- All cards titled "... Drill" (FS-63, FS-65 to FS-80) print "Non-Combat" but are typed `Drill`, following the Saiyan convention (e.g. SS-126 also prints Non-Combat and is typed Drill). No new card types.
- FS-59 Yamcha's Skillful Defense prints "Energy Combat" but stops physical or energy attacks: `DEFENSE_ANY`.
- Icons checked: sword on 57, 58, 60, 61, 62, 64, 81-84; starburst on 59.

### Styles
No new styles in this range. Red, Blue, Orange, Black only. "Jeice's Style Drill" (FS-75) is a named drill, no style.

### Titles
No personality cards in this range, so no long titles. Named characters: Krillin, Tien, Yamcha, Vegeta, Captain Ginyu, Yajirobe, Chiaotzu, Zarbon, Jeice, Dende, Gohan, Frieza.
- FS-62 and FS-74 print "Captain Ginyu" (puzzle label also "Captain Ginyu"). `named` is set to "Captain Ginyu"; the brief calls the character "Ginyu". Harmonize with the Ginyu personality's `character` value.

### New handlers
- `conditionalPassive`: params `{ condition: { inPlay: string, anywhere: boolean }, passive: Passive, ongoing: true }`. Applies the embedded passive only while the condition holds. FS-77 (PUR +3 while Dende is anywhere in play).

### Existing handlers with new params or values
- `preventAttack`: `cardsOnly: true` (only attack cards are blocked, powers still allowed), `target: "ALL"` and `cardType: "Physical Combat"` (FS-82: nobody may play Physical Combat cards for the rest of the combat). FS-58, FS-82.
- `triggeredEffect`: new trigger `turnStart` (FS-67, each turn of every player), new trigger `afterOwnSuccessfulAttack` with `attackType` (FS-70, FS-78, FS-79, FS-80), `condition: "successfulPhysicalAndEnergyThisCombat"` and `limit: { count: 1, per: "combat" }` (FS-78).
- `sweepCards`: `amount: 1` and `exclude: ["Dragon Ball"]` so it discards one chosen card instead of all (FS-67).
- `removeFromGame`: `exclude: ["Dragon Ball"]` (FS-80).
- `damageModifier`: `condition: "defenderIsVillain"` (FS-69, +3 life cards on successful energy attacks against villains).
- `retaliationDrain`: shape `{ per: "attack", minStages: 3, opponentStages: -1 }`: one stage drain on the attacker per hit of 3+ stages (FS-74).
- `attackCostModifier`: added `scope: "OWNER"` (FS-72).
- `searchDeck`: `filter: "Ally level 1"`, `to: "hand"`, no shuffle (not printed) (FS-70).

### Rules observations
- FS-83 and FS-84 print "(Do not consult the Physical Attack Table.)": FLAT stages, same as SS-24.
- FS-67 and FS-80 target "non-combat/non-dragon ball" cards in play: assumed to include drills (drills are Non-Combat cards per rulebook p. 27).
- FS-60 "all opponents" is encoded as OPPONENT; in multiplayer it should hit every opponent.
- FS-76 is a usage restriction for five characters (Vegeta, Goku, Gohan, Nappa, Raditz): `usableBy.characters`.

### needsReview flags
- FS-58: preventAttack `cardsOnly` (only energy attack cards blocked).
- FS-60: "all opponents" as OPPONENT.
- FS-62: named "Captain Ginyu" vs "Ginyu".
- FS-63: "1 power stage or 1 life card" encoded as both -1; the "or" may mean only one reduction per attack. Also typed Drill.
- FS-67: new trigger turnStart, sweepCards amount/exclude, drills assumed to count.
- FS-69: damageModifier condition defenderIsVillain.
- FS-70: new trigger afterOwnSuccessfulAttack, no shuffle.
- FS-72: ambiguous: read as "your energy attacks cost 1 stage" (like SS-146, instead of 2); could mean an extra 1-stage cost.
- FS-74: retaliationDrain new shape; Captain Ginyu naming.
- FS-77: new handler conditionalPassive; "anywhere in play" scope assumed.
- FS-78: triggeredEffect condition for physical + energy in the same combat.
- FS-80: fires on every successful energy attack (no "once" printed); drills assumed to count.
- FS-82: preventAttack target ALL + cardsOnly; blocks physical defenses too.

## Part D notes: Frieza Saga 85-112

28 cards (FS-85 to FS-112), 12 flagged with needsReview. Validator: 0 invalid.
Rarity: 85-88 Uncommon, 89-112 Rare (from index.json buckets).

### New CUSTOM handlers

| Handler | Params | Behaviour | Cards |
|---|---|---|---|
| `discardFromPlay` | `{ target: "OPPONENT", cardTypes: ["Drill"], amount: 1 }` | Discard (not remove from game) N of the target's cards of these types from play; the player chooses which. | FS-93 |
| `damageIfStopped` | `{ lifeCards: 3 }` | If the attack is stopped/blocked, the defender still takes this damage. | FS-96 |
| `dragonBallPlayLimit` | `{ target: "OPPONENT", perTurn: 1, ongoing: true }` | Ongoing: target may put at most N Dragon Balls into play per turn. | FS-101, FS-102 |
| `useDrillPower` | `{ source: "anyInPlay", duration: "thisCombat" }` | The owner uses the effect of any drill in play (any player's) as if it were their own, for this combat. | FS-111 |

### Existing handlers with new params

- `dualUse` gains `condition: { inPlay: "<card name>" }`: the alternative mode is only available while that card is in play (FS-106 Goku's Mixing Drill, FS-109 Saiyan Power Drill). Alternative is a plain `ATTACK_ENERGY` (default energy damage/cost).
- `allyEffect` new actions: `modifyStages` (`target`, `scope: "allAllies"`, `amount`) for FS-97, `toBottomOfLifeDeck` (`target`, `scope: "allAllies"`, `condition: { inPlay }`) for FS-111. `condition` inside allyEffect is a conditional effect, not a play requirement.
- `searchDeck` gains `matchNumberToLevel: true` (Dragon Ball number = user's current level), FS-107; `to: "hand"` with filter "Combat card", FS-87.
- `removeNamedCardFromDecks` with a fixed `cardName` and `zone` array (life deck + discard), FS-100.
- `revealHand` gains `duringCombat: true` and `affects: "Heroes"`, FS-102.

### Titles (Personality cards)

- FS-89 Vegeta Lv4: "Vegeta On Namek"
- FS-90 Krillin Lv4: "Krillin On Namek"
- FS-91 Nappa Lv4: "Nappa Restored"
- FS-92 Raditz Lv4: "Raditz Restored"
- FS-93 Goku Lv4: "Goku On Namek"
- FS-94 Piccolo Lv4, FS-95 Gohan Lv4: title is just the name
- FS-96 Nail Lv1: "Nail The Namekian"
- FS-110 Nail Lv3: "Nail the Namekian Hero"

Name collision: "Goku Lv4", "Piccolo Lv4", "Gohan Lv4", "Krillin Lv4", "Vegeta Lv4", "Nappa Lv4", "Raditz Lv4" also exist as Saiyan Saga promos (SS-P1...P7) with different ratings and powers. Ids differ, but a UI that shows names only will be ambiguous; consider adding the title.

### Rules / data observations

- Nappa and Raditz Lv4 "Restored" have very low ratings for level 4 (Nappa 32,000-50,000, Raditz 20,000-38,000) and PUR 3; transcribed as printed.
- Vegeta Lv4 On Namek prints PUR 3 (others Lv4 are 4).
- FS-101/102 print "Non-Combat" in the type bar but are drills by title; typed `Drill` like the Saiyan drills (which also print Non-Combat). FS-101 "Hero Teamwork Drill" and FS-102 "Villain's Teamwork Drill" have no style; they are not named drills either, so check the unique-drill rule for them.
- Attack/defend icon sits in the POWER bar here: sword on 85, 86, 97, 98, 99, 112; starburst on 106 and 109 (109 is a Combat card, so `COMBAT_EFFECT` usePhase DEFEND). Non-Combat 108 (no icon) plays as a defense, like SS-212.
- Straining moves 85/86 do not print "Limit 1 per deck" (Saiyan ones did); 97 does. 85 and 86 use the word cost(ing), so they have a real `cost` (86: `LIFE_CARDS` 1).
- FS-98/99 Blue cards: energy attacks with no printed cost, so the default 2-stage energy cost applies.
- No Namekian style seen in this range. No Dragon Balls in this range. FS-107 suggests Frieza Saga Dragon Balls tie into personality level.

### needsReview cards

- FS-87: "combat card" interpretation; no shuffle printed.
- FS-96, FS-110: Nail alignment assumed Hero (new character).
- FS-97: "all allies" assumed opponent's; "no additional life card damage" read as damage NONE.
- FS-100: Kami As Your Ally; what "remove this card" refers to, and whether the card itself is an ally/stays.
- FS-101, FS-102: printed Non-Combat, typed Drill; FS-102 face-up cards read as revealed hand.
- FS-104: "any hero" may include hero allies.
- FS-106: conditional dualUse; printed spelling "Gokus' Mixing Drill".
- FS-107: Dragon Ball "matching personality level" interpretation.
- FS-109: named "Captain Ginyu" (align with the Ginyu personality name used by other parts); own ally assumed; conditional dualUse.
- FS-111: duration of using a drill's power; conditional ally clause.

## Part E notes: Frieza Saga 113-125 and promos P1-P17

30 cards (FS-113 to FS-125, FS-P1 to FS-P17), all `verified: false`, 24 with needsReview. Validator: 0 invalid. Built with `build-E.py` in this folder.

Rarity: 113-123 Rare, 124-125 Ultra Rare, P1-P11 promos and P12-P17 wrapper redemptions all "Promo".

### Titles (personality cards whose printed title is more than the character)
- FS-117 Nail Lv2: printed "Nail Inspired".
- FS-124 Frieza Lv1: printed "Frieza the Master" (ultra rare holo).
- FS-125 Goku Lv4: printed "Super Saiyan Goku" (ultra rare holo). Character kept as "Goku"; the reviewer may want a separate "Super Saiyan Goku" character or form (the puzzle label on many Frieza Saga cards also reads "Super Saiyan Goku").
- Promo personalities print the plain name: Frieza (P12), Garlic Jr. (P13), Trunks (P14), Captain Ginyu (P15), Spice (P16), Vinegar (P17).

### New characters (alignment assumed, flagged)
Nail (Hero), Frieza (Villain), Captain Ginyu (Villain), Garlic Jr. (Villain), Spice (Villain), Vinegar (Villain), Trunks (Hero). Garlic Jr., Spice and Vinegar are Garlic Jr. Saga characters, Trunks is from the Android/Trunks era: they appear here as wrapper-redemption promos, outside the Frieza Saga story.
- "Captain Ginyu": P2 and P15 print "Captain Ginyu" (as does part C). I used "Captain Ginyu" for `named` and `character`; the brief calls him "Ginyu". Harmonize across parts.

### New handlers
| Handler | Params | Behaviour | Cards |
|---|---|---|---|
| `cannotBeDefended` | `{ by: ("mainPersonalityPower" \| "any")[] }` | The attack cannot be stopped/defended by the listed sources (main personality powers only, or nothing at all). | FS-114, FS-115, FS-P17 |
| `conditionalPostResolution` | `{ condition: { inPlay: string }, postResolution: "DISCARD" \| "REMOVE" \| "STAYS" }` | Overrides the card's postResolution when the condition holds (discard instead of remove while "Dragon Ball 7" is in play). | FS-119 |
| `counterCard` | `{ exclude: string[], removeCountered: boolean }` | Cancel the effect of another card being played (not a Dragon Ball) and remove that card from the game; needs a response window. | FS-121 |
| `preventVictory` | `{ victoryTypes: ("DRAGON_BALL"\|"MPP")[], target: "triggeringPlayer", duration: { turns: 2, of: "targetPlayer" } }` | When a player would win by Dragon Balls or Most Powerful Personality, that win is blocked for that player's next 2 turns. | FS-P1 |
| `mirrorAngerReduction` | `{ source: "Warrior Sword", target: "OPPONENT", ongoing: true }` | Every anger level you reduce on your "Warrior Sword", all opponents lose the same amount of anger. | FS-P3 |
| `discardFromOpponentHand` | `{ target: "OPPONENT", amount: 1, selection: "random" }` | Pick a card unseen from the opponent's hand and discard it. | FS-P11 |
| `constantPower` | `{ ongoing: true, then: Effect[] }` | Wrapper for a "Constant Combat Power": always active while the personality is face up, never "used". | FS-P12, FS-P13, FS-P14 |

### Existing handlers with new params or values
- `removeFromGame`: `target: "ALL"`, `zones: ["play","lifeDeck"]`, `amount: "all"` (FS-113); `exclude: ["Dragon Ball"]` (FS-122, same as part C).
- `damageModifier`: `condition: { inPlay, controller }` + `setLifeCards` (FS-115); `maxStages: 0, maxLifeCards: 0, duration: "thisCombat"` for "stops all damage" (FS-119); `stages: -3, minStages: 0, protects` (FS-P13); `maxLifeCards: 2, protects` (FS-P14).
- `autoStopAttack`: `per: "nextCombat"` one-shot (FS-116).
- `dualUse`: `condition: { inPlay: "Chiaotzu's Drill" }` and an attack as alternative (FS-116).
- `sweepCards`: `cardType: "Ally"` (FS-118); `timing: "onHit"` (FS-123).
- `setAnger`: `target: "ALL"` (FS-P4).
- `playTiming`: new `when: "opponentVictoryAttempt"` (FS-P1).
- `stealOrCaptureDragonBall`: `condition: { minLifeCards: 6 }`, `replacesNormalCapture` (FS-P12).
- `searchDeck`: `from: "discard"`, `filter: "Ally"`, `to: "play"` (FS-P6).

### Rules observations
- **Constant Combat Power** (P12, P13, P14): a new kind of personality power that is always on. The 2000 Saiyan rules only have once-per-combat-step powers. Schema gap: `personality.power.strike` is required, so these are stored as a COMBAT_EFFECT strike wrapping `constantPower`; better would be a `passive`/`constant` field on the power.
- **Promo personality layout** (P12-P17): no flavor text, PUR box and level in the same spots; ratings read cleanly.
- **"Warrior Sword"** (P3): unknown term, probably a Frieza Saga rules element (anger tracker?) or another card. Needs the Frieza Saga rulebook.
- **"Dragon Ball 7"** (FS-119) and "dragon balls" (FS-113, FS-120): no Earth/Namekian distinction printed.
- **"Chiaotzu's Drill"** (FS-116): SS-230 with this name is a Physical Combat card, so "in play" is odd unless a Frieza Saga drill with that name exists.
- **FS-121 / FS-P1** are reactions (cancel a card, block a win); the engine has no priority window for the non-active player (known approximation in dsl-gaps).
- **P5 Frieza's Force Bubble** prints "Energy Combat" with a starburst: encoded as DEFENSE_ENERGY STOP plus `preventAttack` for the rest of the combat.
- Icons: sword on 114, 115, 123, P2, P8, P10, P11; starburst on P5, P9.
- Styles: Red (FS-123, P9), Orange (P10). No new styles. No new card types.

### Reprints/variants
- No promo is a reprint of a numbered card in 113-125. FS-P12 Frieza Lv1 is a different card from FS-124 Frieza Lv1 (different ratings, PUR the same, different power). I could not check the promos against numbers outside my range (1-112); the other parts should check names such as "Red Blocking Hand", "Orange Forceful Kick", "Goku's Good Swift Kick", "Vegeta's Lunge", "Frieza's Force Bubble".

### needsReview flags
- FS-113: removes all Dragon Balls everywhere; postResolution DISCARD assumed.
- FS-114, FS-115: new handler cannotBeDefended; FS-115 conditional 7 life cards (whose Piccolo's Flight).
- FS-116: autoStopAttack one-shot, conditional dualUse, Chiaotzu's Drill question.
- FS-117, FS-124: alignment assumed; FS-124 holo text.
- FS-118: all opponents as OPPONENT.
- FS-119: "all damage" scope, conditionalPostResolution, which Dragon Ball 7.
- FS-120: no shuffle printed.
- FS-121: counterCard, postResolution assumed.
- FS-122: drills assumed to count as non-combat.
- FS-125: title, holo text punctuation.
- FS-P1: preventVictory, timing.
- FS-P2: Captain Ginyu naming; anger reset unconditional.
- FS-P3: Warrior Sword unknown, ongoing assumed.
- FS-P4: setAnger target ALL.
- FS-P5: also stops the current attack (assumed), opponent only.
- FS-P11: random discard.
- FS-P12 to FS-P17: alignments assumed; constantPower wrapper (P12-P14).

