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
