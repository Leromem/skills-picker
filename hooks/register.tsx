import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pick, PickMode, SkillItem } from '../types'

const isOpen = atom({ plugin: 'skills-picker', key: 'isOpen' } as const, false)
const isShowingAll = atom({ plugin: 'skills-picker', key: 'isShowingAll' } as const, false)
const mode = atom({ plugin: 'skills-picker', key: 'mode' } as const, 'once' as PickMode)
const filter = atom({ plugin: 'skills-picker', key: 'filter' } as const, '')
const picks = atom({ plugin: 'skills-picker', key: 'picks' } as const, [] as Pick[])
const skills = atom({ plugin: 'skills-picker', key: 'skills' } as const, null as SkillItem[] | null)
// Skills only the person may start (`disable-model-invocation`), such as savvy-flow: run as slash commands.
const manual = atom({ plugin: 'skills-picker', key: 'manual' } as const, [] as SkillItem[])
const uses = atom({ plugin: 'skills-picker', key: 'uses' } as const, {} as Record<string, number>)
// Favourites, kept across chats in the store; `isPinning` turns a click into pin/unpin.
const pins = atom({ plugin: 'skills-picker', key: 'pins' } as const, [] as string[])
const isPinning = atom({ plugin: 'skills-picker', key: 'isPinning' } as const, false)

// How many skills the unfiltered "All skills" row shows before "Show all".
const PREVIEW = 18
const MOST_USED = 8

const modeLabel = (m: PickMode): string => (m === 'once' ? 'once' : 'whole chat')

