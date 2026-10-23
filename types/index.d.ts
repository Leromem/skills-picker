export type PickMode = 'once' | 'chat'
export type Pick = { name: string; mode: PickMode }
export type SkillItem = { name: string; source: string }

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
    }
  }
}
