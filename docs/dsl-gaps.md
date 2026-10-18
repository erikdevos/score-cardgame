# DSL gaps — Saiyan Saga

This document lists everything in `src/data/saiyan-saga/cards.json` that the atomic effect DSL in `src/engine/cards.ts` cannot express yet. Cards use `{ "action": "CUSTOM", "handler": "<name>", "params": {...} }` for those parts. All cards are still `verified: false`; the transcription comes from the card images and needs a human check in the review screen.

## Implementation status

Implemented in `src/engine/effects/handlers.ts`, `src/engine/abilities.ts` and `src/engine/effects/triggers.ts` (tests: `tests/handlers.test.ts`):

- `powerDefense`, plus `dualUse` on cards and powers: offered in the defend window (`DEFEND` with an "or stops" card, `DEFEND_POWER` for the personality power). Modes STOP, REDUCE and CAP; `protects` is checked against the defending main personality. Defensive powers are no longer offered as attacks.
- `preventAttack`, `skipPhase`: attack restrictions per combat (next attack phase of that player, or the rest of the combat) and "skip the combat step of your next turn".
- `drawFromDiscard`, `recoverFromDiscard`: top, bottom or player's choice (`PICK` choice).
- `ifUsedBy`, `ifOpponentAlignment`, `optional` (`CONFIRM` choice), `setAnger`, `setLevel`, `staysForExtraUse`.
- `stealOrCaptureDragonBall`: capture by choice, search own deck, to the bottom of the foe's life deck, `requiresAlly`, and the "after a successful physical/energy attack" timing.
- `damageModifier`: multiplier on a successful attack, CAP as part of a defense (SS-220), heroes take 1 life card less this combat (SS-250), and the once-per-combat drill reductions (SS-140, SS-141).
- `triggeredEffect` on drills (combat start, attack phase, after receiving a successful attack, optional ones ask first) and SS-221's draw at the start of each combat.
- `playTiming`: `afterOwnSuccessfulEnergyAttack` and `defendingAgainstEnergyAttack` gate the card or power; `combatStart`, `ownAttackStart` and `defenderDraw` powers resolve automatically when combat is declared. `usageLimit` once per game.

- `shieldNextAttack` (SS-30, SS-31, SS-33): works while the card lies face up in the Non-Combat zone; it is not offered as a "use".
- `autoStopAttack` (SS-134, SS-135): the drill stops the first attack of that type each combat before the defend window opens.
- `searchDeck`, `removeFromGame`, `discardFromHand` (a requirement: the card is only playable with another card in hand), `useDiscardAsLifeDeck`.
- `allyEffect`: requirements (an ally, a named ally, a named main personality), remove an ally as a requirement, damage per ally, stages from an ally to the main personality, an ally absorbs all damage this combat, and planting Saibaimen for the next turn.

Resolution model: everything that resolves (effects, strike steps, triggers, timing windows) is a frame on `GameState.stack`, run by the driver in `src/engine/engine.ts`. Resolution pauses whenever a player has to decide (`pendingChoice`) and continues exactly where it stopped, also in the middle of a strike.

Timing windows: `afterOpponentPaysAttackCost` opens a reaction window right after the attacker pays a power-stage cost (SS-39), `endOfTurn` opens a window for each player at the end of every turn (SS-238, SS-239), and `anyTime` cards on the table can be used as a free action whenever their owner has to act (SS-225), also in the defend window; the open decision comes back afterwards.

Rulings (Erik, 2026-10-17):

