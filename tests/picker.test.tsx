import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'skills-picker',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 100, scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const LISTING = {
  context: {
    breakdown: {
      skills: {
        totalSkills: 2,
        includedSkills: 2,
        tokens: 0,
        skillFrontmatter: [
          { name: 'impeccable', source: 'userSettings', tokens: 1 },
          { name: 'policies', source: 'projectSettings', tokens: 1 },
        ],
      },
    },
  },
}

test('a once pick reaches one message; a whole-chat pick stays', async ($, on) => {
  const sent: (readonly string[] | undefined)[] = []
  on('session.usage', () => ({ value: LISTING as never }))
  // The engine's band beneath: another mod's row, kept under the picker.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.context)
    return { text: e.text }
  })
  const submit = () => $.prompt.submit({ text: 'hi', origin: { kind: 'composer' }, wait: false } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'skills-toggle' })
  expect(await ui.find({ type: 'Text', text: /This project/ })).toBeDefined()

  await ui.press({ key: 'all:impeccable' })
  await ui.press({ key: 'skills-mode-chat' })
  await ui.press({ key: 'project:policies' })
  expect((await ui.find({ key: 'skills-toggle' }))?.text).toBe('Skills · 2')

  await submit()
  expect(sent[0]?.at(-1)).toMatch(/impeccable, policies/)
  await submit()
  expect(sent[1]?.at(-1)).toMatch(/: policies\./)

  // Minimize folds the list away and keeps the picks.
  await ui.press({ key: 'skills-minimize' })
  expect(await ui.find({ key: 'skills-filter' })).toBeUndefined()
  expect(await ui.find({ key: 'skills-minimize' })).toBeUndefined()
  expect((await ui.find({ key: 'skills-toggle' }))?.text).toBe('Skills · 1')

  await ui.press({ key: 'skills-clear' })
  await submit()
  expect(sent[2]).toBeUndefined()
  await ui.unmount()
})

test('a pinned skill shows first, is kept in the store, and can be picked', async ($, on) => {
  mock.store(on)
  on('session.usage', () => ({ value: LISTING as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'skills-toggle' })
  await ui.press({ key: 'skills-pin-mode' })
  await ui.press({ key: 'all:policies' })
  expect((await ui.find({ key: 'pinned:policies' }))?.text).toBe('★ policies')

  await ui.press({ key: 'skills-pin-mode' })
  await ui.press({ key: 'pinned:policies' })
  expect((await ui.find({ key: 'skills-toggle' }))?.text).toBe('Skills · 1')

  // Unpinning from the pinned row empties it.
  await ui.press({ key: 'skills-pin-mode' })
  await ui.press({ key: 'pinned:policies' })
  expect(await ui.find({ key: 'pinned:policies' })).toBeUndefined()
  await ui.unmount()
})

test('pins saved in an earlier chat come back in a new one', async ($, on) => {
  mock.store(on, { pins: ['impeccable'] })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: LISTING as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'skills-toggle' })
  expect((await ui.find({ key: 'pinned:impeccable' }))?.text).toBe('impeccable')
  await ui.unmount()
})

