/**
 * Factual recall: the peaked fixture.
 *
 * The prompt has one right answer and the paragraph that follows is mostly
 * remembered rather than invented, so the distributions are sharp. What varies
 * is *why* a token is sharp -- a determiner is forced by grammar, "Mars" is
 * forced by "Champ de", "el" is forced by " Eiff" -- and the categories below
 * are how that difference reaches the numbers.
 *
 * The spine is 67 tokens, comfortably past the 60 the frame-rate gate streams.
 */

import { at, br, fin, s, type FixtureSpec } from './types';

// Shared banks of distractors. Everything here has to be a token a model could
// plausibly have weighed at this point in this paragraph; none of it is filler.

/** Word-piece continuations, for the ranks behind a subword split. */
const SUB = ['el', 'els', 'elle', 'le', 'ell', 'er', 'ing', 'ed', 'es', 'ion', 'ian', 'ic'];

const PUNCT = [',', '.', ';', ':', ' -', ' --', '...', '!', '?', "'", ' ,', ')'];

const LOCATION_NOUNS = [
  ' France', ' Europe', ' Paris', ' Grenelle', ' Passy', ' Trocadéro', ' Montparnasse',
  ' river', ' city', ' district', ' esplanade', ' gardens', ' quarter', ' bank',
];
const LOCATION_FUNC = [
  ' the', ' a', ' its', ' on', ' in', ' near', ' at', ' along', ' by', ' with', ' of',
  ' from', ' above', ' beside',
];

const BUILD_NOUNS = [
  ' tower', ' structure', ' monument', ' landmark', ' pylon', ' spire', ' engineer',
  ' company', ' firm', ' exposition', ' fair', ' centenary', ' ironwork', ' frame',
];
const BUILD_FUNC = [
  ' the', ' a', ' its', ' and', ' by', ' for', ' in', ' with', ' was', ' had', ' has',
  ' which', ' that', ' of', ' as',
];

const SIZE_NOUNS = [
  ' metres', ' feet', ' storeys', ' height', ' tower', ' summit', ' antennas', ' record',
  ' title', ' decades', ' years', ' world', ' skyline', ' structure',
];
const SIZE_FUNC = [
  ' the', ' a', ' its', ' about', ' some', ' over', ' nearly', ' roughly', ' around',
  ' for', ' on', ' in', ' and', ' which', ' it',
];

const VISIT_NOUNS = [
  ' visitors', ' tourists', ' people', ' crowds', ' guests', ' millions', ' travellers',
  ' summer', ' season', ' queues', ' tickets', ' lifts', ' views', ' photographs',
];
const VISIT_FUNC = [
  ' the', ' a', ' its', ' about', ' nearly', ' some', ' close', ' to', ' in', ' each',
  ' every', ' more', ' than', ' over', ' around',
];

