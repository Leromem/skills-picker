import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pick, PickMode, ProjectDefault, SkillItem } from '../types'

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
// This chat's project folder (store key) and its saved default, kept across chats in the store.
const project = atom({ plugin: 'skills-picker', key: 'project' } as const, '')
const projectDefault = atom({ plugin: 'skills-picker', key: 'projectDefault' } as const, null as ProjectDefault | null)

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

// A whole-chat manual pick: the draft starts with its command again after every send.
// A draft that already starts with a command (typed /clear, say) is left alone.
const keepPrefix = async ($: EngineInterface): Promise<void> => {
  const pick = (await read($, picks)).find(p => p.manual)
  if (!pick) return
  const { text } = await $.prompt.read()
  if (text.startsWith('/')) return
  await $.prompt.fill({ text: `/${pick.name} ${text}`, mode: 'replace' })
}

// Takes `/name ` back off the draft when its whole-chat pick ends.
const dropPrefix = async ($: EngineInterface, name: string): Promise<void> => {
  const { text } = await $.prompt.read()
  if (text.startsWith(`/${name} `) || text === `/${name}`) {
    await $.prompt.fill({ text: text.slice(name.length + 2), mode: 'replace' })
  }
}

// One key per folder: `D:\x` and `d:/x` are the same project.
const projectKey = (cwd: string): string => cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

type Defaults = Record<string, ProjectDefault>
const loadDefaults = async ($: EngineInterface): Promise<Defaults> =>
  ((await $.store.get('defaults')) as Defaults | undefined) ?? {}

// Writes this project's default (null removes it) to the store and the band.
const saveDefault = async ($: EngineInterface, value: ProjectDefault | null): Promise<void> => {
  const key = await read($, project)
  if (!key) return
  const all = { ...(await loadDefaults($)) }
  const isEmpty = !value || (value.skills.length === 0 && !value.manual && !value.note)
  if (isEmpty) delete all[key]
  else all[key] = value
  await $.store.set('defaults', all)
  await update($, projectDefault, () => (isEmpty ? null : value))
}

// A new chat (or a /clear) in a project with a default starts with its picks, whole chat.
// Set when a default puts a manual skill back, so the next band fills the draft once.
let needsPrefix = false
const applyDefault = async ($: EngineInterface): Promise<void> => {
  const saved = await read($, projectDefault)
  if (!saved) return
  const restored: Pick[] = saved.skills.map(name => ({ name, mode: 'chat' }))
  if (saved.manual) restored.push({ name: saved.manual, mode: 'chat', manual: true })
  await update($, picks, () => restored)
  needsPrefix = Boolean(saved.manual)
}