- SS-101 to SS-103 (Honor Duel): a modal choice when the card is used: the bottom 3 discards replace either the life card damage of the next combat (up to 3) or the defender's 3-card combat draw (draw mode only does something when the user is the defender in that combat). The damage mode absorbs up to 3 life cards, matching the printed "bottom 3 cards" (confirmed). Note: the printed 2000 card text has no "or"; the modal choice is a ruling.
- SS-207 (Power Gifting): the player chooses any amount, up to the main personality's highest stage.
- SS-156 (Ally's Sacrifice): the owner chooses the ally when the card is played.
- SS-105: a main personality can never be removed from the game this way; as main personality the effect fails.
- SS-213 (Plant Two Saibaimen): the highest level Saibaimen comes from the life deck, which is shuffled afterwards.
- `extraAttack` (Multi-Form, SS-82, SS-163): the attacker makes the extra physical attack right away, before the phase passes.
- `noStacking` (SS-250): a second copy cannot be used in the same combat.

All remaining handlers now have a simple, working version (Erik: "good is good enough, finetuning later"); the real-card simulation no longer hits any unimplemented CUSTOM effect:

- `temporaryStage` (SS-17), `endNextCombat` (SS-76), `takeDiscardedLifeCard` (SS-112, always taken), `sweepCards` (SS-126), `copyDefendedAttack` (SS-133, a `COPY_ATTACK` action once per combat), `retaliationDrain` (SS-138, SS-139, per hit, remainders not carried over), `attackCostModifier` (SS-146), `optionalShuffle` (SS-149), `useOtherLevelPower` (SS-172, SS-P2: the first usable option is used as an attack, a defensive option in the defend window), `modifyAngerFiltered` (SS-191), `replaceDrawSource` (SS-195, SS-196: the defender's combat draw), `removeNamedCardFromDecks` (SS-198, names any Non-Combat card), `endTurn` (SS-203, keep the hand this turn), `modifyStagesByRole` (SS-204), `angerLock` (SS-208), `revealHand` (SS-211, SS-224, shown in the UI), `damageAbsorber` (SS-226) and `recurringDamage` (SS-227) while they lie on the table, `allowMixedDrills` (SS-231, nothing to lift), `protectDrills` (SS-234), `preventDragonBallCapture` (SS-237), `resetBattle` (SS-242, also stops the attack in progress), `requiresCondition` (SS-214, SS-246: a play condition).

Known approximations:

- `anyTime` cards are only usable when their owner has to act; there is no priority window in every step for the other player.
- `useDiscardAsLifeDeck` damage mode: absorbed cards count as life cards dealt for the Dragon Ball capture rule.

## CUSTOM handlers

48 handlers, used by 141 cards. Sorted by number of cards. A card can use several handlers, and CUSTOM effects can be nested (for example `ifUsedBy.then`, `triggeredEffect.then`).

| Handler | Cards | Card ids | Desired behaviour |
|---|---|---|---|
| `powerDefense` | 14 | SS-86, SS-87, SS-160, SS-170, SS-173, SS-176, SS-178, SS-184, SS-243, SS-244, SS-245, SS-P7, SS-P7-SILVER, SS-P115-ERROR | Defensive personality power, used in the Defender Defends phase instead of a card (once per Combat step): mode STOP, REDUCE (stages/lifeCards) or CAP (maxStages/maxLifeCards) against attackType; `protects` limits it to attacks on those characters. Replace with a `defense` field on StrikeSchema. |
| `preventAttack` | 13 | SS-11, SS-12, SS-18, SS-19, SS-21, SS-28, SS-42, SS-58, SS-94, SS-95, SS-96, SS-120, SS-121 | Target (or one named foe) cannot make attacks of attackType for a duration (nextPhase / thisCombat); `protects` limits it to attacks on one character. |
| `drawFromDiscard` | 10 | SS-25, SS-136, SS-137, SS-180, SS-204, SS-221, SS-P5, SS-P5-SILVER, SS-P6, SS-P6-SILVER | Move N cards from the discard pile (top/bottom/choice) into hand; may be ongoing (each combat) or add to a combat draw. |
| `recoverFromDiscard` | 10 | SS-23, SS-79, SS-80, SS-89, SS-98, SS-169, SS-187, SS-190, SS-193, SS-199 | Like RECOVER but with source/destination: `from` top/bottom/choice of the discard pile, `to` top/bottom of the life deck. |
| `playTiming` | 9 | SS-39, SS-164, SS-175, SS-180, SS-182, SS-185, SS-225, SS-238, SS-239 | Card or power may only be used at a specific moment (`when`): anyTime, endOfTurn, combatStart, defenderDraw, afterSuccessfulEnergyAttackAgainstYou, afterOwnSuccessfulEnergyAttack, afterOpponentPaysAttackCost (reaction). |
| `stealOrCaptureDragonBall` | 7 | SS-48, SS-157, SS-175, SS-188, SS-189, SS-222, SS-241 | Capture one (or N) of the opponent's Dragon Balls outside the normal 5-life-card rule, or search one from own deck; often after a successful attack or with a requirement (ally Bulma). |
| `allyEffect` | 6 | SS-156, SS-194, SS-207, SS-213, SS-217, SS-229 | Effects that use or target allies: require an ally, sacrifice/remove an ally as cost, redirect damage to an ally, transfer stages to an ally, damage per ally, plant an ally. |
| `damageModifier` | 6 | SS-46, SS-140, SS-141, SS-210, SS-220, SS-250 | Change damage outside the flat DAMAGE_MOD passive: cap incoming damage (maxLifeCards/maxStages), reduce by N for a limited number of uses or under a condition, or multiply an attack's damage (multiplier). |
| `triggeredEffect` | 6 | SS-127, SS-128, SS-129, SS-136, SS-137, SS-144 | Ongoing effect: when `trigger` happens (combat start, own attack phase, defending vs energy, receiving a successful attack, defender combat draw), resolve `then` effects; optional limit/optional flag. |
| `dualUse` | 5 | SS-13, SS-66, SS-70, SS-82, SS-163 | Card text with "or": the player chooses to play it with its own combatRole or as `alternative` (usually a STOP defense); rulebook p. 20. The CUSTOM sits in onPlaySecondary only as a carrier: the engine must read it when listing legal defenses and must not resolve it as a secondary. Effects outside the "or" (anger changes) happen in either mode. |
| `searchDeck` | 5 | SS-202, SS-218, SS-223, SS-228, SS-240 | Search life deck and/or discard pile for a card matching `filter` and move it to hand/play/deck position, then shuffle. |
| `skipPhase` | 5 | SS-38, SS-45, SS-83, SS-85, SS-192 | Target skips a phase or opportunity: next attack, all remaining phases of this combat (must pass), or the combat step of their next turn. |
| `ifUsedBy` | 4 | SS-25, SS-108, SS-112, SS-113 | Resolve `then` only when the personality using the card is one of `characters`. Only for cards that literally say "If used by X". |
| `staysForExtraUse` | 4 | SS-25, SS-108, SS-112, SS-113 | After resolving, the card stays on the table and can be used `uses` more times this combat. |
| `removeFromGame` | 3 | SS-32, SS-105, SS-197 | Remove a card from the game: an opponent's drill/ally/Non-Combat in play, or the user's own personality (Chiaotzu). |
| `shieldNextAttack` | 3 | SS-30, SS-31, SS-33 | Stays in play; stops the next N successful attacks of attackType (or their life-card damage) on the owner, then is removed from the game. |
| `useDiscardAsLifeDeck` | 3 | SS-101, SS-102, SS-103 | For the next combat the user takes damage from the bottom N cards of the discard pile instead of the life deck; not usable with fewer than N cards. |
| `useOtherLevelPower` | 3 | SS-172, SS-P2, SS-P2-SILVER | Personality may use the power printed on another level of the same character. |
| `autoStopAttack` | 2 | SS-134, SS-135 | Ongoing: automatically stop the first N attacks of attackType made on the owner each combat. |
| `discardFromHand` | 2 | SS-40, SS-41 | Requirement (not a cost, per the CRD definition): discard N other cards from hand to play this card. |
| `extraAttack` | 2 | SS-82, SS-163 | After this attack, the same personality immediately performs `count` more attacks of attackType (Multi-Form: two physical attacks in a row). |
| `ifOpponentAlignment` | 2 | SS-117, SS-118 | Resolve `then` only when the opposing main personality has the given alignment (Hero). |
| `optional` | 2 | SS-75, SS-77 | The player may choose to resolve `then` ("if you wish"). |
| `replaceDrawSource` | 2 | SS-195, SS-196 | For the next combat, the player draws from the discard pile (top/bottom) instead of the life deck. |
| `requiresCondition` | 2 | SS-214, SS-246 | Play condition, not a side effect: the card or power may only be used when the board condition holds (SS-246: more than one Saibaimen in play; SS-214: Gohan is the ally of a Goku main personality). |
| `retaliationDrain` | 2 | SS-138, SS-139 | Ongoing: for every X life cards/stages the owner loses, the foe loses N stages (not below a floor). |
| `revealHand` | 2 | SS-211, SS-224 | Ongoing: (villain) opponents play with their hand revealed, optionally while a character is in play. |
| `setAnger` | 2 | SS-200, SS-208 | Set a personality's anger to a fixed value (no SET_ANGER atom exists; MODIFY_ANGER is relative). |
| `setLevel` | 2 | SS-238, SS-239 | Force the opponent's personality from level X back to level Y. |
| `usageLimit` | 2 | SS-165, SS-175 | Limit a power strike to N uses per game and/or a timing window (first round of combat). |
| `allowMixedDrills` | 1 | SS-231 | Owner may have drills of several styles in play at once. |
| `angerLock` | 1 | SS-208 | Target's anger cannot rise until it forces another player to discard a life card. |
| `attackCostModifier` | 1 | SS-146 | Owner's attacks of attackType cost a different number of stages. |
| `copyDefendedAttack` | 1 | SS-133 | Once per combat, perform the same physical attack you defended against this combat. |
| `damageAbsorber` | 1 | SS-226 | A creature card absorbs all physical damage for the owner until the first energy attack against the owner; that energy attack hits normally and destroys the card. |
| `endNextCombat` | 1 | SS-76 | Ongoing: the next combat the owner is forced into ends before the owner takes damage. |
| `endTurn` | 1 | SS-203 | End the turn immediately; the player may keep extra cards (ignore hand limit) until next turn. |
| `modifyAngerFiltered` | 1 | SS-191 | Change anger of a chosen personality (own or opponent) matching a level filter. |
| `modifyStagesByRole` | 1 | SS-204 | MODIFY_STAGES/DRAW aimed at the attacker or defender role instead of SELF/OPPONENT. |
| `optionalShuffle` | 1 | SS-149 | Before an announced combat the owner may shuffle one of the listed piles. |
| `preventDragonBallCapture` | 1 | SS-237 | Ongoing: the owner's Dragon Balls cannot be captured. |
| `protectDrills` | 1 | SS-234 | Owner's drills cannot be affected until the personality advances a level. |
| `recurringDamage` | 1 | SS-227 | While in play, deal 1 life card per combat when the owner attacks, until destroyed by an energy attack. |
| `removeNamedCardFromDecks` | 1 | SS-198 | Name a card; opponents remove all copies from their decks from the game. |
| `resetBattle` | 1 | SS-242 | End the combat and restore power stages and anger of all players to their values at the start of this combat (Erik's ruling for SS-242). |
| `sweepCards` | 1 | SS-126 | Discard all cards of a type (drills) controlled by others from play. |
| `takeDiscardedLifeCard` | 1 | SS-112 | When the character discards from the life deck this combat, they may take the first discarded card into hand. |
| `temporaryStage` | 1 | SS-17 | Treat the user's power stage as a value (MAX) for this attack's damage calculation only. |

Possible consolidations once the engine implements these: `shieldNextAttack` / `autoStopAttack` / `endNextCombat` / `ignoreAttack` are all variants of "ongoing stop of attack X"; `ifUsedBy` / `ifOpponentAlignment` / `requiresCondition` / `conditionalDefense` could become one generic `condition` wrapper; `replaceDrawSource` and `useDiscardAsLifeDeck` overlap.

## Encoding conventions used

- **Source of truth**: the printed card text (2000) and the 2000 Saiyan Saga rulebook (engine mode `PURE_2000`). The later Score rulings document (CRD, 2004) is only used to interpret unclear text; its errata ("Treat this card as if it read ...") are not applied. They could become a separate, newer rule set later.
- **Personality powers**: every power is a `personality.power` strike. Saiyan Saga rulebook p. 20: an attacker or defender may use the power of his face-up personality card only once per Combat step; a new level brings a new, unused power. Attack powers are used in Attacker Attacks, defensive powers (`DEFENSE_*` + `powerDefense`) in Defender Defends, and other powers as `COMBAT_EFFECT` (with `playTiming` when the text names a moment). There are no constant/passive powers in the Saiyan Saga.
- **Drills** that don't fit a `passives` entry use a CUSTOM in `effects.onEnterPlay` with `params.ongoing: true`, and `postResolution: "STAYS"`.
- **Unconditional secondaries** ("plus ...", "Raise card user's anger level 1") go in `onPlaySecondary`; "if successful / if it is not blocked" goes in `onHit`.
- **Style** is the first word of the card title (Red, Blue, Orange, Black, Saiyan: 18 cards each); all other cards are freestyle and have no `style`. Source: Saiyan Saga rulebook p. 24-25 (Move and Named cards have no style) and the 2002 Score rulebook ("Freestyle cards do NOT have a Martial Arts Style listed in the first word of the card title"). The kanji diamond is not used: styleless Straining Move cards carry the same blue 青 as Blue cards.
- **Character names in card text** refer to the personality using the card ("Gohan gains 1 anger level" = the user gains 1 anger). Only "If used by X" makes an effect conditional (`ifUsedBy`: SS-25, SS-108, SS-112, SS-113). Rationale: the 2000 rulebook (p. 32) lets any personality run another's named cards "to represent learning someone else's powers", and the cards that are meant to be conditional say so explicitly.
- **Cost vs. requirement** (Score rulings document, CRD): "A cost exists on a card only if the word 'cost' (or the terms 'costs' and/or 'costing') appears on the card itself." Self-drain such as "forcing ... the attacker 3 stages of power" (Straining moves SS-34-37) is therefore a `MODIFY_STAGES SELF` secondary effect, not `cost`, and "you have to discard another card" (SS-40, SS-41) is a requirement.
- **Discard pile position**: when a card means the top card it says "top" (SS-22, SS-75); otherwise ("2 discarded cards", "1 card from the discard pile") the player chooses (`from: "choice"`).
- **"Limit 1 per deck"** is encoded as `limitPerDeck: 1`.

## Schema gaps (no field or value exists)

- **Usage restrictions**: now in `CardSchema` and filled in for 25 cards. The engine still has to enforce them:
  - `usableBy: { alignments?: ("Hero"|"Villain")[], characters?: string[] }`: the personality using the card must match one of the alignments OR one of the characters. Checked when the card is played (by the personality in control of combat).
    - "Villains, Goku, and Gohan only." → `{ alignments: ["Villain"], characters: ["Goku", "Gohan"] }`: SS-18, SS-19, SS-20, SS-21, SS-91, SS-92, SS-93, SS-94, SS-95, SS-96 (the Saiyan-style group, rulebook p. 25: "All of the Villains may choose Saiyan, but only Goku and Gohan can do so for the Heroes")
    - "Not useable by heroes except for Goku." → `{ alignments: ["Villain"], characters: ["Goku"] }`: SS-80
    - "Heroes only." / "Allows a hero ..." → `{ alignments: ["Hero"] }`: SS-78, SS-79, SS-89, SS-195
    - "One villain ..." / "A villain may ..." → `{ alignments: ["Villain"] }`: SS-45, SS-213
    - "this Saiyan" → `{ alignments: ["Villain"], characters: ["Goku", "Gohan"] }` (same Saiyan group): SS-119
  - `exclusiveDrillStyle: "<Style>"`: rulebook p. 27, "Cannot be used with other orange drills in play on the table": the drill cannot be played while any player has a drill of that style in play, and is discarded as soon as anyone plays one: SS-135 (prints "Orange" on a Black drill), SS-136 (Black), SS-142 (Orange), SS-143 (Black), SS-148 (Red), SS-150 (Blue)
  - `noStacking: true`: "Multiples of this card cannot be used together.": SS-250
  - Not restrictions but conditions, kept as CUSTOM: SS-214 (Gohan as Goku's ally), SS-246 (more than one Saibaimen). Opponent-alignment effects (SS-117, SS-118, SS-211, SS-224, SS-250 "all heroes") stay effects. SS-215 "More than 1 of these drills can be out" is already covered by the named-drill rule.
- **Target roles**: `Target` only has SELF / OPPONENT. Some cards address the attacker/defender of the current combat (SS-199, SS-200, SS-204), so they go through CUSTOM params.
- **PUR > 4**: SS-P115-ERROR prints PUR 5; the schema caps `pur` at 4, so it is stored as 4 with needsReview.
- **Optional effects**: DRAW has no "if you wish" flag, so SS-75 and SS-77 wrap it in CUSTOM `optional`.
- **Defensive personality powers**: Saiyan Saga rulebook p. 16/20: a personality power may be used once per Combat step, either to attack (phase b) or to block an attack (phase c). The engine only offers `USE_POWER` to the active player and `defend` only takes hand cards, and `StrikeSchema` has no `defense` field. Needed: `defense` on StrikeSchema and a power option in the defend window (SS-86, SS-87, SS-160, SS-170, SS-173, SS-176, SS-178, SS-184, SS-243-245, SS-P7).
- **Play condition vs. side effect**: `requiresCondition` (SS-246, SS-214) is a gate on playing the card or power, not an effect to resolve.
- **Timing**: cards played at unusual moments ("Play this card during combat", after costs are paid, "at the beginning of this combat round") have no timing field: SS-39, SS-119, SS-187, SS-212, plus `playTiming` cards.
- **Dual-role cards**: one `combatRole` per card; attack-or-defense cards use `dualUse` (SS-13, SS-66, SS-70).
- **Power-up recipient**: rulebook p. 23: "Allies can be chosen to benefit from power-up cards instead of the Main Personality." `Target` has no "MP or one of your allies" value, so these cards use SELF for now: SS-22 Power Up!, SS-97 Power Up More!, SS-98 Power Up the Most!, SS-201 The Tail Grows Back (all "a/the personality"). Not included: SS-43 Senzu Bean ("the main personality"), SS-119 ("this Saiyan"), SS-26 (Gohan). Open question: do the Dragon Balls' "power up to full" (SS-15, SS-77) count as power-up cards? Proposed: a `SELF_OR_ALLY` target.

## Rules notes for the engine (deck building)

- **Named cards** (Saiyan Saga rulebook p. 32 and glossary): a card with a character's name in the title. A Main Personality may run 4 copies of its own named cards instead of 3; other personalities' named cards stay at 3. The CRD adds "Allies are considered Named cards" and that "Roshi" cards are Master Roshi named cards (a future alias `Roshi` = `Master Roshi`).
- **Named and colorless drills** (rulebook p. 28): named drills (SS-155, SS-215, SS-221, SS-224, SS-231, SS-237) and colorless drills (SS-149) can be in play next to any styled drill, with up to 4 copies in play at once. `rules.json` `uniqueDrillsPerPlayer` must exempt them.

## Rules notes for the engine (play timing)

- **Non-Combat cards are used later, not on placement** (Saiyan Saga rulebook p. 14, p. 16 and glossary): in Step 2 a player places Non-Combat cards face up; each card's power "stays available until you use it", either right away in Step 2 or in Step 4 Combat (as an attack in Attacker Attacks, or to block in Defender Defends). They are discarded after use, except Drills and Dragon Balls. The engine now resolves `onEnterPlay` immediately and retires the card. Non-Combat cards with a combat role: SS-210 Raditz Flying Kick (`ATTACK_PHYSICAL`), SS-212 Piccolo's Flight (`DEFENSE_ANY`).
- **Attack or defend icon** (rulebook p. 7, 18-19: "Sword symbolizes Attack. Starburst symbolizes Defend."): checked automatically on all 250 card images. Every `ATTACK_*` card has a sword and every `DEFENSE_*` card a starburst, except SS-217 Ribs Broken (starburst, but the text is an energy attack; the text wins). For `COMBAT_EFFECT` cards the icon gives the phase, stored in `usePhase`:
  - sword, played in place of an attack: SS-117, SS-118, SS-188, SS-205, SS-229
  - starburst, played in Defender Defends: SS-39, SS-112, SS-119, SS-156, SS-199, SS-200, SS-201, SS-203, SS-204, SS-206, SS-214, SS-218, SS-242

## Data notes for the reviewer

- Printed titles that differ from the fan-site index/slug: SS-28 "Vegeta's Physical Stance" (index: Physical Attack), SS-37 "Straining Tripping Move" (index: Tipping), SS-117 "Raditz Energy Wall" (slug ends in "Rad"), SS-192 "Teaching the Unteachable Forces Observation" (index: Untouchable ... Oberservation). The card data uses the printed title, confirmed by the card checklist in the Saiyan Saga rulebook; `imageUrl` keeps the slug. Hi-tech personalities are named "<Name> Lv1 HT".
- Hi-tech printings SS-179 to SS-185 have a **different power** from their base Lv1 card (ratings identical; Vegeta and Nappa HT print PUR 1 instead of 2). They are transcribed as printed, not copied.
- Silver promos (SS-P1-SILVER ... SS-P7-SILVER) are identical to the base promo. Error dupes SS-P4-ERROR (Goku printed as P4) and SS-P115-ERROR (Nappa) differ from the regular promos in ratings and power.
- SS-230 "Chiaotzu's Drill" is printed as Physical Combat and plays as a one-shot defense, so it is typed Physical Combat, not Drill (a Drill is a Non-Combat card, rulebook p. 27).

## Frieza Saga

Transcribed 2026-10-18: 142 cards in `src/data/frieza-saga/cards.json`, all unverified (74 with `needsReview`). Reviewer notes per card range: `docs/frieza-saga-notes.md`. Played through the "Saiyan + Frieza" card pool on the menu; the "Saiyan Saga" pool is unchanged.

**Engine support**
- Implemented new handlers: `ifInPlay` (FS-15, FS-16, FS-27), `conditionalDamage` (FS-41), `damageIfStopped` (FS-37, FS-96), `cannotBeDefended` (FS-114, FS-115, FS-P17), `cannotBeStoppedBy` (FS-46, FS-47: no Combat-card defenses), `dragonBallPlayLimit` (FS-101, FS-102), `discardFromPlay` (FS-93), `discardFromOpponentHand` (FS-P11, random), `conditionalPassive` (FS-77), `constantPower` damage effects (FS-P13, FS-P14; these powers are never offered as a "use power" action).
- `damageModifier` variants: FS-55 (villains take 1 less; taken off the life cards when there are any, otherwise off the stages), FS-69 (+3 life cards against villains), FS-115 (7 life cards with Piccolo's Flight on your table), FS-119 (no damage to the user for the rest of combat).
- Also implemented (2026-10-18): `variableCost` (FS-24: pay 1-7 life cards, that many is the damage; no default energy cost), `useDrillPower` (FS-111: borrow another drill's passives and table effects for this combat), `preventVictory` (FS-P1: opponent cannot win by Dragon Balls or MPP during their next 2 turns; victories are re-checked at turn start), `conditionalPostResolution` (FS-119), FS-P12 double Dragon Ball capture, triggers `turnStart` (FS-67) and `afterOwnSuccessfulAttack` with condition and per-combat limit (FS-70, FS-78, FS-79, FS-80), `sweepCards` by type (Non-Combat with a pick, Ally), `allyEffect` `modifyStages` / `toBottomOfLifeDeck`, `removeFromGame` from piles (FS-14, FS-21) and life-for-drills (FS-23), cards-only and multi-target `preventAttack` (FS-17, FS-58, FS-82), per-attack `retaliationDrain` (FS-74), `searchDeck` `matchNumberToLevel` (FS-107).
- Approximations: `counterCard` (FS-121) removes an opponent's non-Dragon Ball card in play from the game; it cannot cancel a card while it resolves (no priority window). FS-P1 is used like other Non-Combat cards, not as a reaction to a victory.
- Deck building: copy limits now count by card title, so a reprint shares the limit with the original (assumption: "max 3 of a card" means by name). Auto-built decks in the Saiyan + Frieza pool use a level 4 on top of levels 1-3 when the pool has one, and per level the newest set's printing.

**Settled by the Trunks Saga rulebook** (Score, 2001; Erik's copy, not in the repo; no Frieza Saga rulebook is available)
- **PAT**: the Saiyan + Frieza pool uses the Trunks Saga Physical Attack Table (`src/engine/config/pat-trunks.json`: 8 brackets from 0 to 1,300,000+). The Saiyan Saga pool keeps the 2000 table.
- **Alignment**: hero personality cards have blue backgrounds, villains red (rulebook p. 4, 45). Checked on the images: Jeice, Dodoria, Guldo, Frieza (FS-124) red; Dende, Nail blue. The silver foil promos (FS-P12-P17) show no background colour and stay flagged.
- **"Dragon Ball 6/7"** without Earth/Namek: "Unless a card specifies which type of Dragon Ball it affects, it will affect both" (p. 47). Current reading confirmed.
- **Drills**: "A Drill card is any Non-Combat card with the word Drill in its title" (p. 40). Typing them `Drill` is correct.
- **"or"** in card text means the player chooses one action (p. 30), as already ruled for SS-101-103.
- **Warrior Sword** is the anger counter (p. 10, 32). FS-P3 Calming Sanctuary is implemented: anger its owner loses is also lost by the opponent (stays on the table).
- **Constant Combat Power** (p. 31): always available, usable more than once per combat, even before or after combat as the text says. Matches the `constantPower` encoding.
- **Main personality levels from different sagas may be mixed** (p. 33), as the auto decks do.

**Trunks Saga core rules, applied to the Saiyan + Frieza pool** (Erik's decision, 2026-10-18; switches in `rules.json` → `trunks`, all off in the Saiyan Saga pool)
- `levelStages`: a level up starts at the new level's highest power stage; a forced level drop (`setLevel`) sets stage 5.
- `mostPowerfulByHighestLevel`: you win the instant your main personality reaches the highest level any main personality in the game has (stack depth); at your top level, 5 anger sets full power and anger 0 instead of winning.
- `finalPhysicalAttack`: action `FINAL_PHYSICAL_ATTACK` (discard any hand card, plain PAT physical attack), once per combat; afterwards that player only passes and cannot defend for the rest of the combat.
- `skipCombatRecovers`: after a turn without combat (skipped, or a location was played), after Step 5 the top discard goes to the bottom of the life deck.
- `heroFirst`: the hero goes first, both start at stage 5; with two heroes or two villains a coin flip (assumption, the rulebook does not cover it).
- `allyRules`: allies must match the main personality's alignment (Vegeta and Piccolo main personalities may use either side; simplification of p. 46-47), be at least 2 levels below its highest level, never either main personality's character, and the same character and level only once in play; a higher level replaces your lower one at full power. Deck check: one copy per personality level (Saibaimen 3). Auto decks follow this.
- `dragonBalls`: Earth and Namek Dragon Balls count as separate sets (no Namek cards exist yet), a deck may not mix them, Dragon Balls hit by damage go to the bottom of the life deck (or leave the game if a copy is in play) and do not count as discards, a life deck of only Dragon Balls loses when it must discard, and a set completed by capture wins at the start of the owner's next turn.
- Not implemented: the defender choosing to take damage on an ally, allies taking over combat at 0-1 stages, Defense Shields as a separate step, Mastery cards and Tokui-Waza (Trunks Saga cards), cards that put allies into play ignoring the ally rules.

**Still open**
- **Constant Combat Power** encoding: stored as a `COMBAT_EFFECT` strike wrapping `constantPower`; a passive field on the power would be cleaner.
