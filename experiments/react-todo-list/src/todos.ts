import type { Todo, TodoAction, TodoFilter } from './types'

export const TODOS_STORAGE_KEY = 'react-todo-list.todos'

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `todo-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function todoReducer(todos: Todo[], action: TodoAction): Todo[] {
  switch (action.type) {
    case 'add': {
      const title = action.title.trim()
      if (!title) return todos
      return [
        ...todos,
        {
          id: action.id ?? createId(),
          title,
          completed: false,
          createdAt: action.createdAt ?? Date.now(),
        },
      ]
    }
    case 'toggle':
      return todos.map((todo) =>
        todo.id === action.id ? { ...todo, completed: !todo.completed } : todo,
      )
    case 'edit': {
      const title = action.title.trim()
      if (!title) return todos
      return todos.map((todo) => (todo.id === action.id ? { ...todo, title } : todo))
    }
    case 'remove':
      return todos.filter((todo) => todo.id !== action.id)
    case 'clearCompleted':
      return todos.filter((todo) => !todo.completed)
    case 'toggleAll':
      return todos.map((todo) => ({ ...todo, completed: action.completed }))
    default:
      return todos
  }
}

export function selectVisible(todos: Todo[], filter: TodoFilter): Todo[] {
  switch (filter) {
    case 'active':
      return todos.filter((todo) => !todo.completed)
    case 'completed':
      return todos.filter((todo) => todo.completed)
    default:
      return todos
  }
}

export function countActive(todos: Todo[]): number {
  return todos.reduce((count, todo) => (todo.completed ? count : count + 1), 0)
}

function isTodo(value: unknown): value is Todo {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Todo>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.completed === 'boolean' &&
    typeof candidate.createdAt === 'number'
  )
}

export function parseStoredTodos(raw: string | null): Todo[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTodo)
  } catch {
    return []
  }
}

export function serializeTodos(todos: Todo[]): string {
  return JSON.stringify(todos)
}