const noteContext = (note: string): string => `The user's standing note for this project, for every message: ${note}`

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
    const key = projectKey(e.cwd)
    await update($, project, () => key)
    await update($, projectDefault, () => null)
    const stored = (await loadDefaults($))[key]
    if (stored) {
      await update($, projectDefault, () => stored)
      await applyDefault($)
    }
    return next(e)
  })

  // A /clear ends the chat: the picks end with it, and the project's default comes back
  // (a /clear raises no session.start).
  on('session.end', async ($, e, next) => {
    await update($, picks, () => [])
    await update($, isOpen, () => false)
    await applyDefault($).catch(() => undefined)
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
    const all = await read($, picks).catch(() => [] as Pick[])
    // Manual picks travel as the slash command itself, never as an instruction.
    const chosen = all.filter(p => !p.manual)
    const note = (await read($, projectDefault).catch(() => null))?.note
    if (!isPerson || e.isMeta || (all.length === 0 && !note)) return next(e)

    // The note goes with every message, a slash command's too; picks only with plain ones.
    const usesPicks = !e.command && chosen.length > 0
    const added = [
      ...(note ? [noteContext(note)] : []),
      ...(usesPicks ? [instruction(chosen.map(p => p.name))] : []),
    ]
    const result = await next(added.length ? { ...e, context: [...(e.context ?? []), ...added] } : e)
    if (!('drop' in result)) {
      if (usesPicks) await update($, picks, prev => prev.filter(p => p.mode === 'chat')).catch(() => undefined)
      await keepPrefix($).catch(() => undefined)
    }
    return result
  })

  // The draft may only clear after the submit hook: put the command back once the turn ends too.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await keepPrefix($).catch(() => undefined)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // A default's manual skill: the prompt box exists by the first band, so fill it here once.
    if (needsPrefix) {
      needsPrefix = false
      void keepPrefix($).catch(() => undefined)
    }
    // Other mods' bands (savvy-progress, handoff) draw beneath this one: keep them.
    const rest = await next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // The phone app draws no text field: there the list goes unfiltered.
    const Input = 'Input' in ui ? ui.Input : null
    const open = await read($, isOpen)
    const chosen = await read($, picks)
    const current = await read($, mode)
    const saved = await read($, projectDefault)

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
        {!open && saved?.note && <Text dimColor>Note: {saved.note}</Text>}
        {chosen.length > 0 && (
          <Button
            key="skills-clear"
            label="Clear"
            plain
            dimColor
            onPress={() =>
              void (async () => {
                for (const p of chosen.filter(c => c.manual)) await dropPrefix($, p.name)
                await update($, picks, () => [])
              })()
            }
          />
        )}
        {/* "Done" sits under the list, often scrolled out of the band: this one is always in view. */}
        {open && <Button key="skills-minimize" label="▾ Minimize" plain onPress={() => void update($, isOpen, () => false)} />}
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
        const kept = chosen.find(c => c.name === s.name)
        // "Next message only" fills the draft once; "Whole chat" keeps it in front of every message.
        const press = async () => {
          if (kept) {
            await update($, picks, prev => prev.filter(p => p.name !== s.name))
            await dropPrefix($, s.name)
            return
          }
          if (current === 'chat') {
            await update($, picks, prev => [...prev.filter(p => !p.manual), { name: s.name, mode: 'chat', manual: true }])
          }
          await startWith($, s.name)
          await update($, isOpen, () => false)
        }
        return (
          <Button
            key={`${section}:${s.name}`}
            label={kept ? `✓ /${s.name} · whole chat` : `/${s.name}`}
            variant={kept ? 'primary' : undefined}
            onPress={() => void press().catch(() => $.ui.toast(`Couldn't start /${s.name}`))}
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
          {row('manual', `Manual · ${manualList.length} · starts your message with the command (Whole chat: every message)`, manualList)}
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
        <Box key="skills-default" flexDirection="column">
          <Text dimColor>
            {saved && (saved.skills.length > 0 || saved.manual)
              ? `This project's default (every new chat here): ${[...saved.skills, ...(saved.manual ? [`/${saved.manual}`] : [])].join(', ')}`
              : 'This project has no default picks: pick skills, then save them so every new chat here starts with them.'}
          </Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {chosen.length > 0 && (
              <Button
                key="skills-default-save"
                label="Save picks as project default"
                onPress={() =>
                  void saveDefault($, {
                    skills: chosen.filter(p => !p.manual).map(p => p.name),
                    manual: chosen.find(p => p.manual)?.name,
                    note: saved?.note,
                  }).then(() => $.ui.toast('Saved: new chats in this project start with these picks'))
                }
              />
            )}
            {saved && (saved.skills.length > 0 || saved.manual) && (
              <Button
                key="skills-default-clear"
                label="Remove project default"
                plain
                dimColor
                onPress={() => void saveDefault($, { skills: [], note: saved.note })}
              />
            )}
          </Box>
          {Input && (
            <Input
              key="skills-note"
              placeholder="Standing note for this project, sent with every message (e.g. time matters here)"
              submitLabel="save note"
              value={saved?.note ?? ''}
              onSubmit={(v: string) =>
                void saveDefault($, {
                  skills: saved?.skills ?? [],
                  manual: saved?.manual,
                  note: v.trim() || undefined,
                })
              }
            />
          )}
        </Box>
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
