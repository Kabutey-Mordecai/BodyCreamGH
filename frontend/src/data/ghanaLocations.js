/**
 * Ghana Administrative & Commercial Delivery Directory
 * Modeled after Jumia Ghana, Bolt & Uber location structures.
 * Provides hierarchical: Region -> Area / District -> Town / Neighborhood
 */

export const GHANA_LOCATIONS = {
  'Greater Accra': {
    'Accra Central & Ridge': [
      'Osu',
      'Cantonments',
      'Labone',
      'Ridge',
      'Adabraka',
      'Asylum Down',
      'Kokomlemle',
      'Jamestown',
      'High Street / Ministries',
    ],
    'Airport & Dzorwulu': [
      'Airport Residential Area',
      'Airport Hills',
      'Airport City',
      'Dzorwulu',
      'Roman Ridge',
      'Abelemkpe',
      'Kotoka Environs',
    ],
    'East Legon & Adiringanor': [
      'East Legon (American House)',
      'East Legon (Bawaleshie / Shiashie)',
      'Adjiringanor',
      'East Legon Hills',
      'Mempeasem',
      'Ogbojo',
      'Nanakrom',
      'School Junction',
    ],
    'Madina & Adenta': [
      'Madina (Zongo Junction / Social Welfare)',
      'Adenta (Barrier / Housing)',
      'Frafraha',
      'Ashiyie',
      'Oyarifa',
      'Pantang',
      'Danfa',
      'Ayi Mensah',
    ],
    'Spintex Road & Teshie/Nungua': [
      'Spintex (Baatsona / Kasapreko)',
      'Spintex (Manet / Regimanuel)',
      'Spintex (Coastal / Shell Signboard)',
      'Lashibi',
      'Sakumono',
      'Teshie',
      'Nungua',
    ],
    'Tema Metropolitan Area': [
      'Tema Community 1',
      'Tema Community 2',
      'Tema Community 4',
      'Tema Community 5',
      'Tema Community 6',
      'Tema Community 8',
      'Tema Community 9',
      'Tema Community 11',
      'Tema Community 12',
      'Tema Community 18',
      'Tema Community 19',
      'Tema Community 20',
      'Tema Community 25',
      'Tema Harbour / Industrial Area',
      'Tema Manhean',
      'Kpone',
      'Dawhenya',
      'Afienya',
    ],
    'West Accra & Achimota': [
      'Dansoman',
      'Kaneshie',
      'Odorkor',
      'Darkuman',
      'Bubuashie',
      'Kwashieman',
      'Lapaz',
      'Abeka',
      'Achimota',
      'Tesano',
      'Alajo',
      'Christian Village',
    ],
    'Ga West, Dome & Pokuase': [
      'Dome',
      'Kwabenya',
      'Ashongman Estate',
      'Taifa',
      'Ofankor',
      'Pokuase',
      'Amasaman',
      'Kuntunse',
      'Medie',
    ],
    'Weija, Gbawe & Kasoa (Accra West)': [
      'Weija (Barrier / SCC)',
      'Gbawe',
      'Mallam',
      'McCarthy Hill',
      'Tetegu',
      'Bortianor',
      'Kokrobite',
      'Kasoa (Galilea / Amanfrom)',
      'Kasoa (CP / Iron City / Nyanyano)',
    ],
  },
  'Ashanti': {
    'Kumasi Central & Adum': [
      'Adum',
      'Bantama',
      'Kejetia',
      'Nhyiaeso',
      'Ridge (Kumasi)',
      'Asafo',
    ],
    'Asokwa & Ahodwo': [
      'Ahodwo',
      'Asokwa',
      'Daban',
      'Atonsu',
      'Chirapatre',
    ],
    'KNUST & Oforikrom': [
      'KNUST Campus',
      'Ayigya',
      'Oforikrom',
      'Kentinkrono',
      'Boadi',
      'Emena',
    ],
    'Suame & Tafo': [
      'Suame Magazine',
      'Old Tafo',
      'New Tafo',
      'Pankrono',
      'Krofofrom',
    ],
    'Kwadaso & Tanoso': [
      'Kwadaso',
      'Tanoso',
      'Sofoline',
      'Abuakwa',
    ],
    'Santasi & Ahenema': [
      'Santasi',
      'Ahenema Kokoben',
      'Trede',
      'Brofoyedur',
    ],
  },
  'Central': {
    'Cape Coast Metro': [
      'Cape Coast Central / Kotokuraba',
      'UCC Campus',
      'Ola',
      'Abura',
      'Pedu',
      'Amissano',
    ],
    'Kasoa Central': [
      'Kasoa New Market',
      'Ofaakor',
      'Opeikuma',
      'Budumburam',
    ],
    'Winneba & Swedru': [
      'Winneba Town',
      'UEW Campus',
      'Agona Swedru',
    ],
    'Elmina & Komenda': [
      'Elmina Castle Area',
      'Komenda',
    ],
  },
  'Eastern': {
    'Koforidua Metro': [
      'Koforidua Central / Market',
      'Effiduase',
      'Asokore',
      'Adweso',
    ],
    'Nsawam & Akwapim Ridge': [
      'Nsawam Town',
      'Aburi',
      'Mampong',
      'Amanokrom',
    ],
    'Krobo & Akosombo': [
      'Akosombo Town',
      'Somanya',
      'Odumase Krobo',
    ],
  },
  'Western': {
    'Sekondi-Takoradi Metro': [
      'Takoradi Market Circle',
      'Beach Road',
      'Anaji',
      'Kwesimintsim',
      'Sekondi Town',
      'Effia Nkwanta',
      'Kojokrom',
    ],
    'Tarkwa & Environs': [
      'Tarkwa Town',
      'UMaT Campus',
      'Nsuaem',
    ],
  },
  'Volta': {
    'Ho & Environs': [
      'Ho Central',
      'UHAS Campus',
      'Bankoe',
      'Dome (Ho)',
      'Kpodzi',
    ],
    'Hohoe & Kpando': [
      'Hohoe Town',
      'Kpando Town',
    ],
    'Aflao & Ketu': [
      'Aflao Border',
      'Denu',
      'Dzodze',
    ],
  },
  'Northern': {
    'Tamale Metro': [
      'Tamale Central',
      'Lamashegu',
      'Aboabo',
      'Sagnarigu',
      'Nyohini',
      'Vittin',
      'UDS Tamale Campus',
    ],
  },
  'Western North': {
    'Sefwi Wiawso': ['Sefwi Wiawso Central', 'Bibiani Town', 'Juaboso'],
  },
  'Oti': {
    'Dambai & Nkwanta': ['Dambai Town', 'Nkwanta Town', 'Jasikan'],
  },
  'Savannah': {
    'Damongo': ['Damongo Town', 'Bole', 'Salaga'],
  },
  'North East': {
    'Nalerigu': ['Nalerigu Town', 'Walewale', 'Gambaga'],
  },
  'Upper East': {
    'Bolgatanga': ['Bolgatanga Central', 'Navrongo Town', 'Bawku'],
  },
  'Upper West': {
    'Wa Metro': ['Wa Central', 'UDS Wa Campus', 'Sombo'],
  },
  'Bono': {
    'Sunyani Metro': ['Sunyani Central', 'Fiapre', 'Abesim', 'Chiraa'],
  },
  'Bono East': {
    'Techiman': ['Techiman Market', 'Kintampo Town', 'Nkoranza'],
  },
  'Ahafo': {
    'Goaso': ['Goaso Town', 'Kenyasi', 'Duayaw Nkwanta'],
  },
};

export const GHANA_REGIONS = Object.keys(GHANA_LOCATIONS);

/**
 * Returns available areas/districts for a selected region.
 */
export function getAreasForRegion(region) {
  if (!region || !GHANA_LOCATIONS[region]) return [];
  return Object.keys(GHANA_LOCATIONS[region]);
}

/**
 * Returns available towns/neighborhoods for a given region & area.
 */
export function getTownsForArea(region, area) {
  if (!region || !area || !GHANA_LOCATIONS[region] || !GHANA_LOCATIONS[region][area]) {
    return [];
  }
  return GHANA_LOCATIONS[region][area];
}
