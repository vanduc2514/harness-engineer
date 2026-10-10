export type TodoFilter = 'all' | 'active' | 'completed'

export interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: number
}

export type TodoAction =
  | { type: 'add'; title: string; id?: string; createdAt?: number }
  | { type: 'toggle'; id: string }
  | { type: 'edit'; id: string; title: string }
  | { type: 'remove'; id: string }
  | { type: 'clearCompleted' }
  | { type: 'toggleAll'; completed: boolean }
