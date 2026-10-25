export type PickMode = 'once' | 'chat'
// `manual`: a slash-command skill kept at the front of every message for the whole chat.
export type Pick = { name: string; mode: PickMode; manual?: true }
export type SkillItem = { name: string; source: string }
// A project's saved setup, restored as whole-chat picks in every new chat there.
// `note`: a standing line (e.g. "time matters here") sent with every message.
export type ProjectDefault = { skills: string[]; manual?: string; note?: string }

declare module 'claude-code' {
  interface PluginState {
    'skills-picker': {
      isOpen: boolean
      isShowingAll: boolean
      mode: PickMode
      filter: string
      picks: Pick[]
      skills: SkillItem[] | null
      manual: SkillItem[]
      uses: Record<string, number>
      pins: string[]
      isPinning: boolean
      project: string
      projectDefault: ProjectDefault | null
    }
  }
}
