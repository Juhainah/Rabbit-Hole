import { describe, expect, it } from 'vitest';
import type { SourceItem } from '../../shared/types';
import { checkPremise, compactQuery, namesSubject, relevanceFilter, saysName, subjectName } from '../../server/relevance';
import { isName } from '../../server/understand';

// The rules that keep a dig on its subject. Each case here was a real bug: long searches that found
// nothing, namesakes on the board, typos that sank a dig, descriptions treated as names.

const post = (title: string): SourceItem => ({ id: title, source: 'reddit', kind: 'post', title });
const page = (title: string, snippet = ''): SourceItem => ({ id: title, source: 'web', kind: 'article', title, snippet });

describe('searching with a long topic', () => {
  it('keeps the subject and the telling words, not the whole sentence', () => {
    const q = compactQuery('Star girl game controversy star chat', 4);
    expect(q.toLowerCase()).toContain('star girl');
    expect(q.split(' ').length).toBeLessThanOrEqual(4);
  });
  it('leads with the case when a question is asked about it', () => {
    expect(compactQuery('people on plane of the 9/11 attack', 5)).toContain('9/11');
  });
  it('finds the subject name at the start of a search', () => {
    expect(subjectName('star girl mobile game controversy')).toBe('star girl');
  });
});

describe('what counts as about the subject', () => {
  const keep = relevanceFilter({ phrasings: ['Star girl game controversy star chat'] });
  it('keeps coverage that names the subject, even without the other words', () => {
    expect(keep(page('Outblaze Sells 70% of \'Star Girl\' Franchise to Crosby Capital', 'Crosby Capital agreed to pay'))).toBe(true);
    expect(keep(post('My Dark History With "Star Girl"'))).toBe(true);
  });
  it('drops results that only share the words, apart', () => {
    expect(keep(post('[Choose] Hottest star wars girl'))).toBe(false);
    expect(keep(page('Steam Overlay & Chat in Star Citizen'))).toBe(false);
  });
  it('drops topic and search listing pages', () => {
    expect(keep({ ...page('Petitions about Iconic', 'Star Girl'), url: 'https://www.change.org/topic/iconic-en-us' })).toBe(false);
  });
  it('requires the name itself for short subjects', () => {
    expect(namesSubject('talking angela', 'Talking Angela hoax explained')).toBe(true);
    expect(namesSubject('talking angela', 'Angela Merkel speech')).toBe(false);
  });
});

describe('checking the search before digging', () => {
  const results = [
    { title: 'Talking Angela conspiracy theories explained', snippet: 'The Talking Angela app theories about a hacker' },
    { title: 'Talking Angela hoax', snippet: 'Outfit7 app Talking Angela theories spread on Facebook' },
    { title: 'Is Talking Angela safe?', snippet: 'Parents worried about theories' },
    { title: 'Storm8 games', snippet: 'Storm8 is a mobile game developer' },
  ];
  it('reads a typo as the word the results use', () => {
    expect(checkPremise('talking angela theroies', results).typos).toEqual({ theroies: 'theories' });
  });
  it('sets aside a name no result connects to the rest', () => {
    expect(checkPremise('Talking Angela Storm8 theories', results).unlinked).toEqual(['storm8']);
  });
  it('never "corrects" ordinary words when the results are about something else', () => {
    const junk = [
      { title: 'Star Star - Wikipedia', snippet: 'Star Star is a song by the Rolling Stones, same controversy' },
      { title: 'Star Star lyrics', snippet: 'what a controversy' },
      { title: 'Girl Scouts', snippet: 'girl' },
    ];
    expect(checkPremise('Star girl game controversy star chat', junk).typos).toEqual({});
  });
});

describe('other names for a subject', () => {
  it('keeps real names', () => {
    expect(isName('9/11', 'September 11 attacks')).toBe(true);
    expect(isName('Zayn', 'Zayn Malik')).toBe(true);
    expect(isName('Star Chat', 'Star Girl')).toBe(true);
  });
  it('drops descriptions that would let in anyone', () => {
    expect(isName('British singer', 'Liam Payne')).toBe(false);
    expect(isName('One Direction singer', 'Liam Payne')).toBe(false);
    expect(isName('German 9/11 hijackers', 'Hamburg cell')).toBe(false);
  });
});

describe('the main article must say the name itself', () => {
  // A dig on a game called "<two words>" once got the article on a bakery chain, which mentions both words apart.
  it('finds a name written out, side by side', () => {
    expect(saysName('Bakery Story', 'Bakery Story is a simulation game by Storm8.')).toBe(true);
    expect(saysName('Talking Angela', 'The app features Talking Angela, a cat.')).toBe(true);
  });
  it('does not accept the words scattered apart', () => {
    expect(saysName('Bakery Story', 'Paul is a French chain of bakery restaurants; its story began in 1889.')).toBe(false);
    expect(saysName('Restaurant Story', "Alice's Restaurant is a story song by Arlo Guthrie.")).toBe(false);
  });
});
