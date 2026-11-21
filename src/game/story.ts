import type { PyramidId } from './core/pyramids';

/**
 * Story fragments (plan 05): painted walls in sealed chambers. Display data only (no core import);
 * the floor that holds fragment k is `ArchProfile.fragment`. Fiction: no real inscriptions, no
 * real deities. Other pyramids get theirs in tasks 07-09.
 */
export type StoryFragment = { title: string; text: string };

export const STORY: Partial<Record<PyramidId, readonly StoryFragment[]>> = {
  egypt: [
    {
      title: 'The mark',
      text: "Painted on the plaster, older than the paint around it: a ring with a line falling through it. Beside it someone has scratched, in a careful hand: 'We were told to build down, not up.'",
    },
    {
      title: 'The nameless gang',
      text: "Workmen's tallies, like those on every block they hauled. One gang has no name, only the ring and the falling line. Its count runs off the edge of the wall.",
    },
    {
      title: 'A lid',
      text: "'The pyramid is a lid,' the scratches say. 'The king's name is on the outside. On the inside, the mark of the ones who asked for it.'",
    },
    {
      title: 'The plan',
      text: "A builder's plan in red ochre, gridded like the real ones. It shows floors no one could see from outside, going down further than the base.",
    },
    {
      title: 'Every country',
      text: "'They came with the mark to every country. The same stone, the same rule: carry no light that is not your own.'",
    },
    {
      title: 'The sleeper',
      text: 'A figure lies at the top of a pyramid, asleep. Below it, many floors; below them, the mark. The figure has no face. The plaster around it is new.',
    },
    {
      title: 'Not by the stairs',
      text: "'If you are reading this, you were woken too. So was I. I did not leave by the stairs.'",
    },
    {
      title: 'Four lids',
      text: "'Four lids, four seals, and one door older than all of them. Do not -' The rest has been scraped away, recently, by someone carrying a torch.",
    },
  ],
};

/** The story of a pyramid is read through its kit: `storyOf` in `src/kits`. */
