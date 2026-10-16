# Todo: kaartdata Saiyan Saga corrigeren

Werklijst bij `src/data/saiyan-saga/cards.json` (266 kaarten, alle `verified: false`; het actuele aantal `needsReview` geeft `npx tsx scripts/validate-cards.ts`). Afbeelding per kaart: `public/cards/<slug>.jpg` (zie `imageUrl`). Vink af wat klaar is; haal bij een gecorrigeerde kaart de `needsReview` weg.

Bronnen: het Saiyan Saga-regelboek (2000, PDF van DBZOutpost, lokaal bij Erik), de officiële kaartchecklist achterin dat regelboek, en de Score Current Rulings Document (CRD v11.24.04, https://lackeyccg.com/dbzccg/dbzcrd.pdf), met een Saiyan Saga-sectie per kaart.

Volgorde: eerst de beslissingen in deel A, want die bepalen hoe je tientallen kaarten in B t/m E corrigeert.

## A. Beslissingen die veel kaarten tegelijk raken

- [x] **A1. Personality-powers.** Opgelost volgens het Saiyan Saga-regelboek (p. 20): een power mag één keer per Combat-stap worden gebruikt, als aanval of om een aanval te blokkeren; een nieuw level geeft een nieuwe, ongebruikte power. Alle 28 niet-aanvalspowers staan nu als `personality.power`: verdedigingen als `DEFENSE_*` + `powerDefense` (Energy Deflection, SS-86, 87, 160, 178, 184, P7), triggers als `COMBAT_EFFECT` + `playTiming` (SS-164, 175, 180, 182, 185), Multi-Form als aanval + `extraAttack`/`dualUse` (SS-82, 163). Engine-werk (power in de verdedigingsfase, `defense` op StrikeSchema) staat in `docs/dsl-gaps.md`.
- [x] **A2. Power die een aanval met naam noemt.** Opgelost: Kamehameha, Screw Blast, Power Ball en Power Blast zijn geen losse kaarten maar de aanval van de power zelf. SS-158 en SS-166 omgezet naar energy attack (1 stage, 3 life cards); SS-104 was al goed; SS-P2 gebruikt de Lv2- of Lv3-power.
- [x] **A3. Stijl.** Bevestigd, geen datawijziging nodig. Saiyan Saga-regelboek p. 24-25: de stijlen zijn Red, Blue, Orange, Black en Saiyan en zijn te herkennen aan de stijlnaam in de titel; Move-kaarten en Named cards hebben geen stijl ("ignore the diamond and symbol"). Het latere Score-regelboek (2002) zegt het expliciet: "Freestyle cards do NOT have a Martial Arts Style listed in the first word of the card title". Het ruitje met kanji is dus geen betrouwbare bron: de stijlloze Straining Move-kaarten dragen hetzelfde blauwe 青 als Blue-kaarten. Huidige data: 18 kaarten per stijl, 176 freestyle (geen `style`).
- [x] **A4. Named cards.** Bevestigd, geen datawijziging nodig. Saiyan Saga-regelboek, glossary: "Named Card: A Combat or Non-Combat card having a character's name in its card title". Een personagekaart in deze set is dus niet nodig. De rulings (CRD) bevestigen het voor Roshi: "Any cards with 'Roshi' in the title are considered Named Cards for Master Roshi". Alle 61 kaarten met een personagenaam in de titel hebben `named`; Roshi (SS-78, SS-239), King Kai (SS-79, SS-88, SS-238) en Baba (SS-224, SS-225) blijven staan.
- [x] **A5. Kaartnamen.** Gecontroleerd tegen de officiële checklist achterin het Saiyan Saga-regelboek. De gedrukte titels van SS-28 "Vegeta's Physical Stance", SS-37 "Straining Tripping Move", SS-117 "Raditz Energy Wall" en SS-192 "Teaching the Unteachable Forces Observation" kloppen; index.json/de fansite zit ernaast (de slugs blijven voor `imageUrl`). Zes kleine verschillen met de checklist (SS-10, 30, 60, 131, 148, 206) zijn tegen de kaartafbeelding gecheckt: cards.json volgt de gedrukte kaart, de checklist heeft daar zelf afwijkingen (bijv. "Blinding Flare"). Hi-tech-kaarten heten nu "<Naam> Lv1 HT" (checklist: "Level 1HT"). "Chi-Chi" met koppelteken klopt. Conventie: personalities "<Naam> Lv<n>", ® en ™ weggelaten, `!` en koppeltekens zoals gedrukt.
- [x] **A6. Straining-kaarten.** Opgelost met de Score Current Rulings Document (CRD, v11.24.04): "A cost exists on a card only if the word 'cost' (or the terms 'costs' and/or 'costing') appears on the card itself." De zelf-drain van SS-34, 35, 36, 37 is dus geen `cost` maar een secundair effect (`MODIFY_STAGES SELF`), dat ook doorgaat als de aanval geblokt wordt (regelboek p. 20). Je mag de kaart dus ook spelen met minder stages. "Discard another card" bij SS-40/41 is een requirement. SS-38 volgt de CRD: "You must pass in all remaining phases of Combat". SS-39 is een reactiekaart direct nadat de tegenstander aanvalt en kosten betaalt (CRD bevestigt).
- [x] **A7. Power-up voor een ally.** Regelboek p. 23: "Allies can be chosen to benefit from power-up cards instead of the Main Personality." Geldt voor SS-22, SS-97, SS-98 en SS-201 (tekst "a/the personality"), niet voor SS-43 Senzu Bean ("the main personality"). Data blijft SELF tot de engine een doel "MP of ally" heeft (schema-gap in `docs/dsl-gaps.md`). Nog open: tellen de Dragon Balls met "power up to full" (SS-15, SS-77) ook als power-up card?
- [x] **A8. Personagenamen in kaarttekst.** Een naam in de tekst slaat op de gebruiker van de kaart; alleen "If used by X" maakt een effect voorwaardelijk (SS-25, SS-108, SS-112, SS-113 houden `ifUsedBy`). Onderbouwing: regelboek p. 32 laat named cards van anderen toe "to represent learning someone else's powers", en de kaarten die het wél voorwaardelijk bedoelen zeggen dat expliciet. Aangepast: SS-26, SS-110, SS-111, SS-120, SS-121 (effect geldt voor de gebruiker), SS-28 (beschermt de gebruiker), SS-112 en de Honor Duels SS-101, SS-102, SS-103 (gelden voor de speler die ze gebruikt).
- [x] **A9. Dubbelrol-kaarten.** Regelboek p. 20: bij "or" kiest de speler één van beide; delen zonder "or" gebeuren altijd, vóór de verdediger reageert. SS-13, SS-66 en SS-70 waren al zo gecodeerd: de anger-wijziging van SS-13 en SS-70 staat buiten `dualUse` en geldt in beide modi.
- [x] **A10. Gebruiksbeperkingen.** De engine-sessie heeft `usableBy`, `exclusiveDrillStyle` en `noStacking` aan `CardSchema` toegevoegd. Ingevuld voor 25 kaarten: `usableBy` voor 18 (Saiyan-groep SS-18-21, 91-96, 119; SS-80; Heroes SS-78, 79, 89, 195; Villains SS-45, 213), `exclusiveDrillStyle` voor 6 drills (SS-135, 136, 142, 143, 148, 150) en `noStacking` voor SS-250. Het afdwingen in de engine ligt bij de engine-sessie. Bijvangst: de achtergrondkleur (regelboek: blauw = Hero, rood = Villain) bevestigt de alignment van alle 36 gewone personalities.
- [x] **A11. CRD.** Besluit (Erik): we volgen de gedrukte tekst van 2000 en het Saiyan Saga-regelboek van 2000. De CRD gebruiken we alleen als hulp bij het interpreteren van onduidelijke tekst, nooit om een kaart te veranderen ("Treat this card as if it read ..." nemen we niet over). Errata kunnen later eventueel als aparte, nieuwere regelset worden toegevoegd. SS-164 en SS-182 volgen daarom weer de gedrukte timing.

## B. Tekst en getallen controleren tegen de afbeelding

Afgerond: alles uitvergroot naast de kaartafbeelding gelegd; `rawText` volgt de gedrukte tekst letterlijk.

- [x] SS-140 Red Reading Drill: er staat echt een punt ("discard. once"), ondanks de kleine letter erna. Zo gelaten.
- [x] SS-135 Black Arm Bar Drill: er staat echt "Orange drills" op deze Black drill. Zo gelaten; `exclusiveDrillStyle: "Orange"`.
- [x] SS-172, SS-183, SS-P5, SS-P7: inderdaad geen afsluitende punt gedrukt. Zo gelaten.
- [x] SS-P2 Piccolo Lv4: 9e rating is 11500 (op de silver scherp; de "1150.0" op de basisafbeelding is een scanfout).
- [x] SS-65 Black Fore Fist Punch: tekst klopt. Codering aangepast: 6 life cards schade plus, bij een hit, de tegenstander 3 stages lager (niet onder 0). Eerst stond het als "3 stages schade", wat onder 0 zou doorlopen naar extra life cards.
- [x] SS-P3 Vegeta Lv4: "which ever" staat zo gedrukt. `MODIFY_STAGES` gaat in de engine niet onder 0, dus "or to 0" klopt.

## C. Type of rol wijkt af van de gedrukte banner of de titel

Afgerond. Bron: Saiyan Saga-regelboek (2000) en het zwaard/starburst-icoon naast "POWER", dat ik op alle 250 kaarten automatisch heb gecontroleerd. Alle aanval-/verdedigingsrollen kloppen met hun icoon, behalve SS-217 (zie onder).

- [x] SS-230 Chiaotzu's Drill: blijft Physical Combat (banner); een Drill is volgens het regelboek een Non-Combat-kaart.
- [x] SS-210 Raditz Flying Kick en SS-212 Piccolo's Flight: blijven Non-Combat met aanval- of verdedigingsrol. Regelboek: Non-Combat-kaarten liggen open op tafel en je gebruikt ze later in de combat als aanval of blok. SS-210 rekent nu "triple damage" net als SS-46. Engine-gap: Non-Combats worden nu meteen bij het neerleggen uitgevoerd.
- [x] SS-188 Earth Dragon Ball Capture: zwaard-icoon, geen aanvalstekst; blijft een effect in plaats van een aanval.
- [x] SS-229 Ally Wins!: zwaard-icoon; geen physical/energy attack, dus niet te blokken; blijft een effect.
- [x] SS-112, SS-117, SS-118, SS-119, SS-250: de titels zeggen "Defense"/"Blast", maar de tekst en het icoon beslissen. SS-117 en 118 (zwaard) zijn effecten in de aanvalsfase. SS-112 en 119 (starburst) worden in de verdedigingsfase gespeeld. SS-250 (starburst) is nu een verdediging: 1 life card minder, en daarna de rest van de combat voor alle heroes.
- [x] SS-217 Ribs Broken: starburst gedrukt, maar de tekst is een energy attack; de tekst wint. Een ally opofferen is een requirement; de standaard energy-kost (2 stages) geldt ook (regelboek p. 18: "unless otherwise noted").
- [x] SS-83 Tien Lv2, SS-85 Yamcha Lv2: Solar Flare doet de standaard 4 life cards (regelboek p. 18: "unless otherwise noted").
- [x] `usePhase` (door de engine-sessie toegevoegd) ingevuld voor de 18 effectkaarten: ATTACK (zwaard) voor SS-117, 118, 188, 205, 229; DEFEND (starburst) voor de andere 13.

## D. Interpretatie per kaart

Opgelost met de gedrukte tekst en het regelboek van 2000:
- [x] Non-Combat-kaarten liggen open op tafel tot ze gebruikt worden en gaan daarna weg (regelboek p. 14). Daarmee: SS-30, 31, 33 wachten op de eerste geslaagde aanval en gaan dan uit het spel; SS-48 en SS-157 wachten op hun trigger en worden daarna afgelegd (157 is dus eenmalig); SS-45 werkt direct bij gebruik.
- [x] Positie in de discard pile: als de kaart de bovenste bedoelt staat er "top" (SS-22, SS-75); anders kiest de speler. Aangepast: SS-169, SS-193, SS-204. SS-79 haalt de 2 kaarten uit de discard pile, net als de vergelijkbare SS-80 en SS-89.
- [x] SS-12: het stop-effect staat los van "if successful", dus gebeurt altijd (regelboek p. 20).
- [x] SS-17: "for just this attack", dus alleen tijdelijk voor deze schade.
- [x] SS-38, SS-39: codering blijft; SS-39 heeft een reactievenster in de engine nodig.
- [x] SS-75, SS-77: trekken is optioneel (nieuwe handler `optional`).
- [x] SS-112: geldt voor de discard van deze aanval; met Krillin nog één keer.
- [x] SS-191: elke level 1- of 2-personality, eigen of van de tegenstander. SS-198: "decks" = life deck. SS-208: blijft liggen tot de voorwaarde, dan uit het spel. SS-214: starburst + "stops the foe's combat turn" = combat beëindigen. SS-220: plafond van 1 life card. SS-241: "his life deck" = de life deck van de tegenstander.
- [x] Drills: SS-126 is een "activated" drill (één keer vegen, drill blijft liggen); SS-132 beschermt de eigenaar; SS-141 alleen het concrete deel; SS-234 de eigen drills.
- [x] Personalities: SS-86, SS-87 en SS-246 kloppen (SS-246 vraagt in de engine een voorwaarde vóór de aanval).

Besloten door Erik (geen directe regel in het regelboek, advies op basis van de tekst en vergelijkbare kaarten):
- [x] SS-58 Red Back Kick: stopt alleen de energy attacks van de tegenstander, de rest van de combat.
- [x] SS-81 Saiyan Armor, SS-88 King Kai Uniform: blijven op tafel liggen en werken bij elke geslaagde aanval van dat type.
- [x] SS-165 Gohan Lv2: één keer per spel, alleen als zijn eerste aanval in een combat.
- [x] SS-226 T-Rex Defense: vangt alle fysieke schade op tot de eerste energy attack. Die raakt de speler gewoon, daarna gaat de kaart uit het spel.
- [x] SS-242 Dream Machine Battle: de combat stopt en power stages en anger van beide spelers gaan terug naar de stand aan het begin van deze combat.

## E. Varianten en promo's

- [x] Hi-tech SS-179 t/m SS-185: andere power dan de basiskaart, ratings gelijk; PUR 1 op SS-184 en SS-185 tegenover 2 op SS-173 en SS-176. Bevestigd op de afbeeldingen.
- [x] Silver-promo's SS-P1-SILVER t/m SS-P7-SILVER: data identiek aan de gewone promo (automatisch vergeleken; P2 en P6 ook visueel).
- [x] SS-P4-ERROR (Goku, gedrukt als "P4") en SS-P115-ERROR (Nappa, "P115"): data klopt met de afbeelding. Opvallend: de error-Goku heeft dezelfde ratings als Piccolo P2 (8000-12500) en de error-Nappa dezelfde als Vegeta P3 (20000-38000), maar zo staan ze gedrukt. Id-schema `SS-P<n>-ERROR` gehandhaafd.
- [x] SS-P115-ERROR: gedrukte PUR 5; het schema staat nu PUR 0-5 toe (engine-sessie), dus de kaart staat op 5.

## F. Eindcontrole

- [ ] Alle 266 kaarten doorlopen in het review-scherm, naast de afbeelding. Geen enkele kaart heeft nog `needsReview`. Tegen de afbeelding gecontroleerd zijn alleen de kaarten uit deel A t/m E en de steekproeven, plus de iconen en alignments via de automatische check.
- [ ] Per gecontroleerde kaart `verified: true` zetten.
- [x] `npx tsx scripts/validate-cards.ts`: 266 kaarten, 0 invalid, 0 needsReview.
