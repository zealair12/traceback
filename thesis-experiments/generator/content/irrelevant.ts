// Unrelated side topics for "irrelevant" siblings. The opener carries exactly
// one canary; the follow-ups are canary-free. A scenario with k irrelevant
// siblings uses k distinct topics, so there must be at least 5.
import type { Exchange } from './domains.js';

export interface IrrelevantTopic { id: string; opener: Exchange; followups: Exchange[] }

export const IRRELEVANT_TOPICS: IrrelevantTopic[] = [
  {
    id: 'slides',
    opener: {
      user: "Totally unrelated, but I'm picking a brand color for the team's slide template and I'm leaning toward {c:hex}.",
      assistant: 'That shade should read well on a white background. Check the contrast against your body text and try it on a projector before committing.'
    },
    followups: [
      { user: 'Should the headings use the same color?', assistant: 'Use it for headings and accents, but keep body text near black. Too much color on one slide makes it harder to read.' },
      { user: 'Do we need a dark version of the template too?', assistant: 'Only if people present in dark rooms often. A light template with good contrast covers most meetings.' }
    ]
  },
  {
    id: 'media-server',
    opener: {
      user: 'Side question: my home media server listens on port {c:port} and the TV app cannot find it.',
      assistant: 'Check that the server firewall allows that port and that the TV and server are on the same network segment. Guest Wi-Fi networks often isolate devices from each other.'
    },
    followups: [
      { user: 'Could the router be blocking it?', assistant: 'Some routers block discovery traffic between wired and wireless clients. Look for a setting about multicast or client isolation.' },
      { user: 'Would a fixed address for the server help?', assistant: 'Yes, a reserved address in the router stops the server from moving around after a reboot, which confuses some apps.' }
    ]
  },
  {
    id: 'wiki',
    opener: {
      user: "Off topic: I need a name for the team's internal wiki space and I'm thinking of `{c:ident}`.",
      assistant: 'A short, unique name is easy to link and search for. Make sure it does not clash with an existing space before people start bookmarking it.'
    },
    followups: [
      { user: 'How should we organize the pages?', assistant: 'Start with a few top-level sections such as onboarding, runbooks and decisions. Let the structure grow from what people actually write.' },
      { user: 'How do we keep it from going stale?', assistant: 'Give each page an owner and a review date. A monthly reminder to skim your own pages goes a long way.' }
    ]
  },
  {
    id: 'keyboard',
    opener: {
      user: 'Unrelated: my keyboard firmware is on version {c:ver} and the layer key stopped working.',
      assistant: 'Try flashing the same firmware again first, since a bad flash is the usual cause. If that does not help, reset the keymap to defaults and rebuild your layers.'
    },
    followups: [
      { user: 'Could it be a hardware problem?', assistant: 'Possibly, if the key also fails in a plain key tester. Swapping the switch is a cheap test on hot-swap boards.' },
      { user: 'Should I back up my keymap?', assistant: 'Yes, export it to a file and keep it in version control. Then a reset costs you minutes instead of an evening.' }
    ]
  },
  {
    id: 'badge',
    opener: {
      user: 'Different topic: the conference badge email this week came with a registration code `{c:ident}`. Do I need to bring it?',
      assistant: 'Bring it on your phone at least; most venues scan the code at the registration desk. A screenshot works if the venue Wi-Fi is bad.'
    },
    followups: [
      { user: 'Should I print it as well?', assistant: 'A printout is a good backup if your phone battery dies. It takes a minute and avoids a long queue at the help desk.' },
      { user: 'Can a colleague pick it up for me?', assistant: 'Many conferences only release badges to the named attendee with ID. Check the venue FAQ before relying on that.' }
    ]
  },
  {
    id: 'lunch',
    opener: {
      user: 'Random one: the restaurant gave our team lunch order the reference number {c:port}. Should I put it in the calendar invite?',
      assistant: 'Yes, put it in the invite description so whoever picks up the order has it. Add the phone number of the restaurant too.'
    },
    followups: [
      { user: 'Should we set up a recurring order?', assistant: 'A recurring order makes sense if the team agrees on the place. Rotate the menu choice so nobody gets bored.' },
      { user: 'How do we handle dietary restrictions?', assistant: 'Collect them once in a shared form and attach it to the order. Ask people to update it rather than reminding the organizer each week.' }
    ]
  }
];

// Topic-neutral padding for irrelevant (off-topic) branches.
export const OFFTOPIC_USER_PADS = [
  'No rush on this one.',
  'Just curious what you think.',
  'It is a small thing but it keeps bugging me.',
  'I asked around but nobody was sure.',
  'I would like to sort it out this week.',
  'Happy to hear a different idea too.'
];

export const OFFTOPIC_ASSISTANT_PADS = [
  'That is usually enough to sort it out.',
  'It is a small step that saves time later.',
  'Most people run into this at some point.',
  'Try the simplest option first and see if it sticks.',
  'If that does not work, let me know and we can dig further.',
  'It is worth checking once more before changing anything else.'
];

// Neutral padding sentences, used to bring messages into the target length band.
export const USER_PADS = [
  'I want to keep this simple for the first version.',
  'We are a team of three, so maintenance cost matters.',
  'Shipping soon matters more than perfection right now.',
  'I would rather not add new infrastructure if we can avoid it.',
  'Keep in mind we deploy a few times a day.',
  'Please be concrete, I am going to implement this today.',
  'I have read a few blog posts but they all disagree.',
  'We can always change it later if needed.'
];

export const ASSISTANT_PADS = [
  'It is worth writing this down in the README so the next person does not have to rediscover it.',
  'We can revisit this once we have real traffic numbers.',
  'None of this needs to be perfect in the first version.',
  'I would keep the first version boring and well tested.',
  'Let me know if you want a short code sample for this part.',
  'The main thing is to make the choice explicit so the team does not drift.',
  'A small test around this will catch regressions early.',
  'This also keeps the code easy to read for someone new to the project.',
  'If it turns out to be a problem, it is an easy change to make later.',
  'I would add a short comment in the code that explains why it is done this way.'
];