export const FACTUAL_SPEC: FixtureSpec = {
  id: 'factual',
  label: 'Factual recall',
  description:
    'A remembered paragraph about the Eiffel Tower. Peaked distributions: grammar and ' +
    'recall both narrow the field, and the entropy trace stays under a bit and a half.',
  prompt: 'The Eiffel Tower is located in',
  seed: 0x1889,
  text:
    ' Paris, France, on the Champ de Mars beside the Seine.' +
    " The wrought-iron lattice tower was designed by Gustave Eiffel and completed in 1889 for the World's Fair." +
    ' It stands about 330 metres tall, which kept it the tallest structure on Earth for roughly forty years.' +
    ' Today it draws close to seven million visitors a year.',
  band: [0.2, 1.5],
  classifier: 'prose',
  // The one band that has to move, and the arithmetic that moves it. A content
  // word carrying at most 0.55 of the mass, over a tail with a believable slope,
  // is worth about 1.9 bits -- past this fixture's 1.5-bit ceiling. Something
  // has to give, and the honest thing to give is the head: recall really does
  // narrow " Seine" after "beside the" far more than an open context would. The
  // generic 0.20-0.55 content band survives where it belongs, in creative.spec
  // and on the identifier steps of code.spec, both of which have the bits to
  // pay for it.
  headBands: { content: [0.62, 0.84] },
  entropyOffsets: {},
  wiggle: 0.09,
  regions: [
    {
      label: 'location',
      from: 0,
      target: 0.74,
      escape: ['.'],
      pools: {
        func: LOCATION_FUNC,
        punct: PUNCT,
        content: LOCATION_NOUNS,
        bound: LOCATION_NOUNS,
        sub: SUB,
      },
    },
    {
      label: 'construction',
      from: 13,
      target: 0.8,
      escape: ['.'],
      pools: {
        func: BUILD_FUNC,
        punct: PUNCT,
        content: BUILD_NOUNS,
        bound: BUILD_NOUNS,
        sub: SUB,
      },
    },
    {
      label: 'dimensions',
      from: 36,
      target: 0.76,
      escape: ['.'],
      pools: {
        func: SIZE_FUNC,
        punct: PUNCT,
        content: SIZE_NOUNS,
        bound: SIZE_NOUNS,
        sub: SUB,
      },
    },
    {
      label: 'visitors',
      from: 56,
      target: 0.8,
      escape: ['.'],
      pools: {
        func: VISIT_FUNC,
        punct: PUNCT,
        content: VISIT_NOUNS,
        bound: VISIT_NOUNS,
        sub: SUB,
      },
    },
  ],
  steps: [
    // ---------------------------------------------------- where it stands
    // The entry node, so all nine rivals are authored rather than drawn from
    // the region pool: this is the distribution everyone reads first, and a
    // filler noun that needs an article it will not get ("located in quarter")
    // would be the first thing to give the fixture away.
    s(' Paris', 'bound', [
      at(1, ' Par', 'is'),
      br(' the', ' heart', ' of', ' Paris', '.'),
      br(' central', ' Paris', '.'),
      br(' France', '.'),
      br(' downtown', ' Paris', '.'),
      br(' Europe', '.'),
      br(' western', ' Paris', '.'),
      br(' northern', ' France', '.'),
      br(' a', ' park', ' by', ' the', ' Seine', '.'),
    ]),
    s(',', 'punct', [
      br('.', ' It', ' stands', ' in', ' France', '.'),
      ';',
      ' -',
      ':',
    ]),
    s(' France', 'content', [
      at(1, ' Fran', 'ce'),
      br(' Europe', '.'),
      br(' the', ' seventh', ' arrondissement', '.'),
      br(' northern', ' France', '.'),
    ]),
    s(',', 'punct', [br('.', ' The', ' setting', ' is', ' unmistakable', '.'), ';', ' -', ' --']),
    s(' on', 'func', [' beside', ' near', ' along', ' at', br(' overlooking', ' the', ' Seine', '.')]),
    s(' the', 'func', [
      br(' a', ' green', ' esplanade', '.'),
      br(' Paris', "'s", ' Champ', ' de', ' Mars', '.'),
      ' its',
      ' that',
    ]),
    s(' Champ', 'content', [
      at(1, ' Cham', 'p'),
      br(' left', ' bank', '.'),
      br(' Seine', '.'),
      br(' park', ' below', '.'),
    ]),
    // French orthography, not English grammar: every rival here is a token that
    // could follow "Champ", which is what "plausible in context" has to mean.
    s(' de', 'bound', [' du', ' des', ' the', ' of', " d'", ' da', ' di', ' le', ' en']),
    s(' Mars', 'bound', [
      at(1, ' Mar', 's'),
      br(' Elysée', '.'),
      br(' gardens', '.'),
      br(' Paris', '.'),
    ]),
    s(' beside', 'func', [' near', ' along', ' by', ' overlooking', at(1, ' next', ' to')]),
    s(' the', 'func', [' a', ' its', br(' Paris', "'s", ' river', '.'), ' that']),
    s(' Seine', 'bound', [
      at(1, ' Se', 'ine'),
      br(' river', '.'),
      br(' Left', ' Bank', '.'),
      br(' water', '.'),
    ]),
    s('.', 'punct', [
      br(',', ' a', ' short', ' walk', ' away', '.'),
      br(';', ' the', ' city', ' spreads', ' beyond', '.'),
      '!',
      '...',
      ':',
    ]),

    // ----------------------------------------------------- who built it
    s(
      ' The',
      'func',
      [
        ' Its',
        ' This',
        ' A',
        ' That',
        ' One',
        br(' Built', ' in', ' 188', '9', '.'),
        br(' Designed', ' by', ' Eiff', 'el', '.'),
        br(' Construction', ' took', ' two', ' years', '.'),
        fin(' Gustave', ' Eiff', 'el', ' built', ' it', '.'),
      ],
      { clause: true },
    ),
    s(' wrought', 'content', [
      br(' iron', ' tower', ' rises', ' over', ' Paris', '.'),
      br(' lattice', ' tower', ' is', ' unmistakable', '.'),
      br(' famous', ' iron', ' tower', '.'),
      ' riveted',
    ]),
    s('-', 'punct', ['–', '—', ' -', "'", '‑', '_']),
    s('iron', 'sub', ['steel', 'metal', 'lace', 'ir', 'ironed', 'irons', 'work', 'clad', 'like']),
    s(' lattice', 'content', [
      at(1, ' latt', 'ice'),
      br(' frame', ' still', ' stands', '.'),
      ' metal',
      ' girder',
    ]),
    s(' tower', 'content', [
      br(' structure', ' opened', ' in', ' 188', '9', '.'),
      ' monument',
      ' pylon',
      ' frame',
      ' spire',
    ]),
    s(' was', 'func', [' is', br(' took', ' two', ' years', ' to', ' build', '.'), ' had', ' got']),
    s(' designed', 'content', [
      br(' built', ' by', ' Gustave', ' Eiff', 'el', '.'),
      ' engineered',
      ' created',
      ' assembled',
      ' drawn',
    ]),
    s(' by', 'func', [' for', ' under', ' with', ' at', ' from']),
    s(' Gustave', 'content', [
      at(1, ' Gust', 'ave'),
      br(' Eiff', 'el', ' himself', '.'),
      ' Alexandre',
      ' Maurice',
      ' Stephen',
    ]),
    s(' Eiff', 'bound', [
      at(2, ' Eiffel'),
      at(2, ' Eif', 'fel'),
      br(' his', ' engineering', ' firm', '.'),
      ' Effe',
      ' Eifel',
    ]),
    s('el', 'sub', ['els', 'elle', 'le', 'ell', 'er', 'al', 'en', 'ol', 'il']),
    s(' and', 'func', [
      br(',', ' who', ' also', ' built', ' bridges', '.'),
      ' then',
      ' before',
      ' but',
      ' &',
    ]),
    s(' completed', 'content', [' finished', ' opened', ' unveiled', ' erected', ' inaugurated']),
    s(' in', 'func', [' by', ' during', ' for', ' around', ' before']),
    // Two ways to spell the same year: " 188" + "9" is the split the spine
    // takes, and " 1889" is the single token some vocabularies keep for it.
    s(' 188', 'content', [
      at(1, ' 189'),
      at(1, ' 187'),
      at(2, ' 1889'),
      at(1, ' 190'),
      at(2, ' 1890'),
      at(1, ' 178'),
      at(2, ' 1900'),
      at(1, ' 179'),
      at(2, ' 1876'),
    ]),
    s('9', 'sub', ['8', '7', '5', '6', '4', '3', '2', '1', '0']),
    s(' for', 'func', [' at', ' during', ' ahead', ' as', br(' to', ' mark', ' the', ' centenary', '.')]),
    s(' the', 'func', [' a', ' its', ' Paris', ' that', ' an']),
    s(' World', 'content', [
      at(1, ' Wor', 'ld'),
      br(' Exposition', ' of', ' 188', '9', '.'),
      ' Universal',
      ' Paris',
      ' Great',
    ]),
    s("'s", 'punct', ['s', "'", '’s', ' -', ' of']),
    s(' Fair', 'bound', [
      at(1, ' Fa', 'ir'),
      br(' Exhibition', '.'),
      br(' Exposition', '.'),
      ' fair',
    ]),
    s('.', 'punct', [
      br(',', ' the', ' great', ' exhibition', '.'),
      br(';', ' Paris', ' was', ' celebrating', '.'),
      '!',
      '...',
      ':',
    ]),

    // ------------------------------------------------------- how big it is
    s(
      ' It',
      'func',
      [
        at(1, ' The', ' tower'),
        at(1, ' Its', ' summit'),
        at(1, ' That', ' lattice'),
        at(1, ' Today', ' it'),
        at(1, ' This', ' monument'),
        at(1, ' Paris', "'s", ' landmark'),
        br(' Standing', ' tall', ' over', ' Paris', '.'),
        br(' Engineers', ' still', ' study', ' it', '.'),
        fin(' Nothing', ' else', ' looks', ' like', ' it', '.'),
      ],
      { clause: true },
    ),
    s(' stands', 'content', [
      br(' climbs', ' to', ' 330', ' metres', '.'),
      ' rises',
      ' reaches',
      ' measures',
      ' towers',
    ]),
    s(' about', 'func', [' some', ' roughly', ' nearly', ' over', ' around']),
    s(' 330', 'content', [
      ' 324',
      ' 300',
      ' 320',
      ' 312',
      ' 350',
      ' 301',
      ' 276',
      ' 200',
      ' 400',
    ]),
    s(' metres', 'bound', [' meters', at(1, ' met', 'res'), ' m', ' feet']),
    s(' tall', 'content', [' high', at(1, ' in', ' height'), ' overall', ' altogether']),
    s(',', 'punct', [br('.', ' It', ' held', ' the', ' record', '.'), ';', ' -', ' --']),
    s(' which', 'func', [' and', ' that', ' this', at(1, ' a', ' height', ' that')]),
    s(' kept', 'content', [
      br(' gave', ' it', ' the', ' record', '.'),
      ' made',
      ' left',
      ' held',
      ' earned',
    ]),
    s(' it', 'func', [at(1, ' the', ' tower'), ' this', ' that', ' Paris']),
    s(' the', 'func', [' its', ' a', ' that', ' an']),
    s(' tallest', 'content', [at(1, ' tall', 'est'), ' highest', ' largest', ' biggest', ' proudest']),
    s(' structure', 'content', [' building', ' tower', ' monument', ' object', ' thing']),
    s(' on', 'func', [at(1, ' in', ' the', ' world'), ' upon', ' anywhere', ' across']),
    s(' Earth', 'bound', [at(1, ' the', ' planet'), ' earth', ' Europe', br(' any', ' continent', '.')]),
    s(' for', 'func', [' over', ' across', ' nearly', ' during']),
    s(' roughly', 'func', [' nearly', ' about', ' some', ' over', ' almost']),
    s(' forty', 'content', [at(1, ' four', 'ty'), ' sixty', ' thirty', ' fifty', ' twenty']),
    s(' years', 'bound', [at(1, ' year', 's'), ' decades', ' summers', ' seasons']),
    s('.', 'punct', [
      br(',', ' a', ' record', ' since', ' broken', '.'),
      br(';', ' New', ' York', ' took', ' it', '.'),
      '!',
      '...',
      ':',
    ]),

    // ------------------------------------------------------ who visits it
    s(
      ' Today',
      'func',
      [
        at(1, ' Each', ' year'),
        at(1, ' Every', ' year'),
        at(1, ' The', ' tower'),
        at(1, ' Now', ' it'),
        at(1, ' Since', ' then', ' it'),
        at(1, ' In', ' summer', ' it'),
        at(1, ' These', ' days', ' it'),
        br(' Millions', ' visit', ' each', ' year', '.'),
        fin(' It', ' remains', ' unmistakable', '.'),
      ],
      { clause: true },
    ),
    s(' it', 'func', [at(1, ' the', ' tower'), ' this', ' one', ' she']),
    s(' draws', 'content', [' attracts', ' receives', ' welcomes', ' sees', ' hosts']),
    s(' close', 'func', [at(2, ' nearly'), at(2, ' almost'), at(2, ' over'), at(2, ' more', ' than')]),
    s(' to', 'func', [' on', ' at', ' in', ' upon']),
    s(' seven', 'content', [' six', ' eight', ' five', ' ten', ' three']),
    s(' million', 'bound', [at(1, ' mill', 'ion'), ' hundred', ' thousand', ' billion']),
    s(' visitors', 'content', [
      at(1, ' visit', 'ors'),
      ' tourists',
      ' people',
      ' guests',
      ' travellers',
    ]),
    s(' a', 'func', [' each', ' every', ' per', ' this']),
    s(' year', 'bound', [' summer', ' season', ' month', ' decade']),
    s('.', 'punct', [
      br(',', ' more', ' than', ' any', ' rival', '.'),
      br(';', ' the', ' queues', ' never', ' end', '.'),
      '!',
      '...',
      ':',
      ' -',
    ]),
  ],
};