test('a manual skill starts the message with its command', async ($, on) => {
  let filled = ''
  on('session.usage', () => ({ value: LISTING as never }))
  on('command.list', () => ({
    value: [
      { name: 'savvy-flow:savvy-flow', description: '', source: 'plugin', plugin: 'savvy-flow' },
      { name: 'filetree', description: '', source: 'plugin', plugin: 'filetree' },
      { name: 'help', description: '', source: 'builtin' },
    ],
  }))
  on('prompt.read', () => ({ value: { text: '/old build the login page', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true } as never
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'skills-toggle' })
  expect(await ui.find({ key: 'manual:filetree' })).toBeUndefined()
  expect(await ui.find({ key: 'manual:help' })).toBeUndefined()
  await ui.press({ key: 'manual:savvy-flow:savvy-flow' })
  expect(filled).toBe('/savvy-flow:savvy-flow build the login page')
  await ui.unmount()
})

test('a whole-chat manual skill comes back in front of every message', async ($, on) => {
  let draft = ''
  on('session.usage', () => ({ value: LISTING as never }))
  on('command.list', () => ({
    value: [{ name: 'savvy-flow:savvy-flow', description: '', source: 'plugin', plugin: 'savvy-flow' }],
  }))
  on('prompt.read', () => ({ value: { text: draft, cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    draft = e.text
    return { isFilled: true } as never
  })
  on('prompt.submit', (_, e) => {
    draft = ''
    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'skills-toggle' })
  await ui.press({ key: 'skills-mode-chat' })
  await ui.press({ key: 'manual:savvy-flow:savvy-flow' })
  expect(draft).toBe('/savvy-flow:savvy-flow ')

  await $.prompt.submit({ text: 'build it', origin: { kind: 'composer' }, wait: false } as never)
  expect(draft).toBe('/savvy-flow:savvy-flow ')

  // Pressing it again ends the pick and takes the command off the draft.
  draft = '/savvy-flow:savvy-flow next task'
  await ui.press({ key: 'skills-toggle' })
  await ui.press({ key: 'manual:savvy-flow:savvy-flow' })
  expect(draft).toBe('next task')
  await $.prompt.submit({ text: 'x', origin: { kind: 'composer' }, wait: false } as never)
  expect(draft).toBe('')
  await ui.unmount()
})

test('picks saved as the project default come back after a /clear', async ($, on) => {
  const sent: (readonly string[] | undefined)[] = []
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as never)
  on('ui.toast', () => ({ value: undefined as never }))
  on('session.usage', () => ({ value: LISTING as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.context)
    return { text: e.text }
  })

  await $.session.start({ cwd: 'D:\\Work\\Card Scanner', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'skills-toggle' })
  await ui.press({ key: 'all:impeccable' })
  await ui.press({ key: 'skills-default-save' })
  expect(await ui.find({ type: 'Text', text: /default \(every new chat here\): impeccable/ })).toBeDefined()

  await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as never)
  expect((await ui.find({ key: 'skills-toggle' }))?.text).toBe('Skills · 1')
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' }, wait: false } as never)
  await $.prompt.submit({ text: 'again', origin: { kind: 'composer' }, wait: false } as never)
  // Restored picks are whole chat: every message carries them.
  expect(sent[0]?.at(-1)).toMatch(/: impeccable\./)
  expect(sent[1]?.at(-1)).toMatch(/: impeccable\./)
  await ui.unmount()
})

test('a new chat in the project starts with its default, manual skill and note', async ($, on) => {
  const sent: (readonly string[] | undefined)[] = []
  let draft = ''
  mock.store(on, {
    defaults: { 'd:/work/card scanner': { skills: ['policies'], manual: 'savvy-flow:savvy-flow', note: 'time matters here' } },
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: LISTING as never }))
  on('prompt.read', () => ({ value: { text: draft, cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    draft = e.text
    return { isFilled: true } as never
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.context)
    return { text: e.text }
  })

  await $.session.start({ cwd: 'd:/Work/Card Scanner/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /time matters here/ })).toBeDefined()
  expect(draft).toBe('/savvy-flow:savvy-flow ')

  // A slash command still gets the note; a plain message gets the note and the picks.
  await $.prompt.submit({ text: '/savvy-flow:savvy-flow go', origin: { kind: 'composer' }, wait: false, command: { name: 'savvy-flow:savvy-flow' } } as never)
  expect(sent[0]).toEqual(["The user's standing note for this project, for every message: time matters here"])
  await $.prompt.submit({ text: 'plain', origin: { kind: 'composer' }, wait: false } as never)
  expect(sent[1]?.[0]).toMatch(/time matters here/)
  expect(sent[1]?.[1]).toMatch(/: policies\./)
  await ui.unmount()
})

test('the note can be set and cleared, and another project has none', async ($, on) => {
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: LISTING as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/a', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'skills-toggle' })
  await ui.input({ key: 'skills-note', text: 'just answer' })
  await ui.press({ key: 'skills-minimize' })
  expect(await ui.find({ type: 'Text', text: /Note: just answer/ })).toBeDefined()

  // Another project starts without it.
  await $.session.start({ cwd: '/b', surface: 'desktop', isInteractive: true })
  expect(await ui.find({ type: 'Text', text: /Note:/ })).toBeUndefined()

  // Back in the first project it is kept; an empty note clears it.
  await $.session.start({ cwd: '/a', surface: 'desktop', isInteractive: true })
  expect(await ui.find({ type: 'Text', text: /Note: just answer/ })).toBeDefined()
  await ui.press({ key: 'skills-toggle' })
  await ui.input({ key: 'skills-note', text: '  ' })
  await ui.press({ key: 'skills-minimize' })
  expect(await ui.find({ type: 'Text', text: /Note:/ })).toBeUndefined()
  await ui.unmount()
})
