/**
 * Creative narrative: the flat fixture.
 *
 * Nothing in a lighthouse keeper's journal is forced. Every step has half a
 * dozen live options, so the head probability sits far lower than in the
 * factual fixture and the bars in the panel come out nearly level.
 *
 * That has a hard ceiling, and it is worth being explicit about it: the entropy
 * of a ten-candidate distribution cannot exceed log2(10) = 3.3219 bits, and a
 * tail that still decays a little -- as every real one does -- puts the
 * practical maximum near 3.2. Asking for 4.2 bits from a top-10 list is asking
 * for something a top-10 list cannot represent, so the band declared here stops
 * at 3.25 and the spec aims at 2.5-3.2.
 *
 * The category bands are overridden downward for the same reason. A determiner
 * carrying 0.9 of the mass would drag the step to 0.5 bits and break the band;
 * in genuinely open prose a determiner really does only carry about a third.
 */

import { at, br, fin, s, type FixtureSpec } from './types';

const SUB = ['bird', 'birds', 'weed', 'side', 'water', 'shore', 'fowl', 'scape', 'gulls', 'farers'];

const PUNCT = [',', '.', ';', ':', ' -', ' --', '...', '!', '?', "'", '—', ')'];

const WATCH_FUNC = [
  ' the', ' a', ' my', ' this', ' that', ' its', ' and', ' but', ' for', ' with', ' of',
  ' in', ' on', ' at', ' since',
];
const WATCH_WORDS = [
  ' water', ' wind', ' fog', ' light', ' harbour', ' weather', ' swell', ' horizon',
  ' storm', ' shore', ' morning', ' silence', ' glass', ' cold',
];

const BIRD_FUNC = [
  ' the', ' my', ' our', ' this', ' those', ' and', ' but', ' so', ' then', ' at', ' on',
  ' with', ' from', ' for', ' since',
];
const BIRD_WORDS = [
  ' gulls', ' bread', ' crumbs', ' rail', ' rocks', ' light', ' fog', ' morning', ' shore',
  ' water', ' lamp', ' wind', ' basket', ' ledge',
];

const DREAD_FUNC = [
  ' the', ' a', ' my', ' this', ' that', ' out', ' there', ' below', ' beyond', ' still',
  ' and', ' but', ' now', ' yet', ' since',
];
const DREAD_WORDS = [
  ' sea', ' night', ' light', ' fog', ' water', ' wind', ' silence', ' dark', ' cold',
  ' shore', ' lamp', ' watch', ' count', ' patience',
];