// The session's skill listing, as /context counts it: user-wide, project and plugin skills.
const loadSkills = async ($: EngineInterface): Promise<void> => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const listed = usage.context.breakdown?.skills?.skillFrontmatter ?? []
  const seen = new Set<string>()
  const list: SkillItem[] = []
  for (const s of listed) {
    const name = s.pluginName && !s.name.includes(':') ? `${s.pluginName}:${s.name}` : s.name
    if (seen.has(name)) continue
    seen.add(name)
    list.push({ name, source: String(s.source) })
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  await update($, skills, () => list)

  // A plugin's skill or command is `plugin:name`; one without a colon is a mod's own
  // command (/filetree), which takes no message, so it stays out.
  const commands = await $.command.list().catch(() => [])
  const manualList = commands
    .filter(c => (c.source === 'user' || (c.source === 'plugin' && c.name.includes(':'))) && !seen.has(c.name))
    .map(c => ({ name: c.name, source: 'manual' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  await update($, manual, () => manualList)
}

// Puts `/name ` in front of the draft (in place of a command already there), so
// sending it runs the skill as if typed.
const startWith = async ($: EngineInterface, name: string): Promise<void> => {
  const { text } = await $.prompt.read()
  const rest = text.startsWith('/') ? text.replace(/^\/\S*\s*/, '') : text
  await $.prompt.fill({ text: `/${name} ${rest}`, mode: 'replace' })
}

const instruction = (names: string[]): string =>
  `The user picked these skills in the Skills bar to apply to this message: ${names.join(', ')}.\n` +
  'Before anything else, invoke each one with the Skill tool and follow its instructions while handling this message. ' +
  'A picked skill already loaded earlier in this conversation does not need to be invoked again; keep following it.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('uses')) as Record<string, number> | undefined
    if (saved) await update($, uses, () => saved)
    const pinned = (await $.store.get('pins')) as string[] | undefined
    if (pinned) await update($, pins, () => pinned)
    return next(e)
  })

  // A /clear ends the chat: the picks end with it.
  on('session.end', async ($, e, next) => {
    await update($, picks, () => [])
    await update($, isOpen, () => false)
    return next(e)
  })

  // Counts every skill run (typed, picked here, or chosen by Claude) for "Most used".
  on('skill.prompt', async ($, e, next) => {
    const counts = { ...(await read($, uses)), [e.skill]: ((await read($, uses))[e.skill] ?? 0) + 1 }
    await update($, uses, () => counts)
    await $.store.set('uses', counts)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    // A failed read never holds up the message: it goes out without picks.
    const chosen = await read($, picks).catch(() => [] as Pick[])
    if (!isPerson || e.command || e.isMeta || chosen.length === 0) return next(e)

    const result = await next({ ...e, context: [...(e.context ?? []), instruction(chosen.map(p => p.name))] })
    if (!('drop' in result)) {
      await update($, picks, prev => prev.filter(p => p.mode === 'chat')).catch(() => undefined)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Other mods' bands (savvy-progress, handoff) draw beneath this one: keep them.
    const rest = await next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // The phone app draws no text field: there the list goes unfiltered.
    const Input = 'Input' in ui ? ui.Input : null
    const open = await read($, isOpen)
    const chosen = await read($, picks)
    const current = await read($, mode)

    const toggle = (name: string) =>
      update($, picks, prev =>
        prev.some(p => p.name === name) ? prev.filter(p => p.name !== name) : [...prev, { name, mode: current }],
      )
    const pressSkills = async () => {
      const willOpen = !open
      await update($, isOpen, () => willOpen)
      if (willOpen) await loadSkills($)
    }

    const head = (
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Button
          key="skills-toggle"
          label={chosen.length ? `Skills · ${chosen.length}` : 'Skills'}
          variant={chosen.length ? 'primary' : undefined}
          onPress={() => void pressSkills()}
        />
        {!open && chosen.length > 0 && (
          <Text dimColor>{chosen.map(p => `${p.name} (${modeLabel(p.mode)})`).join(' · ')}</Text>
        )}
        {chosen.length > 0 && (
          <Button key="skills-clear" label="Clear" plain dimColor onPress={() => void update($, picks, () => [])} />
        )}
      </Box>
    )

    if (!open) {
      return (
        <Box flexDirection="column">
          {head}
          {rest}
        </Box>
      )
    }

    const list = (await read($, skills)) ?? []
    const manualList = await read($, manual)
    const counts = await read($, uses)
    const query = (await read($, filter)).trim().toLowerCase()
    const showAll = await read($, isShowingAll)
    const picked = new Set(chosen.map(p => p.name))
    const favourites = await read($, pins)
    const pinning = await read($, isPinning)

    const togglePin = async (name: string) => {
      const updated = favourites.includes(name) ? favourites.filter(n => n !== name) : [...favourites, name]
      await update($, pins, () => updated)
      await $.store.set('pins', updated)
    }

    const chip = (s: SkillItem, section: string) => {
      if (pinning) {
        return (
          <Button
            key={`${section}:${s.name}`}
            label={`${favourites.includes(s.name) ? '★' : '☆'} ${s.name}`}
            onPress={() => void togglePin(s.name)}
          />
        )
      }
      if (s.source === 'manual') {
        return (
          <Button
            key={`${section}:${s.name}`}
            label={`/${s.name}`}
            onPress={() => void startWith($, s.name).then(() => update($, isOpen, () => false)).catch(() => $.ui.toast(`Couldn't start /${s.name}`))}
          />
        )
      }
      const p = chosen.find(c => c.name === s.name)
      return (
        <Button
          key={`${section}:${s.name}`}
          label={p ? `✓ ${s.name} · ${modeLabel(p.mode)}` : s.name}
          variant={p ? 'primary' : undefined}
          onPress={() => void toggle(s.name)}
        />
      )
    }
    const row = (key: string, title: string, items: SkillItem[]) =>
      items.length === 0 ? null : (
        <Box key={key} flexDirection="column">
          <Text dimColor>{title}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {items.map(s => chip(s, key))}
          </Box>
        </Box>
      )

    const modeButton = (m: PickMode) => (
      <Button
        key={`skills-mode-${m}`}
        label={`${current === m ? '●' : '○'} ${m === 'once' ? 'Next message only' : 'Whole chat'}`}
        plain
        onPress={() => void update($, mode, () => m)}
      />
    )

    const body = (() => {
      if (list.length === 0) return <Text dimColor>Loading skills…</Text>
      if (query) {
        const found = [...list, ...manualList].filter(s => s.name.toLowerCase().includes(query))
        return found.length ? row('found', `Matches · ${found.length}`, found) : <Text dimColor>No skill matches “{query}”.</Text>
      }
      const most = list
        .filter(s => (counts[s.name] ?? 0) > 0)
        .sort((a, b) => (counts[b.name] ?? 0) - (counts[a.name] ?? 0))
        .slice(0, MOST_USED)
      const project = list.filter(s => s.source === 'projectSettings')
      const all = showAll ? list : list.slice(0, PREVIEW)
      // In pin order, as the person added them; a pin whose skill is gone is skipped.
      const pinned = favourites.flatMap(n => [...list, ...manualList].filter(s => s.name === n))
      return (
        <Box flexDirection="column" gap={1}>
          {row('pinned', `★ Pinned · ${pinned.length}`, pinned)}
          {pinned.length === 0 && !pinning && <Text dimColor>No pinned skills yet: press “☆ Pin skills” to add favourites.</Text>}
          {row('most', 'Most used', most)}
          {row('project', `This project · ${project.length}`, project)}
          {row('manual', `Manual · ${manualList.length} · starts your message with the command`, manualList)}
          {row('all', `All skills · ${list.length}`, all)}
          {list.length > PREVIEW && (
            <Button
              key="skills-more"
              label={showAll ? 'Show fewer' : `Show all ${list.length}`}
              plain
              dimColor
              onPress={() => void update($, isShowingAll, () => !showAll)}
            />
          )}
        </Box>
      )
    })()

    return (
      <Box flexDirection="column" gap={1}>
        {head}
        <Box flexDirection="row" gap={2} flexWrap="wrap" alignItems="center">
          <Text dimColor>New picks apply to:</Text>
          {modeButton('once')}
          {modeButton('chat')}
          <Button
            key="skills-pin-mode"
            label={pinning ? '✓ Done pinning' : '☆ Pin skills'}
            variant={pinning ? 'primary' : undefined}
            onPress={() => void update($, isPinning, () => !pinning)}
          />
        </Box>
        {pinning && <Text dimColor>Click a skill to pin or unpin it. Pins stay in every chat.</Text>}
        {Input && (
          <Input
            key="skills-filter"
            placeholder="Filter skills…"
            submitLabel="filter"
            value={await read($, filter)}
            onInput={(v: string) => void update($, filter, () => v)}
            onSubmit={(v: string) => void update($, filter, () => v)}
          />
        )}
        {body}
        <Box flexDirection="row" gap={1}>
          <Button key="skills-done" label="Done" variant="primary" onPress={() => void update($, isOpen, () => false)} />
          {picked.size > 0 && <Text dimColor>Applies when you send your next message.</Text>}
        </Box>
        {rest}
      </Box>
    )
  })
}
