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
- Allies in combat (p. 34-35): the defender chooses who takes power stage damage (option `damageTarget`: main personality or an ally with stages; an ally's unabsorbed stages and all life card damage come off the life deck). At 0-1 power stages a player may let an ally take over (`ALLY_TAKEOVER`, a free choice in the attack phase or defend window): until combat ends the ally's card is the fighting personality (power, power level, alignment for card restrictions) and its stages pay costs and take stage changes; anger and levels stay with the main personality.
- Not implemented: cards that put allies into play ignoring the ally rules.

**Still open**
- **Constant Combat Power** encoding: stored as a `COMBAT_EFFECT` strike wrapping `constantPower`; a passive field on the power would be cleaner.

## Trunks Saga

210 cards (TS-1 to TS-200, TS-P1 to TS-P10), transcribed from the images in five parts, all `verified: false`; 172 carry `needsReview`. Card pool "Saiyan + Frieza + Trunks" uses the Trunks Saga rules plus `tokuiWaza`. The image index numbers are rebuilt from the bucket ranges because WordPress renamed duplicate uploads (`scripts/fetch-card-index.ts`).

**New rules**
- `tokuiWaza` (p. 38): when every styled card in the life deck has one style, the player claims it at setup: +1 PUR (`PlayerState.tokuiWaza`). Saiyan only for Saiyan heritage characters, Namekian only for Piccolo and Nail, and a Mastery card must match. Claimed automatically (it is always a benefit). Auto decks build single-style decks.
- **Mastery cards** (type `Mastery`, TS-144 to TS-149): `DeckList.mastery`, placed in play at the start (`PlayerState.mastery`), never in the life deck. Their effects work through the same channels as drills (`permanentSources`: triggers, damage bonuses, table effects).
- **Defense Shield** (p. 25, step 6): `defenseShield {attackType, count}` inside a Constant Combat Power; after the defender's effects, it stops the first N attacks of that type each combat that were not stopped.
- **Namekian** style and **Namek Dragon Balls**: recognised by name ("Namek"); a deck uses Earth or Namek Dragon Balls, not both.

**Engine support added**
- `permanentSources`: drills, the Mastery card and Constant Combat Powers; their `triggeredEffect` and owner damage bonuses (`damageModifier` with `scope: "OWNER"`, `styleOverride`) apply all the time. `ifInPlay` inside a constant power gates its contents (`activeCustom`).
- Triggers: `afterOpponentStopsAttack`, `styleFilter`, `condition.tookLifeCards`.
- Timings: `beginningOfCombatStep`, `combatOpening` (TS-P10), `afterOpponentDeclaresCombat` (automatic power, TS-188).
- Handlers: forbidCards, ifDrawnCardStyle, angerReductionLimit, drawUntilHandSize, preventStageGain, preventLevelUp, modifyAngerPerCardInPile, reflectDamage, shuffleHandCardIntoLifeDeck, damagePerStage, attackAsDefense, cardsCannotBeStopped, disableConstantPowers, chooseOne, shuffleIntoLifeDeck, modifyStagesPerLifeCard, removeTopDiscardForAnger, angerToLevelUp, postponeVictory, requireMultipleDefenses, moveHandCardToLifeDeck, shuffleOpponentHandCard, rearrangeLifeDeckTop; `damageModifier` variants (thisAttack no life cards, thisCombat "stages or life cards", thisCombat owner bonus, bonus on the current attack).
- Cards that only work "for the remainder of this combat" cannot be used outside combat.

**Approximations**
- "You may" effects left out (always allowed not to use): TS-13 energy damage as stages, TS-P3 shuffle instead of bottom, TS-70 extra energy attack. TS-P9 shows the top 5 and keeps their order (one of the allowed orders).
- TS-144 (once per combat) is offered at the start of each combat; TS-146 gives every energy attack +1 life card and only Orange Style attacks the cost reduction.
- TS-185 "must play 2 cards that stop physical attacks": a card defense needs a second stopping card from hand, which is discarded with it; no power defense.
- TS-189 / TS-107 (use any personality's power stage for damage) and TS-124 (allies back to hand next turn) are not implemented yet.
- Transcription questions are in each card's `needsReview` note (alignments of Trunks, Garlic Jr., Spice, Vinegar and King Cold are assumed).

## Androids Saga

136 cards (AS-1 to AS-125, AS-P1 to AS-P11), transcribed from the images in three parts, all `verified: false`; 104 carry `needsReview`. Images are in `public/cards/androids-saga/` (gitignored). The pool "Saiyan + Frieza + Trunks + Androids" runs on the Trunks Saga rules (no Androids Saga rulebook is available). Cell Saga images and index are cached too (`src/data/cell-saga/index.json`) but not transcribed yet.

**Assumptions**
- "If you declared Tokui-Waza" = the style bonus claimed at setup (`PlayerState.tokuiWaza`); `ifTokuiWaza {then, replaceDamage?}`. AS-65's "+2 instead of +1" is a base +1 plus an additive +1 `conditionalPassive` (the additive part is not applied by the engine yet).
- Android 16, 17, 18, 19 and 20 are Villains ("alignment assumed"); Vegeta Lv1 follows the Saiyan Saga data.
- AS-6 and AS-39 ("energy attack doing +3 power stages") = the default 4 life cards plus 3 stages. AS-19 "lower levels to 0" = anger. AS-17 and AS-22 are printed Physical Combat but stop an energy attack: encoded as `DEFENSE_ENERGY`. AS-P4's attack icon is faint, read as a sword.
- Every card carries a red "R R" (Red Ribbon) badge: no printed rules effect.

**Implemented**: `ifTokuiWaza`, `ifStopped` (runs from `damageIfStopped` in the sequencer), `ifOwnAlignment`, `ifBottomDiscardStyle`, `discardLifePerAnger`, `shuffleHandIntoLifeDeck`, `moveDragonBallsToBottom` (kept in found order, not chosen), `damagePerAnger`, `endCombatAfterDamage`, `angerRaiseLimit` (Location in `s.location` or table, read in `changeAnger`).

**Implemented later the same day**: `loseStagesForAnger` (OPTION choice, AS-13), `disableDrillPower` (`GameState.disabledDrills`, read by `tableEffects` and `permanentSources`, AS-21), `disablePersonalityPower` (`GameState.powerLocks`, read by `powerOptions` and `constantParams`; released by an own energy attack in `beginStrike`, or by a Dragon Ball placed in `playNonCombat`, which also discards the attached card, AS-24, AS-36), `playCostModifier` (extra life cards for named cards, `extraPlayCost` in the sequencer, AS-44), `discardNamedCardFromDeck` (names offered from the whole card pool, AS-52), `playLimit` (`nonCombatLimitReached` in `legal.ts`, counted from the log like the Dragon Ball limit, AS-55), `removeInsteadOfDiscard` (`sweepDiscards` after every action: new non-Dragon Ball cards in a discard pile are removed, AS-96), `useNonCombatInPlay` (pick destination `USE_NONCOMBAT`, runs from the combat-start auto power, AS-120), `playNonCombatInsteadOfAttack` (extra `PLAY_CARD` in combat, once per combat, AS-125).

**Still open**: AS-44 adds its life-card cost next to a stage cost instead of replacing it; the removal in AS-96 happens after the action, so cards discarded and recovered within one action are missed; params some existing handlers gained that the engine does not read yet (see `needsReview`), e.g. the Battleground start-of-turn discard (AS-7), Namekian Teamwork (AS-103), the additive `conditionalPassive` (AS-65) and Tien's Flight (AS-113).

## Cell Saga

210 cards (CS-1 to CS-200, CS-P2 to CS-P11; no P1), transcribed in four parts, all `verified: false`; 141 carry `needsReview`. Pool "Saiyan + Frieza + Trunks + Androids + Cell", same Trunks Saga rules. Images are in `public/cards/cell-saga/` (gitignored).

**Rulings and schema limits**
- **Dende Dragon Balls** (CS-39, 40, 73-75, 121, 122; "x of 7 Dende") are a third set of 7, next to Earth and Namek: `dragonBallKind` returns Dende, a deck holds one kind, and 7 Dende balls win like the others. Assumption: no Cell Saga rulebook.
- **Level 5 personalities** (CS-134, 136, 159, 160) print level 5 but the schema caps the level at 4: stored as level 4, "Lv5" kept in the name. 26 Lv2-Lv5 cards print 12-13 rating boxes where the schema takes exactly 11: the lowest values are dropped and listed in `needsReview`. The engine's maximum stage may need to go above 10.
- "The Car" is referenced by seven personalities but is not in any data set. CS-P11's "unless your Main Personality is Cell" exemption is not in the schema. CS-109 Bulma Lv3 prints 2,100 (probably 3,100), stored as printed.

**Implemented**: `ifOpponentNameContains`, `ifOpponentMoreStages`, `ifTopDiscardNotAttack`, `discardHand`, `setStages`, `loseGameIfOpponentSurvives`, `modifyCombatDraw` (read in `defenderDraw`).

**Not implemented yet** (WARN, the clause does nothing): `lookAtTopCards` (CS-100), `placeSelfInLifeDeck` (CS-107), `discardToStopAttack` and `inPlaceOfAttackDiscard` (Mastery CS-126, CS-129). The new params many cards gained (see `needsReview`) are not read yet either; the sim logs "damage modifier not implemented for these parameters" most often.

## Cell Games Saga

135 cards (CG-1 to CG-125, CG-P2 to CG-P11), transcribed in three parts, all `verified: false`; 126 carry `needsReview`. Pool "Saiyan + Frieza + Trunks + Androids + Cell + Cell Games" (`ALL_SETS`). Images are in `public/cards/cell-games-saga/` (gitignored). Level 5 and 12-13 rating boxes are handled as in the Cell Saga (level 4 with "Lv5" in the name, lowest ratings dropped). "Cell Jr." is stored as characters "Cell Jr. 1" and "Cell Jr. 2" (alignment assumed Villain), so several can be allies at once.

**Keywords, explained by the Buu Saga rulebook (Erik's copy, 2002, ~/Downloads, 34 pages with a text layer; rule section printed pp. 48-55) and implemented**:
- **Endurance N** (about 45 cards): while taking life card damage from an unstopped attack, a discarded life card with Endurance N may be removed from the game to prevent N more life cards of damage. Only works in a deck that declared a Tokui-Waza; never from hand or play; not for non-attack life card loss. `millWithEndurance` in `damage.ts` always uses it (no choice asked). CG-112 `grantEndurance` gives Non-Combat cards in the life deck Endurance 1 when they have none. "Endurance X" (X from game state) is not used by any card yet.
- **Focused attacks** (9 cards, `focused` / `focusedAttack` in `onPlaySecondary`): cannot be stopped by Defense Shields, Masteries or cards that stop both attack types (`DEFENSE_ANY` cards, `autoStopAttack` ANY); matching Defense Shields are set off but do not stop it (`isFocused` in `abilities.ts`). Attacks that *become* focused through other effects are not handled.
- **Fight Back** is not a new phase to build: it is the existing step where the roles swap after each attack. CG-77 `skipFightBack` gives the same player another "Attacker Attacks" phase (energy attack or pass) through `combat.bonusAttack`.
- The Buu rulebook also defines Empower, Z power stages, fusion and Sensei cards (World Games and later; not implemented), and a new Physical Attack Table (up to 7,300,000+) for the newest sets, which the Cell-era pools do not use.

**Implemented**: `ifOwnStages`, `ifPowerRatingGreater`, `ifAnger`, `ifMainPersonality`, `winGame`, `discardLifeBoth` (always the maximum, no choice yet), `modifyStagesByAlignment`.

**Not implemented yet** (WARN or no effect): `temporaryPurModifier` (CG-5), `discardAttached` and `discardAttachedCards` (CG-44, CG-67), `rearrangeDiscard` (CG-62), `removeAndShuffleFromDiscard` (CG-65), `lookAtTopCards` (CG-68), `skipFightBack` (CG-77), `loseGameAtAnger` (CG-99), `placeAllyInsteadOfAttack` (CG-100). Defense Shield drills put `defenseShield` directly in `onEnterPlay` (9 cards): the engine reads it from personality powers only. `forbidCards` ignores the card-type filter of CG-8. Low-resolution scans: CG-124 and CG-125 may misread ("0 to 3" vs "2 or 3" cards, "+5" vs "-5").

## Cell Saga rulebook findings (Erik's copy, 2001; ~/Downloads, 64 pages, a scan without text layer)

The rulebook pages on card types, drills, Dragon Balls and the Cell Saga changes (printed pp. 36-50) say nothing about **Endurance**, **Focused attacks** or the **Fight Back** phase, and Erik confirms the Cell Saga book is the last Cell-era rulebook he has: those keywords are most likely explained in the Buu Saga rulebook (next series). The basic-rules pages (printed pp. 3-35) were not read. What it does settle (printed pp. 44-50 = PDF pages 46-52):
- **Physical Attack Table** (p. 37): 9 brackets up to 4,000,000, now `src/engine/config/pat-cell.json`, used by the Cell and all-sets pools. The scan is blurry; the matrix follows the same pattern as the Trunks table (8 base damage cap), brackets read as 0, 100, 10,000, 300,000, 700,000, 1M, 2M, 3M, 4M.
- **Level 5 main personalities** are legal ("up to level 5"): they allow level 3 allies and count for the Most Powerful Personality Victory. The schema still caps `level` at 4 (open).
- **Allies**: level 2 and 3 allies may go directly into play when the MP level allows it (MP at level 3, 4 or 5). Allies must be at least 2 levels below the MP's highest level (level 3 allies with a level 5 MP). Garlic Jr., Guldo and Frieza may capture Dragon Balls instead of doing damage (not implemented).
- **Deck**: 50 to 75 cards including the main personalities (80 for Piccolo, Nail or Cell with a Namekian Tokui-Waza); only one Dragon Ball type (Earth, Namek or Dende, no duplicates), which confirms Dende as a third set; Mastery cards are untouchable and count toward deck size.
- **Cell** may declare a Namekian or Saiyan Tokui-Waza and uses both Saiyan Heritage and Namekian Heritage cards. "Villains, Goku and Gohan only" = Saiyan Heritage; "Piccolo and Nail only" = Namekian Heritage.
- **Mandatory rules now**: Double Power Rule (if one MP starts at half the other's beginning stage, the lower one sets its Scouter to the top and the higher one to 2 stages above 0, the lower goes first) and the Tournament Dragon Ball rule (a captured Dragon Ball's power may be used at once, even if used this turn). Neither is implemented.
- **Nowhere to Hide**: cards that stop Step 4 Combat can only be played as an attack, never as a defense.
- **Cherry Picking**: after choosing cards from your Life Deck, reshuffle it and show the cards to the opponent. Only one Battleground or Location in play at a time (already so).

## World Games Saga

211 cards (WG-1 to WG-201, WG-P2 to WG-P11), transcribed in four parts, all `verified: false`; 181 carry `needsReview`. Pool `ALL_SETS` ("Up to World Games Saga") on the Cell Saga Physical Attack Table (no World Games rulebook; real ratings stay below 5M, so the table still works). Images are in `public/cards/world-games-saga/` (gitignored). Level 5 and 12-13 rating boxes are handled as in the Cell Saga.

**Sensei** (Buu Saga rulebook pp. 45-46): a Sensei card has a power and may come with a separate Sensei Deck (cards that say "Sensei Deck" or "Sensei Deck only", plus Fusion Personality cards); at setup you swap cards between the Sensei Deck and the top of your Life Deck. Not modelled. `senseiDeck` is a no-op marker (the card then simply works from the life deck); the auto decks leave out `senseiCard` cards (WG-125, 140, 149, 156) and "Sensei Deck only" cards. Deck legality (50-85 cards, 90 with a Namekian Tokui-Waza in the Buu era) is not enforced by the engine.

**Implemented**: `ifInDiscardPile`, `ifOpponentTokuiWaza`, `modifyAngerPerDragonBall`, and the "can stop a focused attack" exception (`canStopFocused` in `abilities.ts`, read in `defenseFor`).

**Not implemented yet** (WARN or no effect): Z power stages (WG-132 Grand Kai has placeholder ratings 5M-14M), Fusion, `placeSelfInLifeDeck`, `shuffleSelfIntoLifeDeck`, `grantOnHitEffect`, `grantFocused`, `damageCannotBeModified`, `placeInPlayIfDiscardedFromHand`, `modifyStagesChosen`, `ifRemovedCardMatchesMainPersonality`, `drawFromLifeDeck`, `disableMastery`, `nameCardsRemoveFromLifeDeck`, `replacePostResolution`, `discardTopLifeCardThen`, `opponentSplitsDiscard`, `modifyStagesPerCardInPile`, `protectDiscardPile`, `removeTopLifeCardThen`, and the personality powers that use them. "Majin only" cards use `usableBy` characters ["Majin"] as a placeholder; there are no Majin personalities yet, so they are never legal. The "removed from the game pile" zone and "cards under cards" are not tracked.

## Babidi Saga

133 cards (BB-1 to BB-123, BB-P2 to BB-P11), transcribed in three parts, all `verified: false` and all carry `needsReview`. In pool `ALL_SETS` ("Up to Babidi Saga", Cell Saga Physical Attack Table; the Buu rulebook table is for the newest sets). Images are in `public/cards/babidi-saga/` (gitignored). Majin Vegeta, Pui Pui, Babidi, Yakon, Dabura (Villain), Hercule, Supreme Kai and Jewel (Hero) are assumed alignments.

**Implemented**: Endurance X (`amount: "X"` with `x` = `ownAnger`, `dragonBallsControlled` or `ownPurMinus1`, read in `enduranceOf`).

**Open (about 40 handlers, WARN or no effect)**: `protectLifeDeck`, `forceAttackOrPass`, `placeSetAsideAtTurnStart`, `convertStagesToLifeCards`, `disableEndurance`, `ignoreEndurance`, `enduranceNoRemoval`, `ignoreCardUseRestrictions`, `costModifier` (BB-35 doubles all costs), `revealTopChooseOne`, `preventionBonus`, `unlessOpponentDiscards`, `storeUnderDrill` (cards under a Drill: no zone yet), `replaceFinalPhysicalAttack`, `allowUsableBy`, `matchOpponentStageGain`, `ifMoreCardsInDiscard`, `dynamicPur` (Majin Yakon's PUR X = the opponent's printed PUR), `switchStages`, `removeFromDiscardThen`, `compareTopCards`, `revealCardsForBonus`, `stagesAtAttackPhaseStart`, `damageCannotBePrevented`, `extendEffectDuration`, `preventSurvivalVictory`, `grantMajin`, `revealForDamage`, `discardHandForDamage`, `revealCompare`, `payLifeCardsForStages`, plus the open World Games and Cell handlers. Empower, Z power stages and Fusion are not implemented; Supreme Kai (BB-121) has placeholder Z ratings. "Majin only" cards use the `usableBy` placeholder ["Majin"] and are never legal until Majin matching exists. Level 5 and 12-13 rating boxes are handled as in the Cell Saga (BB-123 prints PUR 6, stored as 5).

## Buu Saga

212 cards (BU-1 to BU-201, BU-166-ALT with alternate art, BU-P2 to BU-P11), transcribed in four parts, all `verified: false`; 211 carry `needsReview`. The last card set transcribed. Pool `ALL_SETS` ("All sets (up to Buu Saga)") now uses the **Buu Saga Physical Attack Table** (`pat-buu.json`, 9 brackets to 7,300,000+; same damage matrix as the Cell table), because Buu personalities go up to about 8.6M. Images are in `public/cards/buu-saga/` (gitignored). "Alt. Dende Dragon Ball" cards are the Dende set (the rulebook knows only Earth, Namek and Dende); `dragonBallKind` matches them by name.

**New in this set, none implemented**: Empower N (`empower`, 13+ cards: drop the text after Empower for +N life cards), Fusion Personality cards (`fusionPersonality`, BU-154 and 155) and `fuseCharacters`, Sensei cards with `senseiCard {deckSize}` (BU-138, 153) and the Sensei Deck, the "Gambit" family (BU-56, 78, 85, 95, 103: reveal your hand when entering combat), attaching cards to personalities, Z power stages, a second power on Majin Buu personalities (BU-197 to 200, stored in `additionalPower`), Constant Combat Powers outside combat (BU-165, 190), BU-73 "Physical Attack Table B" (not in the rulebook text), and about 75 distinct handlers whose params are listed in the `needsReview` notes. The engine logs a WARN for each when a card is played; the all-sets AI sim still finishes every game.
Printing quirks: BU-162 prints 1,150,000 where 2,150,000 is probably meant (stored as printed); BU-151's ratings break the step; BU-41 Bee prints no ratings (placeholder 0-10); BU-152 and 155 print PUR 6 (stored 5, schema cap).

**Open-handler priority list** (113 handlers still missing across all sets, by number of cards): `empower` 30, `grantOnHitEffect` 12, `grantFocused` 9, `shuffleSelfIntoLifeDeck` 8, `ifHandStyleCount` 6, `attachToMainPersonality` 6, `senseiCard` 6, `removeFromDiscardThen` 5, `revealHandOnce` 5, `costModifier` 4, `discardFromHandThen` 4, `additionalPower` 4. Plan for Empower: the `empower` marker (in `onPlaySecondary`, with the following text in `dropped`) queues a CONFIRM choice; on accept add `amount` to `modifierLifeCards` of the current strike and remove the `dropped` effects from the remaining effects frame and from `onHit`. "Majin only" cards now work: `canUseCard` accepts any personality whose name starts with "Majin".

**Implemented afterwards (2026-10-20)**: `empower` (an OPTION choice at play time: index 0 = normal attack and the dropped text resolves, index 1 = +N life cards and the text is gone; the greedy AI prefers Empower), `grantOnHitEffect` and `grantFocused` (`CombatState.grants`, applied in `beginStrike`; conditions `opponentNoDrills` and `ownDrillsInPlay`, anything else is treated as false), `shuffleSelfIntoLifeDeck` and `placeSelfInLifeDeck` (`GameState.retireTo`, read in `retire`), `ifHandStyleCount`, `ifUserNameContains`, `drawFromLifeDeck`, `modifyStagesChosen` (all personalities of the target; a single choice is not asked). Still open: `attachToMainPersonality`, `senseiCard`/Sensei Deck, `removeFromDiscardThen`, `revealHandOnce`, `costModifier`, `discardFromHandThen`, `additionalPower`, Fusion, Z power and about 90 single-card handlers (rank them with the count script in this section). Checked in the browser: the pool menu lists all six pools (up to Buu Saga: 1655 cards), the all-sets character list includes the Majin and Buu-era characters, and a game starts without console errors.

**Implemented (second batch, 2026-10-20)**: `removeFromDiscardThen`, `ifMoreCardsInDiscard`, `ifTopDiscardCard`, `switchStages`, `modifyStagesPerCardInPile`, `discardTopLifeCardThen`, `removeTopLifeCardThen`, `lookAtHand` and `lookAtTopCards` (look only, logged), `modifyCombatDraw`, `costModifier` (BB-35: `costFor` doubles stage and life card costs while that Location is in play), `loseGameAtAnger` (CG-99, read in `changeAnger` from the player's Non-Combat cards). 93 handlers still missing; 125 of 1655 cards (Cell 2, Cell Games 4, World Games 11, Babidi 33, Buu 75) contain at least one, plus roughly 120 cards whose `damageModifier` variant is not applied (the engine logs "damage modifier not implemented for these parameters"). Frieza and earlier sagas are complete in this respect.

## Generic damage modifiers (2026-10-20, `src/engine/damagemods.ts`)

119 cards used `damageModifier` params the older hand-written paths ignored. A modifier is now "new style" when it carries one of `NEW_KEYS`; new-style params are skipped by the old paths (`ownDamageBoost`, `ongoingDamageChanges`, the handler) so nothing is counted twice, and old cards behave exactly as before. How they work:
- **Registration** (`registerDamageModifier`, from the `damageModifier` handler): `duration: "thisAttack"` goes on the current strike (`StrikeState.mods`); anything else goes on the combat (`CombatState.mods`), with `usesLeft` for "next attack" / `forNextAttacks` / `firstAttackOnly`, and `exceptSeq` so the strike that created it does not count. Ongoing ones (drills, Mastery, constant powers, the Location) are collected at hit time.
- **Application** (`applyNewModifiers`, called in `resolveHit` after the older modifiers): `applies()` decides whether the attack matches (`scope`/`target`/`protects`/`performedBy`, attack type, style, title, focused, named, defender name); `valueOf()` computes additive stages and life cards (static values, overrides by style, named card, defender or attacker name, and the per-count formulas: per Dragon Ball, ally, personality, personality level, card in a pile/in play, rarity, anger, PUR, Physical Attack Table) plus prevention (`preventStages`, `preventLifeCards`, `preventAll`, negative life cards with `prevent`), floors and caps, `multiplyBaseDamage`, `patBaseDamage` and `noModifiers`. Additions come first, prevention afterwards, then `minLifeCards`/`minStages`.
- Count formulas treat Drills as Non-Combat cards (Buu Saga rulebook p. 39); "Villains only" and "<name> Named" card filters are understood.
- **Accepted but without effect yet** (they need a player choice or extra state): `lifeCardsPerRemovedCard`, `stagesPerRemovedCard` and `lifeCardsPerDiscardedCard` (optional discards, BB-112, BU-10, BU-162, BU-183), `lifeCardsPerCardDrawnThisTurn` (BB-109), `raiseCardBonusesBy` (BB-13), `doubleDrillModifiers` (BB-93), `ifRemovedCardStyle` (CS-131), `preventStagesOrLifeCards: "stagesDealtByThisAttack"` (CG-104), `noCost` (CG-16's cost part), conditions like `damageRedirectedToOtherAlly` (never true), and attached modifiers (the attach mechanic is missing). "Until the opponent's next Attacker Attacks phase" (CG-110) lasts the rest of the combat. `bonusLifeCards` (AS-110) always pays its life card when the deck has more than 12 cards.
- The "damage modifier not implemented for these parameters" warning dropped from about 70 occurrences in a 60-game sim to 0 (CS-183 `noModifiers` was the last one).

## Attached cards (2026-10-20, `src/engine/attach.ts`)

`GameState.attachments` holds cards fixed to a personality (`kind: 'mp'`) or another card; they are skipped by `retire()`, counted in `allCardsOf`, and their effects count as permanent sources of the host's player. Params with `attached: true` on damageModifier, forbidCards, grantMajin and triggeredEffect (effects/index.ts) and the handlers attachToMainPersonality, attachToOpponentMainPersonality and attachToCard create them. Leaving conditions: `opponentDealsLifeCardDamage` (BU-54), `attachedPerformsEnergyAttack` (CG-118, removed from the game), `attachedPerformsSuccessfulAttack` (WG-103), `attachedPersonalityAtHighestStage` (CG-95, BU-127), host card gone, discardAttached (CG-44, CG-67).

Working: Red Gambit (+3 stages), Saiyan Gambit (+1M rating unless stage 0), Orange Gambit (no costs), Namekian Gambit (3 cards in Rejuvenation), M (counts as Majin), Injured, Vegeta's Surprised, Like Father Like Son, Red Trap (no Non-Combat for the host), Black Snap Kick (host card unusable), Blue Electrical Gunk (upkeep: discard 2 life cards).

Simplifications / not yet working: a "choice" host is picked automatically (opponent for restrictive cards, else own). Not enforced: Blue Gambit (allies up to 2 levels higher), Black Gambit (discard a card to discard an opponent card), Blue Eye Gouge (opponent cannot look at hand or life deck), Majin Buu's Stomach Throw (ally restrictions), Flight Training and Majin Vegeta's Rage (drill-attached triggers), AS-36 and AS-100 still use the older powerLocks. Attach hosts that are cards only drop when the host leaves play.

## Second constant power, unpreventable damage (2026-10-20)

`additionalPower` kind `constant` (BU-197..199, Majin Buu) is now read as a second Constant Combat Power (`state.constantEffectsOf`). BU-200's second attack power (kind `power`) is still not selectable. `damageCannotBePrevented` / `damageCannotBeModified` set `StrikeState.unpreventable`: the damage cannot fall below what it was before defenses and reductions (BB-87, BB-115, BB-120, BU-17, WG-56). Remaining long tail (89 cards, 1-6 each): senseiCard (6), discardFromHandThen (4), nameCardsRemoveFromLifeDeck (3), replacePostResolution (3), discardToStopAttack (3) and singletons.

## Attack-phase abilities (2026-10-20, `src/engine/activeabilities.ts`)

New action `USE_ABILITY {player, key}`: during the player's own Attacker Attacks phase, `discardFromHandThen` effects with `phase: attackerAttacks` on Masteries, constant powers, drills and attached cards can be used without giving up the attack. The cost is a PICK from hand (style / named filters), then the `then` effects run. Without `phase` (BU-131) the handler runs as a normal effect. The AI uses each such ability at most once per combat. Not on it yet: BB-56, BB-83, BU-142, BU-167, WG-156, BU-43 (other handlers).

## Discard to stop an attack (2026-10-20)

New action `DEFEND_DISCARD {player, key}` (`activeabilities.discardDefenses`): in the defend window a player with a `discardToStopAttack` source (drill, Mastery, power, attached card) may discard a card from hand or a Non-Combat card in play to stop a non-focused attack. BB-P10 then passes for the rest of the combat (via finalAttack). CS-126 is once per combat; its extra "if Blue Style, lower the opponent's anger 2 levels" is not applied. The AI values it at 5 (below real blocks).