export const CREATIVE_SPEC: FixtureSpec = {
  id: 'creative',
  label: 'Creative narrative',
  description:
    'A lighthouse keeper\'s journal entry. Flat distributions near the top-10 entropy ' +
    'ceiling: every step is a real choice, and the sliders visibly change the story.',
  prompt: 'The lighthouse keeper wrote in her journal:',
  seed: 0x5ea1,
  text:
    ' The sea has been quiet for three days, which is never a good sign.' +
    ' I counted the seabirds at dawn and found fewer of them, so I have begun leaving bread on the north rail.' +
    ' Something out there is keeping score.',
  band: [2.5, 3.25],
  classifier: 'prose',
  // Peaked categories do not exist in prose this open; these bands are what a
  // 2.5-bit floor actually implies for a determiner or a full stop.
  headBands: {
    func: [0.22, 0.5],
    punct: [0.22, 0.5],
    content: [0.14, 0.42],
    bound: [0.25, 0.55],
    sub: [0.25, 0.55],
  },
  entropyOffsets: { func: -0.22, punct: -0.26, content: 0.06, bound: -0.3, sub: -0.3 },
  wiggle: 0.15,
  regions: [
    {
      label: 'watch',
      from: 0,
      target: 2.92,
      escape: ['.'],
      pools: { func: WATCH_FUNC, punct: PUNCT, content: WATCH_WORDS, sub: SUB },
    },
    {
      label: 'birds',
      from: 16,
      target: 2.96,
      escape: ['.'],
      pools: { func: BIRD_FUNC, punct: PUNCT, content: BIRD_WORDS, sub: SUB },
    },
    {
      label: 'dread',
      from: 40,
      target: 2.88,
      escape: ['.'],
      pools: { func: DREAD_FUNC, punct: PUNCT, content: DREAD_WORDS, sub: SUB },
    },
  ],
  steps: [
    // ------------------------------------------------------------ the sea
    // The entry node, and the one a visitor will click around in most. Five of
    // its alternatives keep the sentence and change its opening; four leave for
    // a different sentence entirely.
    s(' The', 'func', [
      at(1, ' A', ' grey'),
      at(1, ' This', ' morning', ' the'),
      at(1, ' Out', ' here', ' the'),
      at(1, ' Every', ' day', ' the'),
      at(1, ' Since', ' Tuesday', ' the'),
      br(' I', ' have', ' not', ' slept', '.'),
      br(' Nothing', ' moved', ' all', ' night', '.'),
      br(' Fog', ' again', ' at', ' dawn', '.'),
      fin(' Storm', ' coming', ' in', ' fast', '.'),
    ]),
    s(' sea', 'content', [
      ' water',
      ' wind',
      ' fog',
      ' light',
      ' bay',
      ' weather',
      ' swell',
      ' morning',
      ' harbour',
    ]),
    s(' has', 'func', [
      ' had',
      at(2, ' was'),
      at(2, ' is'),
      at(2, ' seems'),
      at(2, ' feels'),
      at(2, ' looks'),
      at(2, ' stayed'),
      at(2, ' lay'),
      at(2, ' sits'),
    ]),
    s(' been', 'func', [
      ' gone',
      ' lain',
      ' stayed',
      ' looked',
      ' felt',
      ' seemed',
      ' turned',
      ' grown',
      ' run',
    ]),
    s(
      ' quiet',
      'content',
      [' still', ' calm', ' flat', ' grey', ' silent', ' empty', ' glassy', ' strange', ' restless'],
      // The recorded line took the model's second choice here. Sampling does
      // that constantly; a spine that never does looks like greedy decoding.
      { rank: 1 },
    ),
    s(' for', 'func', [' these', ' since', ' all', ' most', ' nearly', ' this', ' in', ' over', ' through']),
    s(' three', 'content', [' two', ' four', ' five', ' six', ' ten', ' eleven', ' twelve', ' several', ' nine']),
    s(' days', 'content', [
      ' nights',
      ' weeks',
      ' mornings',
      ' hours',
      ' evenings',
      ' months',
      ' watches',
      ' tides',
      ' winters',
    ]),
    s(',', 'punct', [
      br('.', ' Nothing', ' good', ' follows', '.'),
      br(' -', ' longer', ' than', ' usual', '.'),
      ';',
      ':',
      '...',
      '!',
      '?',
      '—',
    ]),
    s(' which', 'func', [' and', ' that', ' this', ' it', ' but', ' so', ' as', ' though', ' something']),
    s(' is', 'func', [' was', "'s", ' feels', ' seems', ' means', ' can', ' will', ' would', ' stays']),
    s(' never', 'func', [
      ' not',
      ' rarely',
      ' seldom',
      ' hardly',
      ' always',
      ' surely',
      ' certainly',
      ' generally',
      ' usually',
    ]),
    s(' a', 'func', [' the', ' any', ' one', ' my', ' this', ' that', ' some', ' its', ' such']),
    s(' good', 'content', [
      ' great',
      ' happy',
      ' welcome',
      ' safe',
      ' cheerful',
      ' promising',
      ' kindly',
      ' restful',
      ' pleasant',
    ]),
    s(' sign', 'content', [
      ' omen',
      ' signal',
      ' comfort',
      ' thing',
      ' mark',
      ' portent',
      ' hint',
      ' story',
      ' business',
    ]),
    s('.', 'punct', [
      br(',', ' not', ' out', ' here', '.'),
      br(' -', ' not', ' in', ' March', '.'),
      '!',
      '...',
      ';',
      ':',
      '?',
      '—',
    ]),

    // ---------------------------------------------------------- the birds
    s(
      ' I',
      'func',
      [
        ' We',
        ' She',
        ' Father',
        ' Someone',
        ' Nobody',
        at(1, ' This', ' morning', ' I'),
        at(1, ' At', ' dawn', ' I'),
        br(' Yesterday', ' the', ' glass', ' fell', '.'),
        fin(' Nothing', ' answered', ' the', ' light', '.'),
      ],
      { clause: true },
    ),
    s(' counted', 'content', [
      ' watched',
      ' fed',
      ' saw',
      ' logged',
      ' numbered',
      ' checked',
      ' followed',
      ' missed',
      ' lost',
    ]),
    s(' the', 'func', [' my', ' those', ' our', ' two', ' six', ' some', ' these', ' all', ' several']),
    // " sea" + "birds" is one compound split across two tokens, so every rival
    // here is a word that also takes "birds": songbirds, shorebirds, blackbirds.
    s(' sea', 'content', [
      ' shore',
      ' water',
      ' song',
      ' black',
      ' night',
      ' snow',
      ' lady',
      ' thunder',
      ' land',
    ]),
    s('birds', 'sub', ['bird', 'weed', 'gulls', 'side', 'scape', 'farers', 'water', 'shore', 'fowl']),
    s(' at', 'func', [' before', ' after', ' since', ' near', ' by', ' this', ' each', ' from', ' around']),
    s(' dawn', 'content', [
      at(1, ' first', ' light'),
      ' sunrise',
      ' noon',
      ' dusk',
      ' daybreak',
      ' sunset',
      ' midday',
      ' morning',
      ' nightfall',
    ]),
    s(' and', 'func', [',', ' then', ' but', ' though', ' before', ' after', ' as', ' so', ' -']),
    s(' found', 'content', [
      ' saw',
      ' counted',
      ' noted',
      ' logged',
      ' watched',
      ' knew',
      ' feared',
      ' judged',
      ' reckoned',
    ]),
    s(
      ' fewer',
      'content',
      [' fifteen', ' seven', ' none', ' more', ' half', ' three', ' twelve', ' less', ' six'],
      { rank: 1 },
    ),
    s(' of', 'func', [' among', ' about', ' than', ' in', ' upon', ' beside', ' around', ' near', ' from']),
    s(' them', 'func', [' those', ' birds', ' us', ' these', ' any', ' all', ' either', ' both', ' many']),
    s(',', 'punct', [
      br('.', ' The', ' rest', ' had', ' gone', '.'),
      ';',
      ' -',
      '...',
      ':',
      '!',
      '?',
      '—',
    ]),
    s(' so', 'func', [' and', ' but', ' which', ' then', ' now', ' though', ' since', ' as', ' yet']),
    s(' I', 'func', [' we', ' she', ' Father', ' they', ' one', ' someone', ' nobody', ' he', ' Anna']),
    s(' have', 'func', [
      ' had',
      "'ve",
      at(2, ' started'),
      at(2, ' began'),
      at(2, ' left'),
      at(2, ' took'),
      at(2, ' set'),
      at(2, ' tried'),
      at(2, ' meant'),
    ]),
    s(' begun', 'content', [
      ' started',
      ' been',
      ' kept',
      ' resumed',
      ' considered',
      ' stopped',
      ' quit',
      ' avoided',
      ' risked',
    ]),
    s(' leaving', 'content', [
      ' setting',
      ' putting',
      ' laying',
      ' scattering',
      ' throwing',
      ' saving',
      ' dropping',
      ' keeping',
      ' tossing',
    ]),
    s(' bread', 'content', [
      ' crumbs',
      ' scraps',
      ' food',
      ' fish',
      ' grain',
      ' suet',
      ' oats',
      ' biscuit',
      ' crusts',
    ]),
    s(' on', 'func', [' out', ' along', ' at', ' near', ' beside', ' under', ' by', ' across', ' upon']),
    s(' the', 'func', [' my', ' that', ' our', ' this', ' its', ' each', ' both', ' every', ' some']),
    s(
      ' north',
      'content',
      [' south', ' east', ' west', ' outer', ' upper', ' iron', ' far', ' lower', ' seaward'],
      { rank: 1 },
    ),
    s(' rail', 'content', [
      ' wall',
      ' ledge',
      ' step',
      ' rocks',
      ' balcony',
      ' gallery',
      ' stones',
      ' path',
      ' sill',
    ]),
    s('.', 'punct', [
      br(',', ' where', ' they', ' can', ' see', '.'),
      br(' -', ' just', ' in', ' case', '.'),
      '!',
      '...',
      ';',
      ':',
      '?',
      '—',
    ]),

    // --------------------------------------------------------- the dread
    s(
      ' Something',
      'content',
      [
        ' Nothing',
        ' Someone',
        ' Somebody',
        ' Anything',
        at(1, ' The', ' sea'),
        at(1, ' Whatever', ' is'),
        at(1, ' Some', ' thing'),
        br(' I', ' do', ' not', ' sleep', ' now', '.'),
        fin(' Anna', ' would', ' have', ' laughed', '.'),
      ],
      { clause: true },
    ),
    s(' out', 'func', [' down', ' up', ' beyond', ' past', ' over', ' below', ' near', ' in', ' back']),
    s(' there', 'func', [
      ' here',
      ' beyond',
      ' below',
      ' outside',
      ' offshore',
      ' near',
      ' close',
      ' ahead',
      ' astern',
    ]),
    s(' is', 'func', [' was', "'s", ' might', ' will', ' must', ' seems', ' still', at(2, ' keeps'), at(2, ' counts')]),
    s(' keeping', 'content', [
      ' counting',
      ' watching',
      ' taking',
      ' settling',
      ' marking',
      ' tallying',
      ' minding',
      ' losing',
      ' calling',
    ]),
    s(' score', 'content', [
      ' count',
      ' tally',
      ' watch',
      ' notes',
      ' time',
      ' record',
      ' stock',
      ' vigil',
      ' distance',
    ]),
    s('.', 'punct', [
      fin(',', ' and', ' it', ' is', ' patient', '.'),
      fin(' -', ' I', ' am', ' sure', '.'),
      '!',
      '...',
      ';',
      ':',
      '?',
      '—',
    ]),
  ],
};
